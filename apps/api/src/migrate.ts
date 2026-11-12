import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { BUNDLE_2026, validateBundle, type ReferenceBundle } from '@orchard/reference';
import { config } from './config.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrate(url = config.migrationUrl, log: (m: string) => void = console.log) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM public.schema_migrations')).rows.map((r) => r.name));
    for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO public.schema_migrations (name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      log(`applied ${f}`);
    }
    await seedReference(c, BUNDLE_2026);
  } finally {
    await c.end();
  }
}

export const bundleEtag = (b: ReferenceBundle) => createHash('sha256').update(JSON.stringify(b)).digest('hex').slice(0, 32);

/** Upsert a reference bundle (season-versioned). Refuses invalid bundles. */
export async function seedReference(c: pg.Client, b: ReferenceBundle) {
  const errs = validateBundle(b);
  if (errs.length) throw new Error(`invalid reference bundle: ${errs.join('; ')}`);
  await c.query(
    `INSERT INTO public.reference_bundles (version_id, season, status, bundle, etag, published_at)
     VALUES ($1,$2,$3,$4,$5, CASE WHEN $3 IN ('published','under_review') THEN now() END)
     ON CONFLICT (version_id) DO UPDATE SET status = EXCLUDED.status, bundle = EXCLUDED.bundle, etag = EXCLUDED.etag`,
    [b.version.id, b.version.season, b.version.status, JSON.stringify(b), bundleEtag(b)],
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(
    () => console.log('migrations complete'),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
