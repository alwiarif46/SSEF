import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { roleAtLeast, type Role } from '@orchard/domain';
import { config } from './config.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = await scryptAsync(pw, Buffer.from(s, 'base64'), 64);
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && timingSafeEqual(want, key);
}

export interface Principal {
  userId: string;
  tenantId: string;
  role: Role;
}

const secret = () => new TextEncoder().encode(config.jwtSecret);

export async function issueToken(p: Principal): Promise<string> {
  return new SignJWT({ tid: p.tenantId, role: p.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(p.userId)
    .setIssuedAt()
    .setIssuer('seb-orchard')
    .setExpirationTime(config.jwtTtl)
    .sign(secret());
}

export async function verifyToken(token: string): Promise<Principal> {
  const { payload } = await jwtVerify(token, secret(), { issuer: 'seb-orchard', algorithms: ['HS256'] });
  const role = payload.role as Role;
  if (!payload.sub || typeof payload.tid !== 'string' || !['owner', 'manager', 'worker'].includes(role)) throw new Error('bad token');
  return { userId: payload.sub, tenantId: payload.tid, role };
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' });
  try {
    req.principal = await verifyToken(h.slice(7));
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

export const requireRole = (min: Role) => async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.principal || !roleAtLeast(req.principal.role, min)) return reply.code(403).send({ error: 'forbidden', required: min });
};

/** Principal accessor for authenticated routes. */
export const who = (req: FastifyRequest): Principal => {
  if (!req.principal) throw new Error('unauthenticated route');
  return req.principal;
};
