import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { BUNDLE_2026 } from '@orchard/reference';
import { migrate, seedReference } from '../src/migrate.js';

const ADMIN = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DBNAME = `orchard_integration_test_${process.pid}`;
const url = ADMIN.replace(/\/postgres$/, `/${DBNAME}`);

beforeAll(async () => {
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${DBNAME}`);
  await c.query(`CREATE DATABASE ${DBNAME}`);
  await c.end();
  await migrate(url, () => {});
}, 60_000);

afterAll(async () => {
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${DBNAME}`);
  await c.end();
});

describe('integration', () => {
  it('re-running migrations never downgrades an admin-published reference version', async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      await c.query(`UPDATE public.reference_bundles SET status = 'published' WHERE version_id = $1`, [BUNDLE_2026.version.id]);
      await seedReference(c, BUNDLE_2026);
      const { rows } = await c.query('SELECT status FROM public.reference_bundles WHERE version_id = $1', [BUNDLE_2026.version.id]);
      expect(rows[0].status).toBe('published');
    } finally {
      await c.end();
    }
  });
});
