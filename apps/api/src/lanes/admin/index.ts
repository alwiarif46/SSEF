import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db.js';

/** Platform admin lane: admin auth, tenants, worker runs, reference publishing. Routes registered here are mounted on the app (no auth hook applied — add your own). */
export async function register(app: FastifyInstance, db: Db): Promise<void> {
  void app;
  void db;
}
