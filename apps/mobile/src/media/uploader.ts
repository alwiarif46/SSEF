import { Q } from '@nozbe/watermelondb';
import { database, meta } from '../db';
import { collection } from '../db/repo';
import { decodeJson } from '../db/codec';
import { ApiError, getBaseUrl, getToken } from '../api/client';
import {
  PHOTO_TABLES, filePart, pendingUploads, pruneLog, recordFailure, recordSuccess, replaceLocal, attemptKey, localUris,
  type AttemptLog, type PendingPhoto, type PhotoTable,
} from './photos';

/**
 * Background photo uploader. Photos are captured into records as local URIs; this uploads each one
 * to POST /v1/media (linked to its record) and swaps the URI for `{ url, mediaId }`. It never blocks
 * record sync: failures are retried with back-off, and the record keeps syncing with the local URI.
 */

const LOG_KEY = 'seb.photoUploads';

export interface PhotoUploadStatus { running: boolean; pending: number; waiting: number; failed: number; uploaded: number; lastError?: string }
let status: PhotoUploadStatus = { running: false, pending: 0, waiting: 0, failed: 0, uploaded: 0 };
const listeners = new Set<(s: PhotoUploadStatus) => void>();
const emit = (patch: Partial<PhotoUploadStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
};
export const getPhotoUploadStatus = () => status;
export function onPhotoUploadStatus(l: (s: PhotoUploadStatus) => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

interface UploadResponse { id: string; mediaId: string; url: string }

async function uploadOne(p: PendingPhoto): Promise<UploadResponse> {
  const token = getToken();
  if (!token) throw new ApiError(401, 'signed out');
  const fd = new FormData();
  fd.append('entityTable', p.table);
  fd.append('entityId', p.recordId);
  fd.append('replaces', p.uri);
  // React Native's FormData accepts a { uri, name, type } descriptor for file parts.
  fd.append('file', filePart(p.uri) as unknown as Blob);
  const res = await fetch(`${getBaseUrl()}/v1/media`, { method: 'POST', body: fd, headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as UploadResponse & { error?: string }) : undefined;
  if (!res.ok || !data) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`, data);
  return data;
}

async function rowsWithLocalPhotos() {
  const out: { table: PhotoTable; id: string; photos: unknown }[] = [];
  for (const table of PHOTO_TABLES) {
    const rows = await collection(table).query(Q.where('photos', Q.like('%://%'))).fetch();
    for (const r of rows) out.push({ table, id: r.id, photos: decodeJson((r._raw as unknown as Record<string, unknown>).photos, []) });
  }
  return out;
}

/** Swap the local URI for the reference in the record (marks `photos` changed so the next push carries it). */
async function applyRef(p: PendingPhoto, mediaId: string): Promise<boolean> {
  return database.write(async () => {
    let row;
    try {
      row = await collection(p.table).find(p.recordId);
    } catch {
      return false;
    }
    const next = replaceLocal((row._raw as unknown as Record<string, unknown>).photos, p.uri, mediaId);
    if (!next) return false;
    await row.update((r) => r.setValues({ photos: next, updated_at: Date.now() }));
    return true;
  });
}

let running: Promise<number> | null = null;

/** Upload every due photo. Resolves to the number of records changed (callers re-sync when > 0). */
export function uploadPendingPhotos(): Promise<number> {
  if (running) return running;
  if (!getToken()) return Promise.resolve(0);
  running = (async () => {
    emit({ running: true });
    let changed = 0;
    let log: AttemptLog = (await meta.get<AttemptLog>(LOG_KEY)) ?? {};
    try {
      const rows = await rowsWithLocalPhotos();
      log = pruneLog(log, new Set(rows.flatMap((r) => localUris(r.photos).map((u) => attemptKey(r.table, r.id, u)))));
      const { due, waiting, failed } = pendingUploads(rows, log, Date.now());
      emit({ pending: due.length, waiting, failed });
      let remaining = due.length;
      for (const p of due) {
        try {
          const res = await uploadOne(p);
          log = recordSuccess(log, p.key);
          if (await applyRef(p, res.mediaId)) changed++;
          emit({ uploaded: status.uploaded + 1, pending: --remaining });
        } catch (e) {
          const st = e instanceof ApiError ? e.status : undefined;
          log = recordFailure(log, p.key, Date.now(), e instanceof Error ? e.message : String(e), st);
          emit({ pending: --remaining, lastError: e instanceof Error ? e.message : String(e) });
          // Offline or signed out: stop this round, the next sync retries.
          if (st === undefined || st === 401) break;
        }
      }
      const after = pendingUploads(await rowsWithLocalPhotos(), log, Date.now());
      emit({ pending: after.due.length, waiting: after.waiting, failed: after.failed });
    } finally {
      await meta.set(LOG_KEY, log).catch(() => {});
      emit({ running: false });
      running = null;
    }
    return changed;
  })();
  return running;
}

/** Forget back-off so failed photos are retried right away (e.g. a "Retry uploads" button). */
export async function retryFailedPhotos(): Promise<number> {
  await meta.remove(LOG_KEY);
  return uploadPendingPhotos();
}
