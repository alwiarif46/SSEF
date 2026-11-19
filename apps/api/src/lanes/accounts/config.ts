import { config } from '../../config.js';

export type SmsProviderName = 'log' | 'msg91' | 'twilio';

const num = (v: string | undefined, d: number) => {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

const smsProvider = (process.env.SMS_PROVIDER ?? 'log') as SmsProviderName;
if (!['log', 'msg91', 'twilio'].includes(smsProvider)) throw new Error(`SMS_PROVIDER must be log | msg91 | twilio (got ${smsProvider})`);

/**
 * Accounts-lane configuration (env-driven). Kept separate from the shared
 * config.ts. Values are read once at startup; the object is mutable so tests can
 * tune limits without restarting the process.
 */
export const accountsConfig = {
  sms: {
    provider: smsProvider,
    msg91: {
      authKey: process.env.MSG91_AUTH_KEY,
      /** DLT-approved Flow template carrying the OTP as variable `otp`. */
      templateId: process.env.MSG91_TEMPLATE_ID,
      /** Optional Flow template for alert SMS fallback (variables `title`, `body`). */
      alertTemplateId: process.env.MSG91_ALERT_TEMPLATE_ID,
      baseUrl: process.env.MSG91_BASE_URL ?? 'https://control.msg91.com',
    },
    twilio: {
      sid: process.env.TWILIO_SID,
      token: process.env.TWILIO_TOKEN,
      from: process.env.TWILIO_FROM,
      baseUrl: process.env.TWILIO_BASE_URL ?? 'https://api.twilio.com',
    },
    /** Country code prepended to 10-digit national numbers. */
    defaultCountryCode: process.env.SMS_DEFAULT_COUNTRY_CODE ?? '91',
  },
  otp: {
    /** Secret mixed into every OTP / reset-token hash. Defaults to the JWT secret. */
    pepper: process.env.OTP_PEPPER ?? config.jwtSecret,
    length: 6,
    ttlSec: num(process.env.OTP_TTL_SEC, 300),
    maxAttempts: num(process.env.OTP_MAX_ATTEMPTS, 5),
    resendCooldownSec: num(process.env.OTP_RESEND_COOLDOWN_SEC, 30),
    /** Requests allowed per phone / per IP inside `windowSec`. */
    phoneMaxPerWindow: num(process.env.OTP_PHONE_MAX, 5),
    ipMaxPerWindow: num(process.env.OTP_IP_MAX, 30),
    windowSec: num(process.env.OTP_WINDOW_SEC, 3600),
    resetTokenTtlSec: num(process.env.RESET_TOKEN_TTL_SEC, 600),
  },
  login: {
    phoneMaxFailures: num(process.env.LOGIN_PHONE_MAX_FAILURES, 5),
    ipMaxFailures: num(process.env.LOGIN_IP_MAX_FAILURES, 50),
    lockMinutes: num(process.env.LOGIN_LOCK_MINUTES, 15),
    windowMinutes: num(process.env.LOGIN_WINDOW_MINUTES, 15),
  },
};

if (process.env.NODE_ENV === 'production') {
  if (smsProvider === 'log') console.warn('[accounts] SMS_PROVIDER=log in production: OTP codes are only logged, never delivered');
  if (smsProvider === 'msg91' && (!accountsConfig.sms.msg91.authKey || !accountsConfig.sms.msg91.templateId)) throw new Error('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID must be set');
  if (smsProvider === 'twilio' && (!accountsConfig.sms.twilio.sid || !accountsConfig.sms.twilio.token || !accountsConfig.sms.twilio.from)) throw new Error('TWILIO_SID, TWILIO_TOKEN and TWILIO_FROM must be set');
}
