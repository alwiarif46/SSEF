import { withTenant, withoutTenant, type Db, type Tx } from './db.js';
import { config } from './config.js';
import { prefsFromRow, wantsAlert, type NotificationPrefs } from './lanes/accounts/prefs.js';
import { smsProvider, type SmsMessage, type SmsProvider } from './lanes/accounts/sms.js';

export interface PushMessage { to: string; title: string; body: string; data?: unknown }
export type PushSender = (msgs: PushMessage[]) => Promise<void>;

export const logSender: PushSender = async (msgs) => {
  for (const m of msgs) console.log(`[push] → ${m.to.slice(0, 18)}… ${m.title}: ${m.body}`);
};

/** Expo push service (the mobile client registers Expo push tokens). */
export const expoSender: PushSender = async (msgs) => {
  for (let i = 0; i < msgs.length; i += 100) {
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(msgs.slice(i, i + 100).map((m) => ({ ...m, sound: 'default', priority: 'high', channelId: 'alerts' }))),
    });
    if (!r.ok) throw new Error(`expo push ${r.status}`);
  }
};

export interface SendOptions {
  /** SMS fallback provider (default: SMS_PROVIDER). */
  sms?: SmsProvider;
  /** Clock for quiet-hours evaluation (tests). */
  now?: Date;
  log?: (m: string) => void;
}

interface Recipient {
  id: string;
  phone: string;
  role: string;
  prefs: NotificationPrefs;
  tokens: string[];
  /** Assigned orchards (workers only; empty = all orchards). */
  orchards: Set<string>;
}

interface OutboxRow { id: number; title: string; body: string; data: Record<string, unknown> | null; alert_type: string | null; alert_severity: string | null; alert_orchard: string | null }

async function recipients(tx: Tx): Promise<Recipient[]> {
  const { rows: users } = await tx.query(
    `SELECT u.id, u.phone, u.role, np.alert_types, np.min_severity, np.quiet_hours_start::text, np.quiet_hours_end::text, np.sms_fallback,
            (np.user_id IS NOT NULL) AS has_prefs
       FROM public.users u LEFT JOIN public.notification_prefs np ON np.user_id = u.id
      WHERE u.active`,
  );
  const { rows: tokens } = await tx.query<{ user_id: string; token: string }>('SELECT user_id, token FROM public.push_tokens');
  const { rows: assigned } = await tx.query<{ user_id: string; orchard_id: string }>('SELECT user_id, orchard_id FROM public.user_orchards');
  return users.map((u) => ({
    id: u.id,
    phone: u.phone,
    role: u.role,
    prefs: prefsFromRow(u.has_prefs ? u : undefined),
    tokens: tokens.filter((t) => t.user_id === u.id).map((t) => t.token),
    orchards: new Set(u.role === 'worker' ? assigned.filter((a) => a.user_id === u.id).map((a) => a.orchard_id) : []),
  }));
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const smsText = (title: string, body: string) => {
  const t = `Seb Orchard alert: ${title}. ${body}`;
  return t.length > 300 ? `${t.slice(0, 299)}…` : t;
};

/**
 * Drain the outbox for every tenant with pending messages. Delivery respects each
 * user's notification preferences (alert type, minimum severity, IST quiet hours —
 * critical alerts bypass quiet hours) and worker orchard assignments. Critical
 * alerts go by SMS to users who enabled sms_fallback and have no push token.
 */
export async function sendPending(db: Db, sender: PushSender = config.pushProvider === 'expo' ? expoSender : logSender, opts: SendOptions = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? ((m: string) => console.warn(m));
  const tenants: string[] = await withoutTenant(db, async (tx) => (await tx.query('SELECT app.tenants_with_pending_push() AS t')).rows.map((r) => r.t));
  let sent = 0;
  for (const t of tenants) {
    const sms: SmsMessage[] = [];
    await withTenant(db, t, async (tx) => {
      const { rows: msgs } = await tx.query<OutboxRow>(
        `SELECT o.id, o.title, o.body, o.data, a.type AS alert_type, a.severity AS alert_severity, a.orchard_id AS alert_orchard
           FROM public.push_outbox o LEFT JOIN public.infection_alerts a ON a.id = o.alert_id
          WHERE o.status = 'pending' ORDER BY o.id LIMIT 200 FOR UPDATE OF o SKIP LOCKED`,
      );
      if (!msgs.length) return;
      const people = await recipients(tx);
      const pushes: PushMessage[] = [];
      for (const m of msgs) {
        const type = str(m.data?.type) ?? m.alert_type ?? undefined;
        const severity = m.alert_severity ?? str(m.data?.severity);
        const orchard = str(m.data?.orchardId) ?? m.alert_orchard ?? undefined;
        for (const u of people) {
          if (orchard && u.orchards.size && !u.orchards.has(orchard)) continue;
          if (!wantsAlert(u.prefs, { type, severity }, now)) continue;
          if (u.tokens.length) for (const tk of u.tokens) pushes.push({ to: tk, title: m.title, body: m.body, data: m.data });
          else if (severity === 'critical' && u.prefs.smsFallback) sms.push({ to: u.phone, kind: 'alert', text: smsText(m.title, m.body), vars: { title: m.title.slice(0, 120), body: m.body.slice(0, 160) } });
        }
      }
      try {
        if (pushes.length) await sender(pushes);
        await tx.query(`UPDATE public.push_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = ANY($1)`, [msgs.map((m) => m.id)]);
        sent += msgs.length;
      } catch {
        sms.length = 0; // retried with the push on the next run
        await tx.query(`UPDATE public.push_outbox SET attempts = attempts + 1, status = CASE WHEN attempts >= 4 THEN 'failed' ELSE 'pending' END WHERE id = ANY($1)`, [msgs.map((m) => m.id)]);
      }
    });
    // SMS after the outbox commit: best effort, never re-sent.
    if (sms.length) {
      const provider = opts.sms ?? smsProvider();
      for (const m of sms) await provider.send(m).catch((e: Error) => log(`[push] sms fallback failed: ${e.message}`));
    }
  }
  return sent;
}
