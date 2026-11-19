import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db.js';

/** Accounts lane: OTP login, password reset, throttling, orchard assignment, notification preferences. Routes registered here are mounted on the app (no auth hook applied — add your own). */
export async function register(app: FastifyInstance, db: Db): Promise<void> {
  void app;
  void db;
}
