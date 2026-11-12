import { withTenant, withoutTenant, type Db } from './db.js';
import { config } from './config.js';

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

/** Drain the outbox for every tenant with pending messages. */
export async function sendPending(db: Db, sender: PushSender = config.pushProvider === 'expo' ? expoSender : logSender): Promise<number> {
  const tenants: string[] = await withoutTenant(db, async (tx) => (await tx.query('SELECT app.tenants_with_pending_push() AS t')).rows.map((r) => r.t));
  let sent = 0;
  for (const t of tenants) {
    await withTenant(db, t, async (tx) => {
      const { rows: msgs } = await tx.query(`SELECT id, title, body, data FROM public.push_outbox WHERE status = 'pending' ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED`);
      const { rows: tokens } = await tx.query(`SELECT p.token FROM public.push_tokens p JOIN public.users u ON u.id = p.user_id WHERE u.active`);
      if (!msgs.length) return;
      try {
        if (tokens.length) await sender(msgs.flatMap((m) => tokens.map((tk) => ({ to: tk.token, title: m.title, body: m.body, data: m.data }))));
        await tx.query(`UPDATE public.push_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = ANY($1)`, [msgs.map((m) => m.id)]);
        sent += msgs.length;
      } catch {
        await tx.query(`UPDATE public.push_outbox SET attempts = attempts + 1, status = CASE WHEN attempts >= 4 THEN 'failed' ELSE 'pending' END WHERE id = ANY($1)`, [msgs.map((m) => m.id)]);
      }
    });
  }
  return sent;
}
