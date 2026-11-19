import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { authenticate, requireRole, who } from '../../auth.js';
import { withTenant, type Db } from '../../db.js';
import { currentReference } from '../../reference.js';
import { loadMediaConfig, type MediaConfig } from './config.js';
import { createStorage, type StorageDriver } from './storage.js';
import { MediaTokens } from './tokens.js';
import { registerMediaRoutes } from './media.js';
import { buildCertificate, loadCertificateInput, renderCertificatePdf } from './certificate.js';
import { IMPORT_KINDS, MAX_IMPORT_ROWS, runImport, templateCsv } from './importer.js';

export interface MediaLaneOptions {
  config?: MediaConfig;
  storage?: StorageDriver;
}

/** Media & documents lane: photo storage, spray certificate PDF, CSV import. Every route authenticates itself. */
export async function register(app: FastifyInstance, db: Db, opts: MediaLaneOptions = {}): Promise<void> {
  const cfg = opts.config ?? loadMediaConfig();
  const storage = opts.storage ?? createStorage(cfg);
  const tokens = new MediaTokens(cfg.signingSecret, cfg.signedUrlTtlSec);

  // Multipart parsing is scoped to this lane's encapsulated context only.
  await app.register(multipart, { limits: { fileSize: cfg.maxBytes, files: 1, fields: 10, fieldSize: 4096, parts: 12, headerPairs: 200 } });
  app.addContentTypeParser(['text/csv', 'application/csv', 'text/plain'], { parseAs: 'string', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  registerMediaRoutes(app, { db, cfg, storage, tokens });

  // ── Spray certificate (manager+) ─────────────────────────────────────────
  app.get('/v1/reports/spray-certificate.pdf', { preHandler: [authenticate, requireRole('manager')] }, async (req, reply) => {
    const q = z.object({
      blockId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
      season: z.coerce.number().int().min(2020).max(2100).default(new Date().getUTCFullYear()),
    }).parse(req.query);
    const { bundle } = await currentReference(db);
    const now = new Date();
    const input = await withTenant(db, who(req).tenantId, (tx) => loadCertificateInput(tx, q.blockId, q.season, now));
    if (!input) return reply.code(404).send({ error: 'block not found' });
    const pdf = await renderCertificatePdf(buildCertificate(input, bundle));
    const safeName = input.block.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'block';
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="spray-certificate-${safeName}-${q.season}.pdf"`)
      .header('cache-control', 'no-store')
      .send(pdf);
  });

  // ── CSV import (manager+) ────────────────────────────────────────────────
  const kindParam = z.object({ kind: z.enum(IMPORT_KINDS) });

  app.get('/v1/import/templates/:kind', { preHandler: authenticate }, async (req, reply) => {
    const { kind } = kindParam.parse(req.params);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="seb-orchard-${kind}-template.csv"`)
      .send(templateCsv(kind));
  });

  app.post('/v1/import/:kind', { preHandler: [authenticate, requireRole('manager')] }, async (req, reply) => {
    const { kind } = kindParam.parse(req.params);
    const q = z.object({ dryRun: z.enum(['true', 'false', '1', '0']).optional() }).parse(req.query);
    let csv: string;
    let dryRunBody: boolean | undefined;
    if (typeof req.body === 'string') csv = req.body;
    else {
      const b = z.object({ csv: z.string().min(1).max(5 * 1024 * 1024), dryRun: z.boolean().optional() }).parse(req.body);
      csv = b.csv;
      dryRunBody = b.dryRun;
    }
    // Default to a dry run: committing has to be asked for explicitly.
    const dryRun = q.dryRun != null ? q.dryRun === 'true' || q.dryRun === '1' : dryRunBody ?? true;
    const { bundle } = await currentReference(db);
    const result = await runImport(db, who(req), kind, csv, dryRun, bundle);
    return reply.code(!dryRun && !result.committed ? 422 : 200).send({ ...result, maxRows: MAX_IMPORT_ROWS });
  });
}
