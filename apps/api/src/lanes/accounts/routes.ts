import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole, who } from '../../auth.js';
import { withTenant, type Db } from '../../db.js';
import { ALERT_TYPES, SEVERITIES, prefsBody, prefsFromRow } from './prefs.js';

const orchardId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'invalid orchard id');
const userParams = z.object({ id: z.string().uuid() });

/** Authenticated accounts routes: worker orchard assignment and notification preferences. */
export async function registerAccountRoutes(app: FastifyInstance, db: Db) {
  app.addHook('preHandler', authenticate);

  // ── Orchard assignment (owner / manager) ─────────────────────────────────
  app.get('/v1/user-orchards', { preHandler: requireRole('manager') }, async (req) =>
    withTenant(db, who(req).tenantId, async (tx) => (await tx.query(
      `SELECT user_id AS "userId", array_agg(orchard_id ORDER BY orchard_id) AS "orchardIds" FROM public.user_orchards GROUP BY user_id ORDER BY user_id`,
    )).rows),
  );

  app.get('/v1/users/:id/orchards', { preHandler: requireRole('manager') }, async (req, reply) => {
    const { id } = userParams.parse(req.params);
    return withTenant(db, who(req).tenantId, async (tx) => {
      const { rows: [u] } = await tx.query('SELECT id, role FROM public.users WHERE id = $1', [id]);
      if (!u) return reply.code(404).send({ error: 'not found' });
      const { rows } = await tx.query<{ orchard_id: string }>('SELECT orchard_id FROM public.user_orchards WHERE user_id = $1 ORDER BY orchard_id', [id]);
      return { userId: id, role: u.role, orchardIds: rows.map((r) => r.orchard_id) };
    });
  });

  app.put('/v1/users/:id/orchards', { preHandler: requireRole('manager') }, async (req, reply) => {
    const p = who(req);
    const { id } = userParams.parse(req.params);
    const b = z.object({ orchardIds: z.array(orchardId).max(500) }).parse(req.body);
    const wanted = [...new Set(b.orchardIds)].sort();
    return withTenant(db, p.tenantId, async (tx) => {
      const { rows: [u] } = await tx.query('SELECT id, role FROM public.users WHERE id = $1 FOR UPDATE', [id]);
      if (!u) return reply.code(404).send({ error: 'not found' });
      if (u.role !== 'worker') return reply.code(400).send({ error: 'orchard assignment applies to workers only' });
      const { rows: found } = await tx.query<{ id: string }>('SELECT id FROM public.orchards WHERE id = ANY($1::text[]) AND deleted_at IS NULL', [wanted]);
      const known = new Set(found.map((r) => r.id));
      const unknown = wanted.filter((o) => !known.has(o));
      if (unknown.length) return reply.code(400).send({ error: 'unknown orchard', orchardIds: unknown });
      const { rows: cur } = await tx.query<{ orchard_id: string }>('SELECT orchard_id FROM public.user_orchards WHERE user_id = $1', [id]);
      const current = new Set(cur.map((r) => r.orchard_id));
      const removed = [...current].filter((o) => !known.has(o));
      const added = wanted.filter((o) => !current.has(o));
      if (removed.length) await tx.query('DELETE FROM public.user_orchards WHERE user_id = $1 AND orchard_id = ANY($2::text[])', [id, removed]);
      if (added.length) {
        await tx.query(
          'INSERT INTO public.user_orchards (tenant_id, user_id, orchard_id, created_by) SELECT $1, $2, unnest($3::text[]), $4',
          [p.tenantId, id, added, p.userId],
        );
      }
      if (removed.length || added.length) await tx.query('UPDATE public.users SET orchard_scope_changed_at = now() WHERE id = $1', [id]);
      return { userId: id, orchardIds: wanted };
    });
  });

  // ── Notification preferences (self) ──────────────────────────────────────
  app.get('/v1/me/notifications', async (req) => {
    const p = who(req);
    const row = await withTenant(db, p.tenantId, async (tx) => (await tx.query(
      'SELECT alert_types, min_severity, quiet_hours_start::text, quiet_hours_end::text, sms_fallback FROM public.notification_prefs WHERE user_id = $1', [p.userId],
    )).rows[0]);
    return { ...prefsFromRow(row), options: { alertTypes: ALERT_TYPES, severities: SEVERITIES, timezone: 'Asia/Kolkata' } };
  });

  app.put('/v1/me/notifications', async (req) => {
    const p = who(req);
    const b = prefsBody.parse(req.body);
    const row = await withTenant(db, p.tenantId, async (tx) => (await tx.query(
      `INSERT INTO public.notification_prefs (tenant_id, user_id, alert_types, min_severity, quiet_hours_start, quiet_hours_end, sms_fallback)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET alert_types = EXCLUDED.alert_types, min_severity = EXCLUDED.min_severity,
         quiet_hours_start = EXCLUDED.quiet_hours_start, quiet_hours_end = EXCLUDED.quiet_hours_end, sms_fallback = EXCLUDED.sms_fallback, updated_at = now()
       RETURNING alert_types, min_severity, quiet_hours_start::text, quiet_hours_end::text, sms_fallback`,
      [p.tenantId, p.userId, b.alertTypes ? [...new Set(b.alertTypes)] : null, b.minSeverity, b.quietHoursStart, b.quietHoursEnd, b.smsFallback],
    )).rows[0]);
    return prefsFromRow(row);
  });
}
