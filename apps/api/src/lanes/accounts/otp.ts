import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, issueToken } from '../../auth.js';
import { withoutTenant, type Db } from '../../db.js';
import { password, phone } from '../../routes/auth.js';
import { accountsConfig } from './config.js';
import { otpText, smsProvider } from './sms.js';

export type OtpPurpose = 'login' | 'reset';
const purpose = z.enum(['login', 'reset']);

/** HMAC-SHA256(pepper, purpose:phone:code) — the only form of the code that is stored. */
export const otpHash = (p: OtpPurpose, ph: string, code: string) =>
  createHmac('sha256', accountsConfig.otp.pepper).update(`otp:${p}:${ph}:${code}`).digest('hex');

/** Reset tokens are random; the DB keeps sha256(pepper + token). */
export const resetTokenHash = (token: string) => createHash('sha256').update(`${accountsConfig.otp.pepper}:reset:${token}`).digest('hex');

export const generateOtp = (length = accountsConfig.otp.length) => String(randomInt(0, 10 ** length)).padStart(length, '0');

export type IssueStatus = 'sent' | 'unknown' | 'cooldown' | 'rate_limited';

/** Store a fresh code (hashed) and deliver it by SMS when the phone has an active account. */
export async function issueOtp(db: Db, ph: string, p: OtpPurpose, ip: string | undefined, log?: (m: string) => void): Promise<IssueStatus> {
  const o = accountsConfig.otp;
  const code = generateOtp();
  const status = await withoutTenant(db, async (tx) => (await tx.query<{ s: IssueStatus }>(
    'SELECT app.otp_issue($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS s',
    [ph, p, otpHash(p, ph, code), ip ?? null, o.ttlSec, o.maxAttempts, o.resendCooldownSec, o.phoneMaxPerWindow, o.ipMaxPerWindow, o.windowSec],
  )).rows[0]!.s);
  if (status === 'sent') {
    // Not awaited: response time and outcome must not reveal whether the phone has
    // an account. Delivery failures are logged only.
    smsProvider()
      .send({ to: ph, kind: 'otp', text: otpText(code, Math.round(o.ttlSec / 60)), vars: { otp: code } })
      .catch((e: Error) => log?.(`otp sms delivery failed: ${e.message}`));
  }
  return status;
}

export interface ConsumeResult { status: 'ok' | 'invalid' | 'expired' | 'locked'; userId?: string; tenantId?: string; name?: string; role?: 'owner' | 'manager' | 'worker' }

export async function consumeOtp(db: Db, ph: string, p: OtpPurpose, code: string, resetHash?: string): Promise<ConsumeResult> {
  const r = await withoutTenant(db, async (tx) => (await tx.query(
    'SELECT * FROM app.otp_consume($1, $2, $3, $4, $5)',
    [ph, p, otpHash(p, ph, code), resetHash ?? null, accountsConfig.otp.resetTokenTtlSec],
  )).rows[0]);
  return { status: r.status, userId: r.user_id ?? undefined, tenantId: r.tenant_id ?? undefined, name: r.name ?? undefined, role: r.role ?? undefined };
}

const VERIFY_ERROR: Record<Exclude<ConsumeResult['status'], 'ok'>, string> = {
  invalid: 'invalid or expired code',
  expired: 'invalid or expired code',
  locked: 'too many wrong attempts; request a new code',
};

/** Public routes: OTP request / verify and password reset. */
export function registerOtpRoutes(app: FastifyInstance, db: Db) {
  app.post('/v1/auth/otp/request', async (req, reply) => {
    const b = z.object({ phone, purpose }).parse(req.body);
    const status = await issueOtp(db, b.phone, b.purpose, req.ip, (m) => req.log.warn(m));
    if (status === 'cooldown' || status === 'rate_limited') {
      const retry = status === 'cooldown' ? accountsConfig.otp.resendCooldownSec : accountsConfig.otp.windowSec;
      return reply.code(429).header('retry-after', String(retry)).send({ error: 'too many code requests, try later', retryAfterSec: retry });
    }
    // Identical answer whether or not the phone has an account.
    return { ok: true, expiresInSec: accountsConfig.otp.ttlSec };
  });

  app.post('/v1/auth/otp/verify', async (req, reply) => {
    const b = z.object({ phone, code: z.string().regex(/^[0-9]{4,8}$/, 'code must be digits'), purpose }).parse(req.body);
    const resetToken = b.purpose === 'reset' ? randomBytes(32).toString('base64url') : undefined;
    const r = await consumeOtp(db, b.phone, b.purpose, b.code, resetToken ? resetTokenHash(resetToken) : undefined);
    if (r.status !== 'ok' || !r.userId || !r.tenantId || !r.role) return reply.code(401).send({ error: VERIFY_ERROR[r.status === 'ok' ? 'invalid' : r.status] });
    if (b.purpose === 'reset') return { resetToken, expiresInSec: accountsConfig.otp.resetTokenTtlSec };
    const token = await issueToken({ userId: r.userId, tenantId: r.tenantId, role: r.role });
    return { token, user: { id: r.userId, name: r.name, role: r.role, phone: b.phone } };
  });

  app.post('/v1/auth/password/reset', async (req, reply) => {
    const b = z.object({ resetToken: z.string().min(20).max(200), password }).parse(req.body);
    const hash = await hashPassword(b.password);
    const userId = await withoutTenant(db, async (tx) => (await tx.query<{ u: string | null }>('SELECT app.password_reset($1, $2) AS u', [resetTokenHash(b.resetToken), hash])).rows[0]!.u);
    if (!userId) return reply.code(401).send({ error: 'reset link expired or already used' });
    return { ok: true };
  });
}
