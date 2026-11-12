// Publish a season-versioned reference bundle without an app release.
//   node scripts/publish-reference.mjs path/to/bundle.json [--status published]
// Validates referential integrity and refuses bundles that recommend banned products.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { seedReference } from '../dist/migrate.js';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('usage: publish-reference.mjs <bundle.json> [--status draft|under_review|published]');
  process.exit(2);
}
const bundle = JSON.parse(await readFile(file, 'utf8'));
const i = rest.indexOf('--status');
if (i >= 0) bundle.version.status = rest[i + 1];
if (bundle.version.status === 'published' && !bundle.version.verifiedBy) {
  console.error('refusing to publish: version.verifiedBy (agronomist sign-off) is required');
  process.exit(1);
}
const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orchard' });
await c.connect();
try {
  await seedReference(c, bundle);
  if (bundle.version.status === 'published')
    await c.query(`UPDATE public.reference_bundles SET status = 'superseded' WHERE season < $1 AND status = 'published'`, [bundle.version.season]);
  console.log(`stored ${bundle.version.id} as ${bundle.version.status}`);
} finally {
  await c.end();
}
