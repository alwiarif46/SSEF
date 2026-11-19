import { accountsConfig, type SmsProviderName } from './config.js';

/**
 * Pluggable SMS delivery.
 *  - `log`    (default) prints the message and remembers it in memory — offline dev and tests.
 *  - `msg91`  MSG91 Flow API (DLT templates; India).
 *  - `twilio` Twilio Programmable Messaging.
 */
export type SmsKind = 'otp' | 'alert';

export interface SmsMessage {
  /** Phone as stored on the user (10-digit national, or with country code / leading +). */
  to: string;
  kind: SmsKind;
  /** Fully rendered text (used by providers that send free text). */
  text: string;
  /** Template variables (used by template providers). `otp` for OTP messages; `title`, `body` for alerts. */
  vars: Record<string, string>;
}

export interface SmsProvider {
  readonly name: SmsProviderName;
  send(msg: SmsMessage): Promise<void>;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** Digits only, with the country code (MSG91 format, e.g. 919419000001). */
export function msisdn(phone: string, countryCode = accountsConfig.sms.defaultCountryCode): string {
  const d = phone.replace(/[^0-9]/g, '');
  if (phone.trim().startsWith('+')) return d;
  if (d.length === 10) return `${countryCode}${d}`;
  if (d.length === 11 && d.startsWith('0')) return `${countryCode}${d.slice(1)}`;
  return d;
}

/** E.164 (+919419000001) for Twilio. */
export const e164 = (phone: string, countryCode?: string) => `+${msisdn(phone, countryCode)}`;

const mask = (phone: string) => (phone.length > 4 ? `${'•'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : phone);

/** Development driver: logs and keeps the last message per phone in memory. */
export class LogSms implements SmsProvider {
  readonly name = 'log' as const;
  readonly sent: SmsMessage[] = [];
  private readonly last = new Map<string, SmsMessage>();
  private readonly lastCode = new Map<string, string>();
  constructor(private readonly log: (line: string) => void = (l) => console.log(l), private readonly keep = 200) {}

  async send(msg: SmsMessage): Promise<void> {
    this.sent.push(msg);
    if (this.sent.length > this.keep) this.sent.splice(0, this.sent.length - this.keep);
    this.last.set(msg.to, msg);
    if (msg.kind === 'otp' && msg.vars.otp) this.lastCode.set(msg.to, msg.vars.otp);
    this.log(`[sms:log] → ${mask(msg.to)} (${msg.kind}) ${msg.text}`);
  }

  /** Last OTP code sent to `phone` (tests / local development only). */
  lastOtp(phone: string): string | undefined {
    return this.lastCode.get(phone);
  }

  lastMessage(phone: string): SmsMessage | undefined {
    return this.last.get(phone);
  }

  clear() {
    this.sent.length = 0;
    this.last.clear();
    this.lastCode.clear();
  }
}

async function check(res: Awaited<ReturnType<FetchLike>>, provider: string) {
  if (res.ok) return res;
  const body = (await res.text().catch(() => '')).slice(0, 300);
  throw new Error(`${provider} SMS failed: HTTP ${res.status} ${body}`);
}

/** MSG91 Flow API (https://docs.msg91.com — POST /api/v5/flow). */
export function msg91Sms(opts: { authKey?: string; templateId?: string; alertTemplateId?: string; baseUrl?: string; fetch?: FetchLike } = {}): SmsProvider {
  const c = accountsConfig.sms.msg91;
  const authKey = opts.authKey ?? c.authKey;
  const templateId = opts.templateId ?? c.templateId;
  const alertTemplateId = opts.alertTemplateId ?? c.alertTemplateId;
  const baseUrl = (opts.baseUrl ?? c.baseUrl).replace(/\/$/, '');
  const f = opts.fetch ?? defaultFetch;
  return {
    name: 'msg91',
    async send(msg) {
      if (!authKey) throw new Error('MSG91_AUTH_KEY is not set');
      const template = msg.kind === 'otp' ? templateId : alertTemplateId;
      if (!template) throw new Error(msg.kind === 'otp' ? 'MSG91_TEMPLATE_ID is not set' : 'MSG91_ALERT_TEMPLATE_ID is not set');
      const res = await f(`${baseUrl}/api/v5/flow`, {
        method: 'POST',
        headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ template_id: template, short_url: '0', recipients: [{ mobiles: msisdn(msg.to), ...msg.vars }] }),
      });
      await check(res, 'msg91');
      // MSG91 can answer 200 with {"type":"error"}.
      const text = await res.text().catch(() => '');
      if (text) {
        let parsed: { type?: string; message?: string } | undefined;
        try { parsed = JSON.parse(text) as { type?: string; message?: string }; } catch { parsed = undefined; }
        if (parsed?.type === 'error') throw new Error(`msg91 SMS failed: ${parsed.message ?? 'error'}`);
      }
    },
  };
}

/** Twilio Messages API (POST /2010-04-01/Accounts/{SID}/Messages.json). */
export function twilioSms(opts: { sid?: string; token?: string; from?: string; baseUrl?: string; fetch?: FetchLike } = {}): SmsProvider {
  const c = accountsConfig.sms.twilio;
  const sid = opts.sid ?? c.sid;
  const token = opts.token ?? c.token;
  const from = opts.from ?? c.from;
  const baseUrl = (opts.baseUrl ?? c.baseUrl).replace(/\/$/, '');
  const f = opts.fetch ?? defaultFetch;
  return {
    name: 'twilio',
    async send(msg) {
      if (!sid || !token || !from) throw new Error('TWILIO_SID, TWILIO_TOKEN and TWILIO_FROM must be set');
      const res = await f(`${baseUrl}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ To: e164(msg.to), From: from, Body: msg.text }).toString(),
      });
      await check(res, 'twilio');
    },
  };
}

/** Shared in-memory log driver (inspect it in tests via `logSms.lastOtp(phone)`). */
export const logSms = new LogSms();

let current: SmsProvider | undefined;

export function createSmsProvider(name: SmsProviderName = accountsConfig.sms.provider): SmsProvider {
  switch (name) {
    case 'msg91': return msg91Sms();
    case 'twilio': return twilioSms();
    default: return logSms;
  }
}

/** The process-wide provider chosen by SMS_PROVIDER. */
export function smsProvider(): SmsProvider {
  current ??= createSmsProvider();
  return current;
}

/** Override the process-wide provider (tests, custom drivers). Pass undefined to reset. */
export function setSmsProvider(p: SmsProvider | undefined) {
  current = p;
}

export const otpText = (code: string, ttlMin: number) => `${code} is your Seb Orchard verification code. It expires in ${ttlMin} minutes. Do not share it with anyone.`;
