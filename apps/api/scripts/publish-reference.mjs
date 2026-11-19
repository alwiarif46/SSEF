// Publish a season-versioned reference bundle without an app release.
//   node scripts/publish-reference.mjs path/to/bundle.json [--status draft|under_review|published] [--verified-by "Dr. Name"]
// Shares the admin console's validation and storage path (dist/lanes/admin/bundle.js):
// structural + integrity checks, banned-product refusal, agronomist sign-off for 'published' (--verified-by is
// required; a verifiedBy embedded in the file is ignored), storage through app.admin_store_reference (which never
// demotes a stored version and supersedes the previously published one), audit log entry.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { prepareBundle, storeReference } from '../dist/lanes/admin/bundle.js';

const [file, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
if (!file) {
  console.error('usage: publish-reference.mjs <bundle.json> [--status draft|under_review|published] [--verified-by NAME]');
  process.exit(2);
}
const input = JSON.parse(await readFile(file, 'utf8'));
const status = flag('--status') ?? input?.version?.status ?? 'draft';
if (!['draft', 'under_review', 'published'].includes(status)) {
  console.error(`invalid --status ${status}`);
  process.exit(2);
}
// Sign-off must be given on the command line by whoever publishes; a verifiedBy already in the file is ignored.
const verifiedBy = flag('--verified-by');
if (status === 'published' && !verifiedBy?.trim()) {
  console.error('refusing to publish: --verified-by NAME (agronomist sign-off) is required for --status published');
  process.exit(2);
}
const prepared = prepareBundle(input, status, verifiedBy);
if ('refused' in prepared) {
  console.error(`refusing to store: ${prepared.refused}`);
  for (const e of prepared.errors) console.error(`  - ${e}`);
  process.exit(1);
}
for (const e of prepared.errors) console.warn(`warning (draft): ${e}`);

const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/orchard' });
await c.connect();
try {
  await c.query('BEGIN');
  const stored = await storeReference(c, prepared);
  await c.query('SELECT app.admin_record_audit(NULL, $1, $2, $3::jsonb)', ['reference.store_cli', stored.version_id, JSON.stringify({ status: stored.status, season: stored.season, etag: stored.etag, verifiedBy: prepared.bundle.version.verifiedBy ?? null, superseded: stored.superseded })]);
  await c.query('COMMIT');
  console.log(`stored ${stored.version_id} as ${stored.status}${stored.superseded.length ? ` (superseded ${stored.superseded.join(', ')})` : ''}`);
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  if (e?.code === '23514') {
    console.error(`refusing to store: ${e.message}`);
    process.exitCode = 1;
  } else throw e;
} finally {
  await c.end();
}
