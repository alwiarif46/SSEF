import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { BUNDLE_2026 } from '@orchard/reference';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { createPool, type Db } from '../src/db.js';
import { register as registerMedia } from '../src/lanes/media/index.js';
import { loadMediaConfig } from '../src/lanes/media/config.js';
import { MediaTokens } from '../src/lanes/media/tokens.js';
import { S3Storage, storageKey, LocalStorage } from '../src/lanes/media/storage.js';
import { sniff } from '../src/lanes/media/magic.js';
import { mergePhotos, photoRef } from '../src/lanes/media/media.js';
import { parseCsv, toCsv } from '../src/lanes/media/csv.js';
import { buildCertificate, type CertificateInput } from '../src/lanes/media/certificate.js';
import { parseDate, resolveChemical } from '../src/lanes/media/importer.js';

const ADMIN = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DBNAME = `orchard_lane_media_${process.pid}`;
let db: Db;
let app: FastifyInstance;
let mediaDir: string;

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(tmpdir(), 'lane-media-'));
  process.env.MEDIA_DIR = mediaDir;
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${DBNAME}`);
  await c.query(`CREATE DATABASE ${DBNAME}`);
  await c.end();
  await migrate(ADMIN.replace(/\/postgres$/, `/${DBNAME}`), () => {});
  db = createPool(`postgres://orchard_app:orchard_app@localhost:5432/${DBNAME}`);
  app = buildApp(db);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await db?.end();
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${DBNAME}`);
  await c.end();
  await rm(mediaDir, { recursive: true, force: true });
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = async (method: Method, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const r = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as string } : {}), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  const ct = r.headers['content-type']?.toString() ?? '';
  return { status: r.statusCode, body: ct.includes('json') ? r.json() : r.body, raw: r.rawPayload, headers: r.headers };
};
const sync = (token: string, changes: Record<string, unknown>) => call('POST', '/v1/sync?last_pulled_at=0', token, { changes });
const pullAll = (token: string) => call('GET', '/v1/sync?last_pulled_at=0&schema_version=1', token);
const C = (rows: unknown[]) => ({ created: rows, updated: [], deleted: [] });
/** Tenant id claim of a session token (test introspection only). */
const tid = (jwt: string): string => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()).tid;
async function adminQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: ADMIN.replace(/\/postgres$/, `/${DBNAME}`) });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

function multipart(file: { data: Buffer; type: string; filename?: string } | null, fields: Record<string, string> = {}) {
  const boundary = `----lane-media-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename ?? 'photo.jpg'}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    chunks.push(file.data, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const upload = async (token: string | undefined, file: { data: Buffer; type: string; filename?: string } | null, fields: Record<string, string> = {}) => {
  const m = multipart(file, fields);
  const r = await app.inject({ method: 'POST', url: '/v1/media', payload: m.payload, headers: { ...m.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  return { status: r.statusCode, body: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};

const jpeg = (n = 2048) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), randomBytes(n), Buffer.from([0xff, 0xd9])]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(256)]);
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), randomBytes(64)]);
const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

let ownerA = '', ownerB = '', managerA = '', workerA = '';
const orchardId = randomUUID(), blockId = randomUUID(), scoutId = randomUUID();
const LOCAL_URI = 'file:///data/user/0/com.seborchard/cache/ImagePicker/abc.jpg';

describe('setup', () => {
  it('creates two tenants, a manager and a worker, an orchard, block and scouting record', async () => {
    ownerA = (await call('POST', '/v1/auth/signup', undefined, { tenantName: 'Media A', name: 'Owner A', phone: '9419100001', password: 'secret-pass-1' })).body.token;
    ownerB = (await call('POST', '/v1/auth/signup', undefined, { tenantName: 'Media B', name: 'Owner B', phone: '9419100002', password: 'secret-pass-2' })).body.token;
    expect(ownerA && ownerB).toBeTruthy();
    expect((await call('POST', '/v1/users', ownerA, { name: 'Manzoor Mgr', phone: '9419100011', password: 'manager-pass-1', role: 'manager' })).status).toBe(201);
    expect((await call('POST', '/v1/users', ownerA, { name: 'Gulzar Ahmad', phone: '9419100010', password: 'worker-pass-1', role: 'worker' })).status).toBe(201);
    managerA = (await call('POST', '/v1/auth/login', undefined, { phone: '9419100011', password: 'manager-pass-1' })).body.token;
    workerA = (await call('POST', '/v1/auth/login', undefined, { phone: '9419100010', password: 'worker-pass-1' })).body.token;
    const r = await sync(managerA, {
      orchards: C([{ id: orchardId, name: 'Shopian Upper', district: 'Shopian', lat: 33.72, lng: 74.83, elevation_m: 2050, khasra_no: '345/12' }]),
      blocks: C([{ id: blockId, orchard_id: orchardId, name: 'HDP-1', system_type: 'hdp', rootstock_id: 'm9-t337', planting_year: 2021, tree_count: 1600, variety_mix: JSON.stringify([{ varietyId: 'gala-redlum', trees: 1400 }]), expected_harvest_date: '2026-08-20' }]),
    });
    expect(r.body).toMatchObject({ ok: true });
    const s = await sync(workerA, { scouting_observations: C([{ id: scoutId, block_id: blockId, observed_on: '2026-05-02', pest_id: 'european-red-mite', metric: 'mites per leaf', value: 3, photos: JSON.stringify([LOCAL_URI]) }]) });
    expect(s.body).toMatchObject({ ok: true });
  });
});

