/**
 * Pure photo-reference and upload-queue logic (no React Native imports; unit-tested).
 *
 * A record's `photos` json column holds a mix of:
 *  - device-local URIs (`file://…`, `content://…`, `ph://…`) for photos not yet uploaded, and
 *  - `{ url, mediaId }` references once the server stores them (url = `/v1/media/<id>`).
 * The upload queue is derived from the records themselves (any local URI still present is pending),
 * so nothing is lost if the app is killed; only retry/back-off bookkeeping is kept separately.
 */

export interface PhotoRef { url: string; mediaId: string }
export type PhotoEntry = string | PhotoRef;

/** Tables whose rows carry a `photos` column the server knows how to attach media to. */
export const PHOTO_TABLES = ['scouting_observations', 'chemical_inventory'] as const;
export type PhotoTable = (typeof PHOTO_TABLES)[number];

/**
 * Key order is url, mediaId — the order Postgres jsonb stores them in — so that the sync
 * field-merge union (which compares JSON text) recognises device and server copies as equal.
 */
export const photoRef = (mediaId: string): PhotoRef => ({ url: `/v1/media/${mediaId}`, mediaId });

export const isPhotoRef = (x: unknown): x is PhotoRef => !!x && typeof x === 'object' && typeof (x as PhotoRef).mediaId === 'string';
export const isLocalUri = (x: unknown): x is string => typeof x === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(x) && !/^https?:\/\//i.test(x);

/** Normalise a decoded `photos` value: canonical refs, deduped, unknown junk dropped. */
export function normalizePhotos(v: unknown): PhotoEntry[] {
  let arr = v;
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: PhotoEntry[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const key = isPhotoRef(x) ? `m:${x.mediaId}` : typeof x === 'string' ? `u:${x}` : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(isPhotoRef(x) ? photoRef(x.mediaId) : (x as string));
  }
  return out;
}

export const localUris = (photos: unknown): string[] => normalizePhotos(photos).filter(isLocalUri);
export const uploadedRefs = (photos: unknown): PhotoRef[] => normalizePhotos(photos).filter(isPhotoRef);

/** Replace `uri` with the uploaded reference (in place). Returns null when nothing changes. */
export function replaceLocal(photos: unknown, uri: string, mediaId: string): PhotoEntry[] | null {
  const list = normalizePhotos(photos);
  const idx = list.indexOf(uri);
  const has = list.some((x) => isPhotoRef(x) && x.mediaId === mediaId);
  // URI already gone (e.g. replaced by the server and pulled): nothing to do.
  if (idx < 0) return null;
  const next = [...list];
  if (has) next.splice(idx, 1);
  else next[idx] = photoRef(mediaId);
  return next;
}

const EXT_TYPE: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' };

/** React Native FormData file part: `{ uri, name, type }`. */
export function filePart(uri: string, fallbackType = 'image/jpeg'): { uri: string; name: string; type: string } {
  const clean = uri.split(/[?#]/)[0]!;
  const base = clean.split('/').pop() || 'photo';
  const ext = /\.([a-z0-9]+)$/i.exec(base)?.[1]?.toLowerCase();
  const type = (ext && EXT_TYPE[ext]) || fallbackType;
  const name = ext ? base : `${base}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`;
  return { uri, name: name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80), type };
}

// ── Retry bookkeeping ────────────────────────────────────────────────────────

export interface Attempt { attempts: number; nextAt: number; lastError?: string; failed?: boolean }
export type AttemptLog = Record<string, Attempt>;

export const MAX_ATTEMPTS = 12;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 6 * 3_600_000;

export const attemptKey = (table: string, recordId: string, uri: string) => `${table}|${recordId}|${uri}`;

/** Exponential back-off: 30 s, 1 min, 2 min … capped at 6 h. */
export const backoffMs = (attempts: number) => Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));

/** Server answers that retrying cannot fix (bad file type, too large, forbidden). */
export const isPermanent = (status: number | undefined) => status != null && [400, 403, 413, 415, 422].includes(status);

export function recordFailure(log: AttemptLog, key: string, now: number, error: string, status?: number): AttemptLog {
  const prev = log[key] ?? { attempts: 0, nextAt: 0 };
  const attempts = prev.attempts + 1;
  const failed = isPermanent(status) || attempts >= MAX_ATTEMPTS;
  return { ...log, [key]: { attempts, nextAt: now + backoffMs(attempts), lastError: error, ...(failed ? { failed: true } : {}) } };
}

export function recordSuccess(log: AttemptLog, key: string): AttemptLog {
  const { [key]: _, ...rest } = log;
  return rest;
}

export interface PendingPhoto { table: PhotoTable; recordId: string; uri: string; key: string }

/** Every local URI across the given rows, with whether it is due for an attempt now. */
export function pendingUploads(rows: { table: PhotoTable; id: string; photos: unknown }[], log: AttemptLog, now: number): { due: PendingPhoto[]; waiting: number; failed: number } {
  const due: PendingPhoto[] = [];
  let waiting = 0;
  let failed = 0;
  for (const r of rows)
    for (const uri of localUris(r.photos)) {
      const key = attemptKey(r.table, r.id, uri);
      const a = log[key];
      if (a?.failed) failed++;
      else if (a && a.nextAt > now) waiting++;
      else due.push({ table: r.table, recordId: r.id, uri, key });
    }
  return { due, waiting, failed };
}

/** Drop bookkeeping for photos that no longer exist in any record. */
export function pruneLog(log: AttemptLog, live: Set<string>): AttemptLog {
  return Object.fromEntries(Object.entries(log).filter(([k]) => live.has(k)));
}
