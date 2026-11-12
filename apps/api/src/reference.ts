import { BUNDLE_2026, type ReferenceBundle } from '@orchard/reference';
import { withoutTenant, type Db } from './db.js';

let cache: { at: number; bundle: ReferenceBundle; etag: string; status: string } | undefined;

/** Latest published-or-under-review bundle (falls back to the compiled default). Cached 5 min. */
export async function currentReference(db: Db): Promise<{ bundle: ReferenceBundle; etag: string; status: string }> {
  if (cache && Date.now() - cache.at < 300_000) return cache;
  const row = await withoutTenant(db, async (tx) =>
    (await tx.query(`SELECT bundle, etag, status FROM public.reference_bundles WHERE status IN ('published','under_review') ORDER BY season DESC, (status = 'published') DESC LIMIT 1`)).rows[0],
  );
  cache = row ? { at: Date.now(), bundle: row.bundle, etag: row.etag, status: row.status } : { at: Date.now(), bundle: BUNDLE_2026, etag: 'builtin', status: BUNDLE_2026.version.status };
  return cache;
}

export const loadBundle = async (db: Db) => (await currentReference(db)).bundle;
export const clearReferenceCache = () => { cache = undefined; };