describe('media upload & download', () => {
  let photoId = '';
  let signedUrl = '';
  const bytes = jpeg();

  it('worker uploads a scouting photo; the local URI in the record is replaced by {url, mediaId}', async () => {
    const r = await upload(workerA, { data: bytes, type: 'image/jpeg' }, { entityTable: 'scouting_observations', entityId: scoutId, replaces: LOCAL_URI });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: 'photo', contentType: 'image/jpeg', bytes: bytes.length, url: `/v1/media/${r.body.id}`, mediaId: r.body.id, deduplicated: false });
    photoId = r.body.id;
    signedUrl = r.body.signedUrl;
    const pulled = await pullAll(ownerA);
    const obs = pulled.body.changes.scouting_observations.created.find((o: { id: string }) => o.id === scoutId);
    expect(JSON.parse(obs.photos)).toEqual([{ url: `/v1/media/${photoId}`, mediaId: photoId }]);
    // Stored under tenantId/yyyy/mm/<uuid>.jpg
    const files = await readdir(mediaDir, { recursive: true });
    expect(files.some((f) => /^[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/.test(String(f).split(path.sep).join('/')))).toBe(true);
  });

  it('a device that later pushes the same reference does not duplicate it (field-merge union)', async () => {
    const r = await sync(workerA, { scouting_observations: { created: [], updated: [{ id: scoutId, photos: JSON.stringify([photoRef(photoId)]), _changed: 'photos' }], deleted: [] } });
    expect(r.body.ok).toBe(true);
    const obs = (await pullAll(ownerA)).body.changes.scouting_observations.created.find((o: { id: string }) => o.id === scoutId);
    expect(JSON.parse(obs.photos)).toHaveLength(1);
  });

  it('serves the bytes with Bearer auth and via the short-lived signed link', async () => {
    const a = await call('GET', `/v1/media/${photoId}`, workerA);
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toBe('image/jpeg');
    expect(a.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(a.raw, bytes)).toBe(0);
    const s = await call('GET', signedUrl);
    expect(s.status).toBe(200);
    expect(Buffer.compare(s.raw, bytes)).toBe(0);
    expect((await call('GET', `/v1/media/${photoId}`)).status).toBe(401);
    expect((await call('GET', `/v1/media/${photoId}?t=garbage`)).status).toBe(401);
    expect((await call('GET', `/v1/media/${photoId}`, undefined, undefined, { 'if-none-match': `"${a.headers.etag?.toString().replaceAll('"', '')}"`, authorization: `Bearer ${workerA}` })).status).toBe(304);
  });

  it('signed links expire and are bound to one object', async () => {
    const cfg = loadMediaConfig();
    const tokens = new MediaTokens(cfg.signingSecret, cfg.signedUrlTtlSec);
    const tenantA = tid(ownerA);
    const old = await tokens.sign({ mediaId: photoId, tenantId: tenantA }, Date.now() - (cfg.signedUrlTtlSec + 60) * 1000);
    expect((await call('GET', `/v1/media/${photoId}?t=${old.token}`)).status).toBe(401);
    const fresh = await tokens.sign({ mediaId: photoId, tenantId: tenantA });
    expect((await call('GET', `/v1/media/${photoId}?t=${fresh.token}`)).status).toBe(200);
    const other = await tokens.sign({ mediaId: randomUUID(), tenantId: tenantA });
    expect((await call('GET', `/v1/media/${photoId}?t=${other.token}`)).status).toBe(401);
    // A session JWT is not a media token (different key and audience).
    expect((await call('GET', `/v1/media/${photoId}?t=${ownerA}`)).status).toBe(401);
    // Batch links for thumbnails.
    const l = await call('GET', `/v1/media/links?ids=${photoId},${randomUUID()}`, workerA);
    expect(Object.keys(l.body.links)).toEqual([photoId]);
    expect((await call('GET', l.body.links[photoId].signedUrl)).status).toBe(200);
  });

  it('denies cross-tenant access with Bearer, signed links and delete', async () => {
    expect((await call('GET', `/v1/media/${photoId}`, ownerB)).status).toBe(404);
    expect((await call('GET', `/v1/media/${photoId}/meta`, ownerB)).status).toBe(404);
    expect((await call('GET', `/v1/media/links?ids=${photoId}`, ownerB)).body.links).toEqual({});
    expect((await call('DELETE', `/v1/media/${photoId}`, ownerB)).status).toBe(404);
    // A token minted for tenant B cannot reach tenant A's object even with the right id.
    const cfg = loadMediaConfig();
    const tokens = new MediaTokens(cfg.signingSecret, 60);
    const forged = await tokens.sign({ mediaId: photoId, tenantId: tid(ownerB) });
    expect((await call('GET', `/v1/media/${photoId}?t=${forged.token}`)).status).toBe(404);
    // B cannot attach its upload to A's record either (RLS: the record is invisible).
    const r = await upload(ownerB, { data: jpeg(), type: 'image/jpeg' }, { entityTable: 'scouting_observations', entityId: scoutId });
    expect(r.status).toBe(201);
    const obs = (await pullAll(ownerA)).body.changes.scouting_observations.created.find((o: { id: string }) => o.id === scoutId);
    expect(JSON.parse(obs.photos)).toHaveLength(1);
  });

  it('rejects content whose magic bytes are not an allowed type, or do not match the declared type', async () => {
    const txt = await upload(workerA, { data: Buffer.from('<script>alert(1)</script>'), type: 'image/jpeg' });
    expect(txt.status).toBe(415);
    const gif = await upload(workerA, { data: Buffer.concat([Buffer.from('GIF89a'), randomBytes(64)]), type: 'image/gif', filename: 'x.gif' });
    expect(gif.status).toBe(415);
    const mismatch = await upload(workerA, { data: png(), type: 'image/jpeg' });
    expect(mismatch.status).toBe(415);
    const exe = await upload(workerA, { data: Buffer.concat([Buffer.from('MZ'), randomBytes(64)]), type: 'application/octet-stream', filename: 'a.exe' });
    expect(exe.status).toBe(415);
    expect((await upload(workerA, null, { entityTable: 'blocks' })).status).toBe(400);
    expect((await upload(undefined, { data: jpeg(), type: 'image/jpeg' })).status).toBe(401);
    expect((await call('POST', '/v1/media', workerA, { not: 'multipart' })).status).toBe(415);
  });

  it('accepts PNG, WebP and PDF (as a document); octet-stream is typed by content', async () => {
    expect((await upload(workerA, { data: png(), type: 'image/png', filename: 'a.png' })).body.contentType).toBe('image/png');
    expect((await upload(workerA, { data: webp(), type: 'application/octet-stream', filename: 'a.webp' })).body.contentType).toBe('image/webp');
    const d = await upload(managerA, { data: pdf(), type: 'application/pdf', filename: 'invoice.pdf' }, { entityTable: 'chemical_inventory', entityId: randomUUID() });
    expect(d.status).toBe(201);
    expect(d.body.kind).toBe('document');
    const list = await call('GET', `/v1/media?entityTable=chemical_inventory&entityId=${d.body.entityId}`, managerA);
    expect(list.body.media.map((m: { id: string }) => m.id)).toEqual([d.body.id]);
  });

  it('enforces the 10 MB limit', async () => {
    const big = Buffer.concat([jpeg(16), Buffer.alloc(10 * 1024 * 1024)]);
    const r = await upload(workerA, { data: big, type: 'image/jpeg' });
    expect(r.status).toBe(413);
  });

  it('re-uploading identical bytes returns the existing object', async () => {
    const r = await upload(workerA, { data: bytes, type: 'image/jpeg' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: photoId, deduplicated: true });
  });

  it('delete is manager+, removes the object, detaches it from the record, and 404s afterwards', async () => {
    expect((await call('DELETE', `/v1/media/${photoId}`, workerA)).status).toBe(403);
    const key = await adminQuery<{ storage_key: string }>('SELECT storage_key FROM public.media WHERE id = $1', [photoId]).then((r) => r[0]!.storage_key);
    expect(existsSync(path.join(mediaDir, key))).toBe(true);
    expect((await call('DELETE', `/v1/media/${photoId}`, managerA)).status).toBe(204);
    expect(existsSync(path.join(mediaDir, key))).toBe(false);
    expect((await call('GET', `/v1/media/${photoId}`, workerA)).status).toBe(404);
    expect((await call('GET', signedUrl)).status).toBe(404);
    expect((await call('DELETE', `/v1/media/${photoId}`, managerA)).status).toBe(404);
    const obs = (await pullAll(ownerA)).body.changes.scouting_observations.created.find((o: { id: string }) => o.id === scoutId);
    expect(JSON.parse(obs.photos)).toEqual([]);
  });
});

