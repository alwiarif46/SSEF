import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db.js';
import { registerOtpRoutes } from './otp.js';
import { registerAccountRoutes } from './routes.js';

/**
 * Accounts lane: OTP login, password reset, throttling, orchard assignment,
 * notification preferences. Public OTP routes are mounted directly; the rest sit
 * in a nested scope with the authentication hook.
 */
export async function register(app: FastifyInstance, db: Db): Promise<void> {
  registerOtpRoutes(app, db);
  await app.register(async (r) => { await registerAccountRoutes(r, db); });
}
