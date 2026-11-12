import pg from 'pg';
import { config } from './config.js';

// Keep DATE as 'YYYY-MM-DD' strings (no timezone shifts); bigint as number.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(url = config.databaseUrl): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

/**
 * Run `fn` inside a transaction with the tenant context set TRANSACTION-scoped
 * (set_config(..., true)) so it can never leak across pooled connections
 * (PgBouncer transaction mode safe).
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** No tenant context: only SECURITY DEFINER entry points are usable. */
export async function withoutTenant<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