describe('storage drivers', () => {
  it('local driver confines keys to tenant/yyyy/mm/<uuid>.<ext> under the media root', async () => {
    const t = randomUUID();
    const key = storageKey(t, 'image/webp', new Date(Date.UTC(2026, 2, 5)));
    expect(key).toMatch(new RegExp(`^${t}/2026/03/[0-9a-f-]{36}\\.webp$`));
    const local = new LocalStorage(mediaDir);
    await expect(local.put('../../etc/passwd', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(/invalid storage key/);
    await local.put(key, Buffer.from('hello'), 'image/webp');
    const chunks: Buffer[] = [];
    for await (const c of await local.read(key)) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello');
    await local.remove(key);
    await expect(local.read(key)).rejects.toThrow();
  });

  it('s3 driver puts/deletes through the client and serves downloads as presigned redirects', async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const objects = new Map<string, Buffer>();
    const fake = {
      send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push({ name: cmd.constructor.name, input: cmd.input });
        if (cmd.constructor.name === 'PutObjectCommand') objects.set(String(cmd.input.Key), cmd.input.Body as Buffer);
        if (cmd.constructor.name === 'DeleteObjectCommand') objects.delete(String(cmd.input.Key));
        return {};
      },
    };
    const settings = { bucket: 'orchard-media', region: 'auto', endpoint: 'https://acct.r2.cloudflarestorage.com', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', forcePathStyle: false };
    const real = new S3Storage(settings);
    const s3 = new S3Storage(settings, fake as never);
    // Presigning is pure computation: use a real client for it.
    s3.presign = real.presign.bind(real);
    const cfg = { ...loadMediaConfig(), driver: 's3' as const, s3: settings };
    const s3app = Fastify();
    s3app.setErrorHandler((err, _req, reply) => reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }));
    await s3app.register(async (r) => registerMedia(r, db, { config: cfg, storage: s3 }));
    await s3app.ready();
    const m = multipart({ data: jpeg(), type: 'image/jpeg' });
    const up = await s3app.inject({ method: 'POST', url: '/v1/media', payload: m.payload, headers: { ...m.headers, authorization: `Bearer ${workerA}` } });
    expect(up.statusCode).toBe(201);
    expect(sent.find((s) => s.name === 'PutObjectCommand')?.input).toMatchObject({ Bucket: 'orchard-media', ContentType: 'image/jpeg' });
    const get = await s3app.inject({ method: 'GET', url: up.json().signedUrl });
    expect(get.statusCode).toBe(302);
    const loc = new URL(String(get.headers.location));
    expect(loc.host).toBe('orchard-media.acct.r2.cloudflarestorage.com');
    expect(loc.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(Number(loc.searchParams.get('X-Amz-Expires'))).toBe(cfg.presignTtlSec);
    const del = await s3app.inject({ method: 'DELETE', url: `/v1/media/${up.json().id}`, headers: { authorization: `Bearer ${managerA}` } });
    expect(del.statusCode).toBe(204);
    expect(objects.size).toBe(0);
    await s3app.close();
  });

  it('sniffs only real signatures', () => {
    expect(sniff(jpeg())).toBe('image/jpeg');
    expect(sniff(png())).toBe('image/png');
    expect(sniff(webp())).toBe('image/webp');
    expect(sniff(pdf())).toBe('application/pdf');
    expect(sniff(Buffer.from(' %PDF-1.4'))).toBeNull();
    expect(sniff(Buffer.from('RIFF0000WAVE'))).toBeNull();
    expect(sniff(Buffer.alloc(0))).toBeNull();
  });

  it('mergePhotos replaces a local uri in place and never duplicates', () => {
    const id = randomUUID();
    expect(mergePhotos(['a', 'b'], id, 'b')).toEqual(['a', photoRef(id)]);
    expect(mergePhotos(['a', photoRef(id)], id, 'a')).toEqual([photoRef(id)]);
    expect(mergePhotos([photoRef(id)], id)).toBeNull();
    expect(mergePhotos([], id)).toEqual([photoRef(id)]);
  });
});

