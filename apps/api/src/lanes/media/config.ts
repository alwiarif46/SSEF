import path from 'node:path';
import { config as core } from '../../config.js';

export type StorageDriverName = 'local' | 's3';

export interface S3Settings {
  bucket: string;
  region: string;
  /** S3-compatible endpoint, e.g. https://<account>.r2.cloudflarestorage.com. Omit for AWS. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Path-style addressing (MinIO and most self-hosted S3); R2/AWS work either way. */
  forcePathStyle: boolean;
}

export interface MediaConfig {
  driver: StorageDriverName;
  /** Root directory for the local driver. */
  mediaDir: string;
  s3?: S3Settings;
  /** Upload size cap (bytes). */
  maxBytes: number;
  /** Lifetime of `?t=` signed media links (seconds). */
  signedUrlTtlSec: number;
  /** Lifetime of S3 presigned redirects (seconds). */
  presignTtlSec: number;
  /** HMAC secret for signed media links (separate audience from session JWTs). */
  signingSecret: string;
}

const int = (v: string | undefined, d: number, min: number, max: number) => {
  const n = v == null || v === '' ? d : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`invalid media setting ${v}`);
  return n;
};

/** Lane-local configuration, read from the environment (core config.ts stays untouched). */
export function loadMediaConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  const driver = (env.MEDIA_DRIVER ?? 'local') as StorageDriverName;
  if (driver !== 'local' && driver !== 's3') throw new Error(`MEDIA_DRIVER must be local or s3 (got ${driver})`);
  const cfg: MediaConfig = {
    driver,
    mediaDir: path.resolve(env.MEDIA_DIR ?? './data/media'),
    maxBytes: 10 * 1024 * 1024,
    signedUrlTtlSec: int(env.MEDIA_URL_TTL_SEC, 900, 30, 86_400),
    presignTtlSec: int(env.MEDIA_PRESIGN_TTL_SEC, 300, 30, 3_600),
    signingSecret: env.MEDIA_SIGNING_SECRET ?? `${core.jwtSecret}:media`,
  };
  if (driver === 's3') {
    if (!env.S3_BUCKET) throw new Error('S3_BUCKET is required when MEDIA_DRIVER=s3');
    cfg.s3 = {
      bucket: env.S3_BUCKET,
      region: env.S3_REGION ?? 'auto',
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      ...(env.S3_ACCESS_KEY_ID ? { accessKeyId: env.S3_ACCESS_KEY_ID } : {}),
      ...(env.S3_SECRET_ACCESS_KEY ? { secretAccessKey: env.S3_SECRET_ACCESS_KEY } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    };
  }
  return cfg;
}
