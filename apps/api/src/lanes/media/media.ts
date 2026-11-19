import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { authenticate, requireRole, who } from '../../auth.js';
import { withTenant, type Db, type Tx } from '../../db.js';
import type { MediaConfig } from './config.js';
import { isMediaType, kindFor, sniff, type MediaType } from './magic.js';
import { extensionFor, storageKey, type StorageDriver } from './storage.js';
import type { MediaTokens } from './tokens.js';

/** Tables a media object may be attached to. Those with a `photos` json column get the reference written in. */
export const ENTITY_TABLES = ['scouting_observations', 'chemical_inventory', 'spray_events', 'harvest_records', 'orchards', 'blocks', 'tasks'] as const;
const PHOTO_TABLES = new Set(['scouting_observations', 'chemical_inventory']);

/**
 * The value stored in a record's `photos` array. Key order matches Postgres jsonb's canonical
 * order (shorter keys first) so the field-merge union in sync dedupes server- and device-written
 * copies of the same reference.
 */
export interface PhotoRef { url: string; mediaId: string }
export const photoRef = (mediaId: string): PhotoRef => ({ url: `/v1/media/${mediaId}`, mediaId });

export interface MediaDeps { db: Db; cfg: MediaConfig; storage: StorageDriver; tokens: MediaTokens }

interface MediaRow { id: string; kind: string; content_type: MediaType; bytes: number; sha256: string; storage_key: string; entity_table: string | null; entity_id: string | null; created_at: Date }

const idParam = z.object({ id: z.string().uuid() });
const linkFields = z
  .object({
    entityTable: z.enum(ENTITY_TABLES).optional(),
    entityId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
    /** Local URI (device) this upload replaces inside the entity's `photos` array. */
    replaces: z.string().min(1).max(2000).optional(),
  })
  .refine((v) => !v.entityTable === !v.entityId, { message: 'entityTable and entityId go together' })
  .refine((v) => !v.replaces || !!v.entityTable, { message: 'replaces requires an entity' });