// ── Spray certificate ─────────────────────────────────────────────────────────

describe('spray certificate', () => {
  const s1 = randomUUID(), s2 = randomUUID(), s3 = randomUUID(), h1 = randomUUID();
  it('renders a PDF for a block with sprays, a correction and a harvest', async () => {
    const r = await sync(managerA, {
      chemical_inventory: C([{ id: randomUUID(), chemical_id: 'captan-50wp', batch_no: 'CAP-2026-07', registration_no: 'CIR-12345/2019', quantity: 5, unit: 'kg', expiry_date: '2027-12-31' }]),
    });
    expect(r.body.ok).toBe(true);
    const sp = await sync(workerA, {
      spray_events: C([
        { id: s1, block_id: blockId, stage_id: 's04-pink-bud', sprayed_on: '2026-04-10', products: JSON.stringify([{ chemicalId: 'captan-50wp', dosePer100L: 300, unit: 'g', quantity: 1200 }]), total_litres: 400, tank_litres: 200 },
        { id: s2, block_id: blockId, stage_id: 's07-fruitlet', sprayed_on: '2026-05-15', products: JSON.stringify([{ chemicalId: 'dodine-65wp', dosePer100L: 75, unit: 'g', quantity: 300 }]) },
      ]),
    });
    expect(sp.body.ok).toBe(true);
    const corr = await sync(managerA, { spray_events: C([{ id: s3, block_id: blockId, stage_id: 's07-fruitlet', sprayed_on: '2026-05-16', products: JSON.stringify([{ chemicalId: 'dodine-65wp', dosePer100L: 75, unit: 'g', quantity: 300 }]), corrects_id: s2 }]) });
    expect(corr.body.ok).toBe(true);
    expect((await sync(workerA, { harvest_records: C([{ id: h1, block_id: blockId, picked_on: '2026-08-22', variety_id: 'gala-redlum', box_count: 100 }]) })).body.ok).toBe(true);

    const res = await app.inject({ method: 'GET', url: `/v1/reports/spray-certificate.pdf?blockId=${blockId}&season=2026`, headers: { authorization: `Bearer ${managerA}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('spray-certificate-HDP-1-2026.pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.rawPayload.subarray(-6).toString()).toContain('%%EOF');
    expect(res.rawPayload.length).toBeGreaterThan(2000);
  });

  it('is manager+ and tenant-scoped', async () => {
    expect((await call('GET', `/v1/reports/spray-certificate.pdf?blockId=${blockId}&season=2026`, workerA)).status).toBe(403);
    expect((await call('GET', `/v1/reports/spray-certificate.pdf?blockId=${blockId}&season=2026`, ownerB)).status).toBe(404);
    expect((await call('GET', `/v1/reports/spray-certificate.pdf?blockId=x&season=2026`, ownerA)).status).toBe(400);
    expect((await call('GET', `/v1/reports/spray-certificate.pdf?blockId=${blockId}&season=2026`)).status).toBe(401);
    // The existing report routes are untouched.
    expect((await call('GET', '/v1/reports/spray-log.csv?season=2026', managerA)).status).toBe(200);
  });

  it('computes days-before-harvest, PHI verdicts and supersession', () => {
    const base: CertificateInput = {
      season: 2026, generatedAt: new Date('2026-09-01T00:00:00Z'), tenantName: 'T',
      orchard: { name: 'O', district: null, tehsil: null, village: null, khasra_no: null, lat: null, lng: null, elevation_m: null, area_kanal: null },
      block: { id: 'blk-00000001', name: 'B', system_type: 'hdp', rootstock_id: 'm9-t337', training_system: null, planting_year: 2021, area_kanal: 2, tree_count: 100, variety_mix: [{ varietyId: 'gala-redlum', trees: 100 }], scab_resistant: false, full_bloom_date: null, expected_harvest_date: '2026-08-20' },
      sprays: [
        { id: 'a', sprayed_on: '2026-04-10', stage_id: 's04-pink-bud', products: [{ chemicalId: 'captan-50wp', dosePer100L: 300, unit: 'g', quantity: 1200, batches: [{ batchNo: 'B1', registrationNo: 'R1' }] }], tank_litres: 200, total_litres: 400, operator: 'Gulzar', violations: [], override_reason: null, corrects_id: null, notes: null },
        { id: 'b', sprayed_on: '2026-08-10', stage_id: null, products: [{ chemicalId: 'dodine-65wp' }], tank_litres: null, total_litres: null, operator: null, violations: [{ code: 'PHI_DEFACTO', severity: 'block' }], override_reason: null, corrects_id: null, notes: null },
        { id: 'c', sprayed_on: '2026-07-01', stage_id: null, products: [{ chemicalId: 'dodine-65wp' }], tank_litres: null, total_litres: null, operator: null, violations: [], override_reason: null, corrects_id: 'b', notes: null },
        { id: 'd', sprayed_on: '2026-08-12', stage_id: null, products: [{ chemicalId: 'calcium-chloride' }], tank_litres: null, total_litres: null, operator: null, violations: [], override_reason: null, corrects_id: null, notes: null },
      ],
      pickDates: [],
    };
    const m = buildCertificate(base, BUNDLE_2026);
    expect(m.harvest).toMatchObject({ date: '2026-08-20', basis: 'expected' });
    expect(m.sprays.find((s) => s.id === 'b')).toMatchObject({ superseded: true, supersededBy: 'c' });
    expect(m.lastSprayDate).toBe('2026-07-01');
    expect(m.daysBeforeHarvest).toBe(50);
    const dodine = m.phi.find((p) => p.chemicalId === 'dodine-65wp')!;
    expect(dodine).toMatchObject({ verdict: 'PASS', daysBeforeHarvest: 50 });
    expect(m.sprays[0]!.lines[0]).toMatchObject({ product: 'Captan 50 WP', groups: 'FRAC M04', batch: 'B1', registrationNo: 'R1', dose: '300 g/100 L' });
    expect(m.overall.verdict).toBe('COMPLIANT');

    // Without the correction the 10-day dodine spray fails its interval.
    const bad = buildCertificate({ ...base, sprays: base.sprays.filter((s) => s.id !== 'c'), pickDates: ['2026-08-18', '2026-08-25'] }, BUNDLE_2026);
    expect(bad.harvest).toMatchObject({ date: '2026-08-18', basis: 'recorded', picks: 2 });
    expect(bad.phi.find((p) => p.chemicalId === 'dodine-65wp')).toMatchObject({ verdict: 'FAIL', daysBeforeHarvest: 8, requiredDays: 22 });
    expect(bad.overall.verdict).toBe('NON_COMPLIANT');

    // Inside the 28-day stop window but beyond label PHI and the hard stop: warn.
    const warn = buildCertificate({ ...base, sprays: [{ ...base.sprays[0]!, sprayed_on: '2026-07-28' }] }, BUNDLE_2026);
    expect(warn.phi[0]).toMatchObject({ verdict: 'WARN', daysBeforeHarvest: 23 });
    expect(warn.overall.verdict).toBe('COMPLIANT_WITH_WARNINGS');

    const pending = buildCertificate({ ...base, block: { ...base.block, expected_harvest_date: null } }, BUNDLE_2026);
    expect(pending.overall.verdict).toBe('PENDING');
  });
});

// ── CSV import ────────────────────────────────────────────────────────────────

describe('csv import', () => {
  const post = (kind: string, csv: string, token: string, dryRun: boolean) =>
    call('POST', `/v1/import/${kind}?dryRun=${dryRun}`, token, csv, { 'content-type': 'text/csv' });

  it('parses RFC 4180 CSV and guards against formula injection on export', () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""",2\n\n"multi\nline",3\n')).toEqual([['a', 'b'], ['x, "y"', '2'], ['multi\nline', '3']]);
    expect(() => parseCsv('a\n"open')).toThrow(/unterminated/);
    expect(toCsv([['=SUM(A1)', '-5', 'a,b']])).toBe("'=SUM(A1),-5,\"a,b\"\r\n");
    expect(parseDate('05/04/2026')).toBe('2026-04-05');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(resolveChemical(BUNDLE_2026, 'Captan 50 WP')).toMatchObject({ ok: true, value: { id: 'captan-50wp' } });
    expect(resolveChemical(BUNDLE_2026, 'dodine-40sc')).toMatchObject({ ok: true, value: { id: 'dodine-40sc' } });
    expect(resolveChemical(BUNDLE_2026, 'tebuconazole + captan')).toMatchObject({ ok: true, value: { id: 'tebuconazole-captan-336sc' } });
    expect(resolveChemical(BUNDLE_2026, 'mancozeb')).toMatchObject({ ok: false });
    expect(resolveChemical(BUNDLE_2026, 'endosulfan-unknown')).toMatchObject({ ok: false });
  });

  it('serves templates for each kind', async () => {
    for (const k of ['orchards', 'blocks', 'spray_events', 'harvest_records']) {
      const r = await call('GET', `/v1/import/templates/${k}`, workerA);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('text/csv');
      expect(parseCsv(String(r.body)).length).toBeGreaterThanOrEqual(2);
    }
    expect((await call('GET', '/v1/import/templates/users', workerA)).status).toBe(400);
  });

  it('is manager+', async () => {
    expect((await post('orchards', 'name\nX', workerA, true)).status).toBe(403);
    expect((await call('POST', '/v1/import/orchards', undefined, 'name\nX', { 'content-type': 'text/csv' })).status).toBe(401);
  });

  it('dry-runs orchards with per-row errors and writes nothing', async () => {
    const csv = 'name,district,lat,lng,elevation_m\nKulgam Lower,Kulgam,33.64,75.01,1700\nShopian Upper,Shopian,33.7,74.8,2000\nBad Geo,Baramulla,12.0,74.0,\nKulgam Lower,Kulgam,,,\n';
    const r = await post('orchards', csv, managerA, true);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'orchards', dryRun: true, committed: false, summary: { rows: 4, valid: 1, invalid: 3 } });
    expect(r.body.rows[0]).toMatchObject({ row: 2, ok: true, preview: { name: 'Kulgam Lower', district: 'Kulgam', lat: 33.64 } });
    expect(r.body.rows[1].errors.join()).toMatch(/already exists/);
    expect(r.body.rows[2].errors.join()).toMatch(/lat must be between/);
    expect(r.body.rows[3].errors.join()).toMatch(/duplicate of row 2/);
    // A commit with errors is refused as a whole.
    const c = await post('orchards', csv, managerA, false);
    expect(c.status).toBe(422);
    expect(c.body.committed).toBe(false);
    expect((await pullAll(ownerA)).body.changes.orchards.created).toHaveLength(1);
    // Structural problems are a 400.
    expect((await post('orchards', 'district\nX', managerA, true)).status).toBe(400);
    expect((await post('orchards', 'name\n"broken', managerA, true)).status).toBe(400);
  });

  it('imports orchards and blocks by name (JSON body form)', async () => {
    const o = await call('POST', '/v1/import/orchards', managerA, { csv: 'name,district,lat,lng\nKulgam Lower,Kulgam,33.64,75.01\n', dryRun: false });
    expect(o.status).toBe(200);
    expect(o.body).toMatchObject({ committed: true, summary: { valid: 1, records: 1 } });
    const blocksCsv = toCsv([
      ['orchard', 'name', 'system_type', 'rootstock', 'varieties', 'tree_count', 'expected_harvest_date', 'drip'],
      ['Kulgam Lower', 'Trad-1', 'traditional', '', 'Red Delicious:300; Golden Delicious:60', '360', '2026-09-15', 'no'],
      ['kulgam lower', 'HDP-2', 'high density', 'M9 (T337)', 'Gala Redlum', '900', '20/08/2026', 'yes'],
      ['Nowhere', 'X', 'hdp', '', '', '', '', ''],
      ['Kulgam Lower', 'Y', 'pyramid', 'Mystery', 'Unknown Apple', '', '', 'maybe'],
    ]);
    const dry = await post('blocks', blocksCsv, managerA, true);
    expect(dry.body.summary).toMatchObject({ rows: 4, valid: 2, invalid: 2 });
    expect(dry.body.rows[2].errors).toEqual(['unknown orchard "Nowhere"']);
    expect(dry.body.rows[3].errors).toEqual(expect.arrayContaining([expect.stringMatching(/system_type/), expect.stringMatching(/unknown rootstock/), expect.stringMatching(/unknown variety/), expect.stringMatching(/drip must be yes or no/)]));
    const ok = await post('blocks', blocksCsv.split('\r\n').slice(0, 3).join('\r\n'), managerA, false);
    expect(ok.body).toMatchObject({ committed: true, summary: { records: 2 } });
    const blocks = (await pullAll(ownerA)).body.changes.blocks.created;
    const hdp2 = blocks.find((b: { name: string }) => b.name === 'HDP-2');
    expect(hdp2).toMatchObject({ system_type: 'hdp', rootstock_id: 'm9-t337', expected_harvest_date: '2026-08-20', drip: true });
    expect(JSON.parse(hdp2.variety_mix)).toEqual([{ varietyId: 'gala-redlum', trees: 0 }]);
    // Importing the same file again: names now exist.
    expect((await post('blocks', blocksCsv.split('\r\n').slice(0, 3).join('\r\n'), managerA, true)).body.rows[0].errors.join()).toMatch(/already exists/);
  });

  it('dry-runs and imports sprays through the sync rules (locking, compliance flags, operator, tank mixes)', async () => {
    const csv = toCsv([
      ['orchard', 'block', 'sprayed_on', 'stage', 'product', 'dose_per_100l', 'unit', 'quantity', 'total_litres', 'tank_litres', 'operator', 'spray_ref', 'notes'],
      ['Kulgam Lower', 'HDP-2', '2026-04-12', 'Pink Bud', 'Captan 50 WP', '300', 'g', '', '400', '200', 'Gulzar Ahmad', 'p1', 'calm'],
      ['Kulgam Lower', 'HDP-2', '2026-04-12', 'Pink Bud', 'hexaconazole', '50', 'ml', '', '400', '200', 'Gulzar Ahmad', 'p1', ''],
      ['Kulgam Lower', 'HDP-2', '12/08/2026', '', 'Dodine 65 WP', '75', 'g', '200', '', '', '9419100010', '', ''],
      ['', 'HDP-2', '2026-05-01', 'Petal Fall', 'Mystery Juice', '10', 'ml', '', '', '', '', '', ''],
      ['', 'HDP-1', '2099-01-01', '', 'captan-50wp', '', '', '', '', '', '', '', ''],
    ]);
    const dry = await post('spray_events', csv, managerA, true);
    expect(dry.status).toBe(200);
    expect(dry.body.summary).toMatchObject({ rows: 5, valid: 3, invalid: 2 });
    expect(dry.body.rows[0].preview).toMatchObject({ product: 'Captan 50 WP', chemicalId: 'captan-50wp', quantity: 1200, spray: '2-product tank mix' });
    expect(dry.body.rows[1].preview).toMatchObject({ chemicalId: 'hexaconazole-5ec' });
    expect(dry.body.rows[2].warnings.join()).toMatch(/compliance flag PHI_DEFACTO/);
    expect(dry.body.rows[3].errors.join()).toMatch(/unknown product "Mystery Juice"/);
    expect(dry.body.rows[4].errors.join()).toMatch(/future/);
    const before = (await pullAll(ownerA)).body.changes.spray_events.created.length;
    const good = csv.split('\r\n').slice(0, 4).join('\r\n');
    const done = await post('spray_events', good, managerA, false);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ committed: true, summary: { records: 2, valid: 3 } });
    const after = (await pullAll(ownerA)).body.changes.spray_events.created;
    expect(after.length).toBe(before + 2);
    const mix = after.find((s: { sprayed_on: string; block_id: string }) => s.sprayed_on === '2026-04-12');
    expect(mix.locked).toBe(true);
    expect(mix.stage_id).toBe('s04-pink-bud');
    expect(JSON.parse(mix.products).map((p: { chemicalId: string }) => p.chemicalId)).toEqual(['captan-50wp', 'hexaconazole-5ec']);
    const late = after.find((s: { sprayed_on: string }) => s.sprayed_on === '2026-08-12');
    expect(JSON.parse(late.violations).map((v: { code: string }) => v.code)).toContain('PHI_DEFACTO');
    expect(late.operator_user_id).toBeTruthy();
    expect(mix.operator_user_id).toBe(late.operator_user_id);
    // Re-importing warns about duplicates.
    const again = await post('spray_events', good, managerA, true);
    expect(again.body.rows[0].warnings.join()).toMatch(/already recorded/);
  });

  it('imports harvest records', async () => {
    const csv = toCsv([
      ['orchard', 'block', 'picked_on', 'variety', 'grade', 'box_type', 'box_count', 'mandi', 'price_per_box_inr', 'starch_index'],
      ['Kulgam Lower', 'HDP-2', '2026-08-25', 'Gala Redlum', 'a', 'Wooden box', '120', 'Sopore', '950', '3.5'],
      ['Kulgam Lower', 'HDP-2', '2026-08-26', 'Gala Redlum', 'Z', 'sack', 'many', '', '', '12'],
    ]);
    const dry = await post('harvest_records', csv, managerA, true);
    expect(dry.body.rows[0]).toMatchObject({ ok: true, preview: { grade: 'A', box_type: 'wooden', kg: 2040 } });
    expect(dry.body.rows[1].errors).toHaveLength(4);
    const ok = await post('harvest_records', csv.split('\r\n').slice(0, 2).join('\r\n'), managerA, false);
    expect(ok.body.committed).toBe(true);
    const h = (await pullAll(ownerA)).body.changes.harvest_records.created.find((x: { picked_on: string }) => x.picked_on === '2026-08-25');
    expect(h).toMatchObject({ box_count: 120, mandi: 'Sopore', locked: true, variety_id: 'gala-redlum' });
    // Tenant B sees none of it.
    expect((await pullAll(ownerB)).body.changes.harvest_records.created).toHaveLength(0);
    expect((await post('harvest_records', csv, ownerB, true)).body.rows[0].errors.join()).toMatch(/unknown orchard/);
  });
});
