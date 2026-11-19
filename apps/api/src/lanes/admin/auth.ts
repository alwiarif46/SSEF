import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { withoutTenant, type Db } from '../../db.js';

/**
 * Platform-admin tokens. Same HMAC secret as tenant tokens, but a distinct issuer AND audience,
 * and no tenant claim — so a tenant token never verifies here (no `aud`, wrong `iss`) and an
 * admin token never verifies on tenant routes (wrong `iss`, no `tid`).
 */
export const ADMIN_ISSUER = 'seb-orchard-admin';
export const ADMIN_AUDIENCE = 'seb-admin';
const ADMIN_TTL = process.env.ADMIN_JWT_TTL ?? '12h';

export interface AdminPrincipal { adminId: string; email: string; name: string }

const secret = () => new TextEncoder().encode(config.jwtSecret);

export async function issueAdminToken(adminId: string): Promise<string> {
  return new SignJWT({ scope: 'platform-admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(adminId)
    .setIssuer(ADMIN_ISSUER)
    .setAudience(ADMIN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ADMIN_TTL)
    .sign(secret());
}

/** Returns the admin id from a valid admin token; throws otherwise. */
export async function verifyAdminToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secret(), { issuer: ADMIN_ISSUER, audience: ADMIN_AUDIENCE, algorithms: ['HS256'] });
  if (!payload.sub || payload.scope !== 'platform-admin' || 'tid' in payload) throw new Error('bad admin token');
  return payload.sub;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminPrincipal;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** preHandler for every /v1/admin/* route except login: valid admin token AND the admin is still active. */
export const authenticateAdmin = (db: Db) => async (req: FastifyRequest, reply: FastifyReply) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' });
  let adminId: string;
  try {
    adminId = await verifyAdminToken(h.slice(7));
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  if (!UUID.test(adminId)) return reply.code(401).send({ error: 'unauthorized' });
  const row = await withoutTenant(db, async (tx) => (await tx.query('SELECT id, email, name, active FROM app.admin_get($1)', [adminId])).rows[0]);
  if (!row?.active) return reply.code(401).send({ error: 'unauthorized' });
  req.admin = { adminId: row.id, email: row.email, name: row.name };
};

export const whoAdmin = (req: FastifyRequest): AdminPrincipal => {
  if (!req.admin) throw new Error('unauthenticated admin route');
  return req.admin;
};

/** In-memory failed-login throttle (per email and per client address). */
export class LoginThrottle {
  private readonly hits = new Map<string, { n: number; until: number }>();
  constructor(private readonly max = 8, private readonly windowMs = 15 * 60_000) {}
  blocked(keys: string[], now = Date.now()): boolean {
    return keys.some((k) => {
      const h = this.hits.get(k);
      if (h && h.until <= now) this.hits.delete(k);
      return !!h && h.until > now && h.n >= this.max;
    });
  }
  fail(keys: string[], now = Date.now()) {
    for (const k of keys) {
      const h = this.hits.get(k);
      if (!h || h.until <= now) this.hits.set(k, { n: 1, until: now + this.windowMs });
      else h.n++;
    }
    if (this.hits.size > 10_000) for (const [k, h] of this.hits) if (h.until <= now) this.hits.delete(k);
  }
  reset(keys: string[]) {
    for (const k of keys) this.hits.delete(k);
  }
}
