import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { MediaConfig, S3Settings } from './config.js';
import type { MediaType } from './magic.js';

/** Object storage behind the media index. Keys are produced only by `storageKey()`. */
export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer, contentType: MediaType): Promise<void>;
  /** Stream the object (local driver; s3 serves via `presign`). */
  read(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
  /** Short-lived direct download URL, when the backend supports it. */
  presign?(key: string, ttlSec: number, opts: { contentType: MediaType; filename: string }): Promise<string>;
}

const EXT: Record<MediaType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_RE = new RegExp(`^${UUID}/\\d{4}/\\d{2}/${UUID}\\.(jpg|png|webp|pdf)$`);

export const extensionFor = (t: MediaType) => EXT[t];

/** `tenantId/yyyy/mm/<uuid>.<ext>` — the tenant prefix is also enforced by a DB CHECK. */
export function storageKey(tenantId: string, type: MediaType, at = new Date(), id: string = randomUUID()): string {
  const key = `${tenantId}/${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, '0')}/${id}.${EXT[type]}`;
  assertKey(key);
  return key;
}

export function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error(`invalid storage key`);
}

export class LocalStorage implements StorageDriver {
  readonly name = 'local' as const;
  constructor(private readonly root: string) {}

  private file(key: string): string {
    assertKey(key);
    const p = path.resolve(this.root, ...key.split('/'));
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('storage key escapes media root');
    return p;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const p = this.file(key);
    await mkdir(path.dirname(p), { recursive: true });
    // Write-then-rename so a crashed upload never leaves a truncated object at the final key.
    const tmp = `${p}.${process.pid}.${randomUUID()}.part`;
    await writeFile(tmp, body, { flag: 'wx' });
    await rename(tmp, p);
  }

  async read(key: string): Promise<Readable> {
    const p = this.file(key);
    const s = createReadStream(p);
    await new Promise<void>((resolve, reject) => {
      s.once('open', () => resolve());
      s.once('error', reject);
    });
    return s;
  }

  async remove(key: string): Promise<void> {
    await rm(this.file(key), { force: true });
  }
}

/** S3-compatible storage (AWS S3, Cloudflare R2, MinIO). */
export class S3Storage implements StorageDriver {
  readonly name = 's3' as const;
  constructor(private readonly s: S3Settings, private readonly client: S3Client = s3Client(s)) {}

  async put(key: string, body: Buffer, contentType: MediaType): Promise<void> {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.s.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
  }

  async read(key: string): Promise<Readable> {
    assertKey(key);
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.s.bucket, Key: key }));
    if (!r.Body) throw new Error('empty object');
    return r.Body as Readable;
  }

  async remove(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.s.bucket, Key: key }));
  }

  async presign(key: string, ttlSec: number, opts: { contentType: MediaType; filename: string }): Promise<string> {
    assertKey(key);
    const cmd = new GetObjectCommand({
      Bucket: this.s.bucket,
      Key: key,
      ResponseContentType: opts.contentType,
      ResponseContentDisposition: `inline; filename="${opts.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      ResponseCacheControl: 'private, max-age=300',
    });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSec });
  }
}

export function s3Client(s: S3Settings): S3Client {
  return new S3Client({
    region: s.region,
    ...(s.endpoint ? { endpoint: s.endpoint } : {}),
    forcePathStyle: s.forcePathStyle,
    ...(s.accessKeyId && s.secretAccessKey ? { credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey } } : {}),
  });
}

export function createStorage(cfg: MediaConfig): StorageDriver {
  if (cfg.driver === 's3') {
    if (!cfg.s3) throw new Error('S3 settings missing');
    return new S3Storage(cfg.s3);
  }
  return new LocalStorage(cfg.mediaDir);
}
