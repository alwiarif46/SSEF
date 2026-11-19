import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db.js';

/** Media & documents lane: photo storage, spray certificate PDF, CSV import. Routes registered here are mounted on the app (no auth hook applied — add your own). */
export async function register(app: FastifyInstance, db: Db): Promise<void> {
  void app;
  void db;
}
