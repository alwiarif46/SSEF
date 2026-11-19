import { ApiError, api, session } from '../api';

/** Reference stored in a record's `photos` array (key order matches the server / jsonb). */
export interface PhotoRef { url: string; mediaId: string }
/** Legacy entries are device-local URIs that have not been uploaded yet. */
export type PhotoEntry = PhotoRef | string;

export interface UploadedMedia extends PhotoRef {
  id: string;
  kind: 'photo' | 'document';
  contentType: string;
  bytes: number;
  signedUrl: string;
  expiresAt: string;
  deduplicated: boolean;
}

export const MAX_EDGE_PX = 1600;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export const isPhotoRef = (x: unknown): x is PhotoRef => !!x && typeof x === 'object' && typeof (x as PhotoRef).mediaId === 'string';

/** Parse whatever is in a `photos` column (array, JSON string, null) into entries. */
export function photoEntries(v: unknown): PhotoEntry[] {
  let arr: unknown = v;
  if (typeof v === 'string') {
    try { arr = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: PhotoEntry[] = [];
  for (const x of arr) {
    if (isPhotoRef(x)) {
      if (seen.has(x.mediaId)) continue;
      seen.add(x.mediaId);
      out.push({ url: `/v1/media/${x.mediaId}`, mediaId: x.mediaId });
    } else if (typeof x === 'string' && x) out.push(x);
  }
  return out;
}

/** Scale so the longest edge is at most `max`, preserving aspect ratio. */
export function fitWithin(w: number, h: number, max = MAX_EDGE_PX): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * Downscale to ≤1600 px and re-encode as JPEG in the browser before upload. Orientation is applied
 * from EXIF; re-encoding drops the remaining EXIF (the observation itself carries lat/lng).
 */
export async function downscaleImage(file: File, max = MAX_EDGE_PX, quality = 0.85): Promise<Blob> {
  if (!ACCEPTED.includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bmp.width, bmp.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.fillStyle = '#ffffff'; // flatten PNG transparency for JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bmp, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not encode the photo');
    return blob;
  } finally {
    bmp.close();
  }
}

export async function uploadMedia(blob: Blob, filename: string, link?: { entityTable: string; entityId: string; replaces?: string }): Promise<UploadedMedia> {
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Photo is larger than 10 MB');
  const fd = new FormData();
  if (link) {
    fd.append('entityTable', link.entityTable);
    fd.append('entityId', link.entityId);
    if (link.replaces) fd.append('replaces', link.replaces);
  }
  fd.append('file', blob, filename);
  const token = session.token();
  const res = await fetch('/v1/media', { method: 'POST', body: fd, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const data = (await res.json().catch(() => ({}))) as UploadedMedia & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Upload failed (${res.status})`, data);
  return data;
}

export const toRef = (m: Pick<UploadedMedia, 'mediaId'>): PhotoRef => ({ url: `/v1/media/${m.mediaId}`, mediaId: m.mediaId });

/** Signed `<img src>` URLs, cached until shortly before they expire. */
const cache = new Map<string, { url: string; exp: number }>();
export async function signedUrls(ids: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const c = cache.get(id);
    if (c && c.exp - 60_000 > now) out[id] = c.url;
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const r = await api<{ links: Record<string, { signedUrl: string; expiresAt: string }> }>(`/v1/media/links?ids=${batch.join(',')}`);
    for (const [id, l] of Object.entries(r.links)) {
      cache.set(id, { url: l.signedUrl, exp: Date.parse(l.expiresAt) });
      out[id] = l.signedUrl;
    }
  }
  return out;
}

export const deleteMedia = (id: string) => api(`/v1/media/${id}`, { method: 'DELETE' }).finally(() => cache.delete(id));
