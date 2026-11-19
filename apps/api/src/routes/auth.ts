import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, issueToken, verifyPassword } from '../auth.js';
import { withoutTenant, type Db } from '../db.js';

export const phone = z.string().regex(/^\+?[0-9]{10,13}$/, 'phone must be 10–13 digits');
export const password = z.string().min(8).max(128);

/** Public (unauthenticated) auth routes. Owned by the accounts lane. */
export function registerAuthRoutes(app: FastifyInstance, db: Db) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  // Naive in-memory login throttle (per phone); production: put behind a shared rate limiter.
  const attempts = new Map<string, { n: number; until: number }>();

  app.post('/v1/auth/signup', async (req, reply) => {
    const b = z.object({ tenantName: z.string().min(2).max(120), name: z.string().min(2).max(120), phone, password, district: z.string().max(60).optional() }).parse(req.body);
    const hash = await hashPassword(b.password);
    const r = await withoutTenant(db, async (tx) => {
      if ((await tx.query('SELECT app.phone_taken($1) AS t', [b.phone])).rows[0].t) return null;
      return (await tx.query('SELECT * FROM app.create_tenant_with_owner($1,$2,$3,$4,$5)', [b.tenantName, b.name, b.phone, hash, b.district ?? null])).rows[0];
    });
    if (!r) return reply.code(409).send({ error: 'phone already registered' });
    const token = await issueToken({ userId: r.user_id, tenantId: r.tenant_id, role: 'owner' });
    return reply.code(201).send({ token, user: { id: r.user_id, name: b.name, role: 'owner', phone: b.phone }, tenant: { id: r.tenant_id, name: b.tenantName } });
  });

  app.post('/v1/auth/login', async (req, reply) => {
    const b = z.object({ phone, password: z.string().max(128) }).parse(req.body);
    const a = attempts.get(b.phone);
    if (a && a.until > Date.now()) return reply.code(429).send({ error: 'too many attempts, try later' });
    const u = await withoutTenant(db, async (tx) => (await tx.query('SELECT * FROM app.auth_lookup($1)', [b.phone])).rows[0]);
    if (!u || !u.active || !(await verifyPassword(b.password, u.password_hash))) {
      const n = (a?.n ?? 0) + 1;
      attempts.set(b.phone, { n, until: n >= 5 ? Date.now() + 15 * 60_000 : 0 });
      return reply.code(401).send({ error: 'invalid phone or password' });
    }
    attempts.delete(b.phone);
    const token = await issueToken({ userId: u.id, tenantId: u.tenant_id, role: u.role });
    return { token, user: { id: u.id, name: u.name, role: u.role, phone: b.phone } };
  });

}