export const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export function registerMediaRoutes(app: FastifyInstance, d: MediaDeps) {
  const { db, cfg, storage, tokens } = d;

  const signed = async (tenantId: string, id: string) => {
    const { token, expiresAt } = await tokens.sign({ mediaId: id, tenantId });
    return { signedUrl: `/v1/media/${id}?t=${encodeURIComponent(token)}`, expiresAt };
  };
  const view = async (tenantId: string, m: MediaRow) => ({
    id: m.id,
    ...photoRef(m.id),
    kind: m.kind,
    contentType: m.content_type,
    bytes: m.bytes,
    sha256: m.sha256,
    entityTable: m.entity_table,
    entityId: m.entity_id,
    createdAt: m.created_at instanceof Date ? m.created_at.toISOString() : m.created_at,
    ...(await signed(tenantId, m.id)),
  });

  // ── Upload ────────────────────────────────────────────────────────────────
  app.post('/v1/media', { preHandler: authenticate }, async (req, reply) => {
    const p = who(req);
    if (!req.isMultipart()) throw httpError(415, 'expected multipart/form-data with a "file" part');
    const fields: Record<string, string> = {};
    let file: { buffer: Buffer; mimetype: string; filename: string } | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (file) throw httpError(400, 'one file per upload');
        const f = part as MultipartFile;
        // toBuffer() rejects with a 413 once the configured fileSize limit is crossed.
        file = { buffer: await f.toBuffer(), mimetype: f.mimetype, filename: f.filename };
      } else if (typeof part.value === 'string') fields[part.fieldname] = part.value;
    }
    if (!file) throw httpError(400, 'missing "file" part');
    const q = req.query as Record<string, unknown>;
    const link = linkFields.parse({
      entityTable: fields.entityTable ?? q.entityTable,
      entityId: fields.entityId ?? q.entityId,
      replaces: fields.replaces ?? q.replaces,
    });
    const body = file.buffer;
    if (!body.length) throw httpError(400, 'empty file');
    if (body.length > cfg.maxBytes) throw httpError(413, 'file too large');
    const detected = sniff(body);
    if (!detected) throw httpError(415, 'unsupported file type: only JPEG, PNG, WebP and PDF are accepted');
    const declared = file.mimetype.toLowerCase().split(';')[0]!.trim();
    if (isMediaType(declared) && declared !== detected) throw httpError(415, `content does not match declared type ${declared}`);
    if (!isMediaType(declared) && declared !== 'application/octet-stream' && declared !== '') throw httpError(415, `unsupported declared type ${declared}`);
    const sha256 = createHash('sha256').update(body).digest('hex');

    // Same bytes already stored for this tenant (e.g. a retried mobile upload): reuse it.
    const existing = await withTenant(db, p.tenantId, async (tx) => {
      const { rows: [m] } = await tx.query<MediaRow>('SELECT * FROM public.media WHERE sha256 = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [sha256]);
      if (m && link.entityTable) await attach(tx, link.entityTable, link.entityId!, m.id, link.replaces);
      return m;
    });
    if (existing) return reply.code(200).send({ ...(await view(p.tenantId, existing)), deduplicated: true });

    const key = storageKey(p.tenantId, detected);
    await storage.put(key, body, detected);
    try {
      const m = await withTenant(db, p.tenantId, async (tx) => {
        const { rows: [row] } = await tx.query<MediaRow>(
          `INSERT INTO public.media (tenant_id, kind, content_type, bytes, sha256, storage_key, entity_table, entity_id, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [p.tenantId, kindFor(detected), detected, body.length, sha256, key, link.entityTable ?? null, link.entityId ?? null, p.userId],
        );
        if (link.entityTable) await attach(tx, link.entityTable, link.entityId!, row!.id, link.replaces);
        return row!;
      });
      return reply.code(201).send({ ...(await view(p.tenantId, m)), deduplicated: false });
    } catch (e) {
      await storage.remove(key).catch(() => {});
      throw e;
    }
  });

  // ── Batch signed links (thumbnails) ───────────────────────────────────────
  app.get('/v1/media/links', { preHandler: authenticate }, async (req) => {
    const p = who(req);
    const { ids } = z.object({ ids: z.string().max(4000) }).parse(req.query);
    const list = [...new Set(ids.split(',').map((s) => s.trim()).filter(Boolean))];
    if (list.length > 100) throw httpError(400, 'at most 100 ids');
    const parsed = z.array(z.string().uuid()).parse(list);
    const rows = await withTenant(db, p.tenantId, async (tx) =>
      (await tx.query<{ id: string }>('SELECT id FROM public.media WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL', [parsed])).rows);
    const links: Record<string, { signedUrl: string; expiresAt: string }> = {};
    for (const r of rows) links[r.id] = await signed(p.tenantId, r.id);
    return { links };
  });

  // ── List by entity ────────────────────────────────────────────────────────
  app.get('/v1/media', { preHandler: authenticate }, async (req) => {
    const p = who(req);
    const q = z.object({ entityTable: z.enum(ENTITY_TABLES), entityId: z.string().min(8).max(64) }).parse(req.query);
    const rows = await withTenant(db, p.tenantId, async (tx) =>
      (await tx.query<MediaRow>('SELECT * FROM public.media WHERE entity_table = $1 AND entity_id = $2 AND deleted_at IS NULL ORDER BY created_at', [q.entityTable, q.entityId])).rows);
    return { media: await Promise.all(rows.map((m) => view(p.tenantId, m))) };
  });

  // ── Metadata + fresh signed link ──────────────────────────────────────────
  app.get('/v1/media/:id/meta', { preHandler: authenticate }, async (req, reply) => {
    const p = who(req);
    const { id } = idParam.parse(req.params);
    const m = await withTenant(db, p.tenantId, async (tx) => (await tx.query<MediaRow>('SELECT * FROM public.media WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0]);
    if (!m) return reply.code(404).send({ error: 'not found' });
    return view(p.tenantId, m);
  });

  // ── Download: Bearer token OR short-lived signed `?t=` ────────────────────
  app.get('/v1/media/:id', async (req, reply) => {
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) return reply.code(404).send({ error: 'not found' });
    const { id } = parsed.data;
    const t = (req.query as Record<string, unknown>).t;
    let tenantId: string;
    if (typeof t === 'string' && t) {
      const grant = await tokens.verify(t, id);
      if (!grant) return reply.code(401).send({ error: 'link expired or invalid' });
      tenantId = grant.tenantId;
    } else {
      await authenticate(req, reply);
      if (reply.sent) return reply;
      tenantId = who(req).tenantId;
    }
    const m = await withTenant(db, tenantId, async (tx) => (await tx.query<MediaRow>('SELECT * FROM public.media WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0]);
    if (!m) return reply.code(404).send({ error: 'not found' });
    return serve(req, reply, m);
  });

  const serve = async (req: FastifyRequest, reply: FastifyReply, m: MediaRow) => {
    const filename = `${m.id}.${extensionFor(m.content_type)}`;
    if (storage.presign) {
      const url = await storage.presign(m.storage_key, cfg.presignTtlSec, { contentType: m.content_type, filename });
      return reply.code(302).header('cache-control', 'no-store').redirect(url);
    }
    const etag = `"${m.sha256}"`;
    reply
      .header('content-type', m.content_type)
      .header('cache-control', 'private, max-age=86400, immutable')
      .header('etag', etag)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('content-disposition', `inline; filename="${filename}"`);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    let stream;
    try {
      stream = await storage.read(m.storage_key);
    } catch {
      req.log.error({ mediaId: m.id }, 'media object missing from storage');
      return reply.code(404).header('content-type', 'application/json').send({ error: 'not found' });
    }
    return reply.header('content-length', m.bytes).send(stream);
  };

  // ── Delete (manager+) ─────────────────────────────────────────────────────
  app.delete('/v1/media/:id', { preHandler: [authenticate, requireRole('manager')] }, async (req, reply) => {
    const p = who(req);
    const { id } = idParam.parse(req.params);
    const m = await withTenant(db, p.tenantId, async (tx) => {
      const { rows: [row] } = await tx.query<MediaRow>('UPDATE public.media SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *', [id]);
      if (row?.entity_table && row.entity_id) await detach(tx, row.entity_table, row.entity_id, row.id);
      return row;
    });
    if (!m) return reply.code(404).send({ error: 'not found' });
    await storage.remove(m.storage_key).catch((e) => req.log.warn({ err: e, mediaId: id }, 'media object removal failed'));
    return reply.code(204).send();
  });
}

const ident = (t: string) => {
  if (!PHOTO_TABLES.has(t)) throw new Error('not a photo table');
  return `public.${t}`;
};

type PhotoEntry = string | { url?: string; mediaId?: string } | null;

/** Write the reference into the entity's `photos` array, replacing the device's local URI if given. */
async function attach(tx: Tx, table: string, entityId: string, mediaId: string, replaces?: string) {
  if (!PHOTO_TABLES.has(table)) return;
  const { rows: [r] } = await tx.query<{ photos: PhotoEntry[] | null }>(`SELECT photos FROM ${ident(table)} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [entityId]);
  // The record may not have synced yet: the device writes the reference itself on its next push.
  if (!r) return;
  const next = mergePhotos(Array.isArray(r.photos) ? r.photos : [], mediaId, replaces);
  if (next) await tx.query(`UPDATE ${ident(table)} SET photos = $2::jsonb WHERE id = $1`, [entityId, JSON.stringify(next)]);
}

async function detach(tx: Tx, table: string, entityId: string, mediaId: string) {
  if (!PHOTO_TABLES.has(table)) return;
  const { rows: [r] } = await tx.query<{ photos: PhotoEntry[] | null }>(`SELECT photos FROM ${ident(table)} WHERE id = $1 FOR UPDATE`, [entityId]);
  if (!r || !Array.isArray(r.photos)) return;
  const next = r.photos.filter((x) => !(x && typeof x === 'object' && x.mediaId === mediaId));
  if (next.length !== r.photos.length) await tx.query(`UPDATE ${ident(table)} SET photos = $2::jsonb WHERE id = $1`, [entityId, JSON.stringify(next)]);
}

/** Pure: returns the new photos array, or null when nothing changes. */
export function mergePhotos(current: PhotoEntry[], mediaId: string, replaces?: string): PhotoEntry[] | null {
  const ref = photoRef(mediaId);
  const has = current.some((x) => x && typeof x === 'object' && x.mediaId === mediaId);
  const idx = replaces ? current.findIndex((x) => x === replaces) : -1;
  if (idx >= 0) {
    const next = [...current];
    if (has) next.splice(idx, 1);
    else next[idx] = ref;
    return next;
  }
  return has ? null : [...current, ref];
}
