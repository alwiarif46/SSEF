import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import {
  SYNC_SCHEMA_VERSION, currentStage, planStage, validateSpray, diseaseRisks, wetnessProgress, ascosporeMaturity,
  cumulativeDegreeDaysBase0, accumulateDD, dailySummaries, detectBiofix, istDay, nextStage, regulatoryImpact,
} from '@orchard/domain';
import { authenticate, hashPassword, issueToken, requireRole, verifyPassword, who } from './auth.js';
import { withTenant, withoutTenant, type Db } from './db.js';
import { pull, push, type Changes } from './sync/sync.js';
import { currentReference } from './reference.js';
import { loadHours } from './worker.js';
import { advisoryLinks } from './advisories.js';

const phone = z.string().regex(/^\+?[0-9]{10,13}$/, 'phone must be 10–13 digits');
const password = z.string().min(8).max(128);

export function buildApp(db: Db, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 10 * 1024 * 1024 });
  void app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'validation', issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'internal' : err.message });
  });

  app.get('/health', async () => ({ ok: true }));

  // ── Auth ─────────────────────────────────────────────────────────────────
  // Naive in-memory login throttle (per phone); production: put behind a shared rate limiter.
  const attempts = new Map<string, { n: number; until: number }>();

  app.post('/v1/auth/signup', async (req, reply) => {
    const b = z.object({ tenantName: z.string().min(2).max(120), name: z.string().min(2).max(120), phone, password, district: z.string().max(60).optional() }).parse(req.body);
    const hash = await hashPassword(b.password);
    const r = await withoutTenant(db, async (tx) => {
      if ((await tx.query('SELECT app.phone_taken($1) AS t', [b.phone])).rows[0].t) return null;
      return (await tx.query('SELECT * FROM app.create_tenant_with_owner($1,$2,$3,$4,$5)', [b.tenantName, b.name, b.phone, hash, b.district ?? null])).rows[0];
    });
    if (!r) return reply.code(409).send({ error: 'phone already registered' });
    const token = await issueToken({ userId: r.user_id, tenantId: r.tenant_id, role: 'owner' });
    return reply.code(201).send({ token, user: { id: r.user_id, name: b.name, role: 'owner', phone: b.phone }, tenant: { id: r.tenant_id, name: b.tenantName } });
  });

  app.post('/v1/auth/login', async (req, reply) => {
    const b = z.object({ phone, password: z.string().max(128) }).parse(req.body);
    const a = attempts.get(b.phone);
    if (a && a.until > Date.now()) return reply.code(429).send({ error: 'too many attempts, try later' });
    const u = await withoutTenant(db, async (tx) => (await tx.query('SELECT * FROM app.auth_lookup($1)', [b.phone])).rows[0]);
    if (!u || !u.active || !(await verifyPassword(b.password, u.password_hash))) {
      const n = (a?.n ?? 0) + 1;
      attempts.set(b.phone, { n, until: n >= 5 ? Date.now() + 15 * 60_000 : 0 });
      return reply.code(401).send({ error: 'invalid phone or password' });
    }
    attempts.delete(b.phone);
    const token = await issueToken({ userId: u.id, tenantId: u.tenant_id, role: u.role });
    return { token, user: { id: u.id, name: u.name, role: u.role, phone: b.phone } };
  });

  // Everything below requires a token.
  app.register(async (r) => {
    r.addHook('preHandler', authenticate);

    r.get('/v1/me', async (req) => {
      const p = who(req);
      return withTenant(db, p.tenantId, async (tx) => ({
        user: (await tx.query('SELECT id, name, phone, role, language FROM public.users WHERE id = $1', [p.userId])).rows[0],
        tenant: (await tx.query('SELECT id, name, plan, billing_status, district FROM public.tenants')).rows[0],
      }));
    });

    r.get('/v1/users', { preHandler: requireRole('manager') }, async (req) =>
      withTenant(db, who(req).tenantId, async (tx) => (await tx.query('SELECT id, name, phone, role, active FROM public.users ORDER BY role, name')).rows),
    );

    r.post('/v1/users', { preHandler: requireRole('owner') }, async (req, reply) => {
      const p = who(req);
      const b = z.object({ name: z.string().min(2).max(120), phone, password, role: z.enum(['manager', 'worker']) }).parse(req.body);
      const hash = await hashPassword(b.password);
      const created = await withTenant(db, p.tenantId, async (tx) => {
        if ((await tx.query('SELECT app.phone_taken($1) AS t', [b.phone])).rows[0].t) return null;
        return (await tx.query('INSERT INTO public.users (tenant_id, name, phone, role, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, phone, role', [p.tenantId, b.name, b.phone, b.role, hash])).rows[0];
      });
      if (!created) return reply.code(409).send({ error: 'phone already registered' });
      return reply.code(201).send(created);
    });

    r.patch('/v1/users/:id', { preHandler: requireRole('owner') }, async (req) => {
      const p = who(req);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const b = z.object({ active: z.boolean().optional(), role: z.enum(['manager', 'worker']).optional() }).parse(req.body);
      return withTenant(db, p.tenantId, async (tx) => (await tx.query(
        `UPDATE public.users SET active = coalesce($2, active), role = coalesce($3, role) WHERE id = $1 AND role <> 'owner' RETURNING id, name, role, active`,
        [id, b.active ?? null, b.role ?? null],
      )).rows[0] ?? { error: 'not found' });
    });

    r.post('/v1/push-tokens', async (req) => {
      const p = who(req);
      const b = z.object({ token: z.string().min(10).max(300), platform: z.enum(['ios', 'android', 'web']).optional() }).parse(req.body);
      await withTenant(db, p.tenantId, (tx) => tx.query(
        `INSERT INTO public.push_tokens (tenant_id, user_id, token, platform) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, token) DO UPDATE SET user_id = EXCLUDED.user_id`,
        [p.tenantId, p.userId, b.token, b.platform ?? null],
      ));
      return { ok: true };
    });

    // ── Reference data ──────────────────────────────────────────────────────
    r.get('/v1/reference/current', async (req, reply) => {
      const ref = await currentReference(db);
      reply.header('etag', `"${ref.etag}"`).header('cache-control', 'private, max-age=300');
      if (req.headers['if-none-match'] === `"${ref.etag}"`) return reply.code(304).send();
      return ref.bundle;
    });
    r.get('/v1/reference/impact', async () => regulatoryImpact((await currentReference(db)).bundle));
    r.get('/v1/reference/versions', async () =>
      withoutTenant(db, async (tx) => (await tx.query('SELECT version_id, season, status, published_at FROM public.reference_bundles ORDER BY season DESC')).rows),
    );

    // ── Sync ────────────────────────────────────────────────────────────────
    const syncQ = z.object({ last_pulled_at: z.coerce.number().int().min(0).default(0), schema_version: z.coerce.number().int().optional() });
    r.get('/v1/sync', async (req, reply) => {
      const q = syncQ.parse(req.query);
      if (q.schema_version != null && q.schema_version > SYNC_SCHEMA_VERSION) return reply.code(409).send({ error: 'client schema newer than server' });
      return withTenant(db, who(req).tenantId, (tx) => pull(tx, q.last_pulled_at));
    });
    r.post('/v1/sync', async (req) => {
      const q = syncQ.parse(req.query);
      const body = z.object({ changes: z.record(z.object({ created: z.array(z.any()).default([]), updated: z.array(z.any()).default([]), deleted: z.array(z.string()).default([]) })) }).parse(req.body);
      const p = who(req);
      const { bundle } = await currentReference(db);
      return withTenant(db, p.tenantId, (tx) => push(tx, p, body.changes as Changes, q.last_pulled_at, bundle));
    });

    // ── Intelligence ────────────────────────────────────────────────────────
    r.get('/v1/orchards/:id/weather', async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const { days } = z.object({ days: z.coerce.number().int().min(1).max(60).default(7) }).parse(req.query);
      return withTenant(db, who(req).tenantId, async (tx) => {
        const hours = await loadHours(tx, id, new Date(Date.now() - days * 86_400_000));
        return { hours, daily: dailySummaries(hours) };
      });
    });

    r.get('/v1/orchards/:id/risk', async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const p = who(req);
      const { bundle } = await currentReference(db);
      return withTenant(db, p.tenantId, async (tx) => {
        const { rows: [o] } = await tx.query('SELECT id, elevation_m FROM public.orchards WHERE id = $1 AND deleted_at IS NULL', [id]);
        if (!o) return reply.code(404).send({ error: 'not found' });
        const now = new Date();
        const year = now.getUTCFullYear();
        const season = await loadHours(tx, id, new Date(`${year}-02-01T00:00:00Z`));
        const observed = season.filter((h) => !h.isForecast);
        const { rows: gt } = await tx.query(
          `SELECT min(observed_on) AS d FROM public.phenology_observations ph JOIN public.blocks b ON b.id = ph.block_id WHERE b.orchard_id = $1 AND ph.stage_id = 's02-green-tip' AND ph.deleted_at IS NULL AND observed_on >= $2`,
          [id, `${year}-01-01`],
        );
        const greenTip = gt[0]?.d ? `${gt[0].d}T00:00:00.000Z` : undefined;
        const cdd = greenTip ? cumulativeDegreeDaysBase0(observed, greenTip) : undefined;
        const { rows: traps } = await tx.query('SELECT caught_on, moths, sunset_temp_c FROM public.trap_catches WHERE orchard_id = $1 AND deleted_at IS NULL AND caught_on >= $2', [id, `${year}-01-01`]);
        const biofix = detectBiofix(traps.map((t) => ({ date: t.caught_on, moths: Number(t.moths), ...(t.sunset_temp_c != null ? { sunsetTempC: Number(t.sunset_temp_c) } : {}) })));
        const dd = biofix ? accumulateDD(dailySummaries(observed), biofix).at(-1)?.cumulative ?? 0 : undefined;
        const today = istDay(now);
        return {
          stage: currentStage(bundle.stages, today, o.elevation_m != null ? { elevationM: o.elevation_m } : {}) ?? null,
          next: nextStage(bundle.stages, today, o.elevation_m ?? undefined) ?? null,
          scab: {
            wetness: wetnessProgress(observed, now.toISOString(), greenTip ? { greenTip } : { primarySeason: [`${year}-03-15`, `${year}-05-15`] }),
            greenTip: greenTip ?? null,
            cdd: cdd != null ? Math.round(cdd) : null,
            ascosporeMaturity: cdd != null ? Math.round(ascosporeMaturity(cdd) * 1000) / 1000 : null,
            advisory: true,
          },
          codlingMoth: { biofix, degreeDaysF: dd != null ? Math.round(dd) : null },
          risks: diseaseRisks(observed),
        };
      });
    });

    r.get('/v1/blocks/:id/plan', async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), tank: z.coerce.number().positive().max(20000).default(200), stage: z.string().optional() }).parse(req.query);
      const p = who(req);
      const { bundle } = await currentReference(db);
      return withTenant(db, p.tenantId, async (tx) => {
        const { rows: [b] } = await tx.query(
          `SELECT b.*, o.elevation_m FROM public.blocks b JOIN public.orchards o ON o.id = b.orchard_id WHERE b.id = $1 AND b.deleted_at IS NULL`, [id]);
        if (!b) return reply.code(404).send({ error: 'not found' });
        const date = q.date ?? istDay(new Date());
        const stage = q.stage ? bundle.stages.find((s) => s.id === q.stage) : currentStage(bundle.stages, date, { ...(b.elevation_m != null ? { elevationM: b.elevation_m } : {}), ...(b.observed_stage_id ? { observedStageId: b.observed_stage_id } : {}) });
        if (!stage) return reply.code(404).send({ error: 'no stage for date' });
        const { rows: hist } = await tx.query('SELECT sprayed_on, products FROM public.spray_events WHERE block_id = $1 AND deleted_at IS NULL ORDER BY sprayed_on', [id]);
        const { rows: scout } = await tx.query(
          `SELECT pest_id, metric, value FROM public.scouting_observations WHERE block_id = $1 AND deleted_at IS NULL AND observed_on >= ($2::date - 10) ORDER BY observed_on DESC`, [id, date]);
        const mites = scout.find((s) => /mite/.test(s.pest_id))?.value;
        const thrips = scout.find((s) => s.pest_id === 'blossom-thrips')?.value;
        const hours = await loadHours(tx, b.orchard_id, new Date());
        const rain = hours.filter((h) => Date.parse(h.time) <= Date.now() + 48 * 3_600_000).reduce((s, h) => s + h.precipMm, 0);
        const fungIds = new Set(bundle.chemicals.filter((c) => c.category === 'fungicide').map((c) => c.id));
        const lastF = [...hist].reverse().find((h) => (h.products ?? []).some((x: { chemicalId: string }) => fungIds.has(x.chemicalId)));
        const plan = planStage(bundle, stage.id, {
          date, system: b.system_type === 'hdp' ? 'hdp' : 'traditional', scabResistant: !!b.scab_resistant, tankLitres: q.tank,
          ...(b.expected_harvest_date ? { plannedHarvestDate: b.expected_harvest_date } : {}),
          history: hist.map((h) => ({ date: h.sprayed_on, chemicalIds: (h.products ?? []).map((x: { chemicalId: string }) => x.chemicalId) })),
          scouting: { ...(mites != null ? { mitesPerLeaf: Number(mites) } : {}), ...(thrips != null ? { thripsPerFlower: Number(thrips) } : {}), observedTargets: scout.map((s) => s.pest_id) },
          ...(hours.length ? { rainForecastMm48h: rain } : {}),
          ...(lastF ? { daysSinceFungicide: Math.round((Date.parse(date) - Date.parse(lastF.sprayed_on)) / 86_400_000) } : {}),
        });
        return { stage, scheduleVersion: bundle.version, disclaimer: bundle.version.disclaimer, plan };
      });
    });

    r.post('/v1/spray/validate', async (req) => {
      const b = z.object({ blockId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), chemicalIds: z.array(z.string()).min(1).max(10), stageId: z.string().optional() }).parse(req.body);
      const { bundle } = await currentReference(db);
      return withTenant(db, who(req).tenantId, async (tx) => {
        const { rows: hist } = await tx.query('SELECT sprayed_on, products FROM public.spray_events WHERE block_id = $1 AND deleted_at IS NULL', [b.blockId]);
        const { rows: [blk] } = await tx.query('SELECT expected_harvest_date FROM public.blocks WHERE id = $1', [b.blockId]);
        return validateSpray(
          { date: b.date, chemicalIds: b.chemicalIds, ...(b.stageId ? { stageId: b.stageId } : {}), ...(blk?.expected_harvest_date ? { plannedHarvestDate: blk.expected_harvest_date } : {}) },
          hist.map((h) => ({ date: h.sprayed_on, chemicalIds: (h.products ?? []).map((x: { chemicalId: string }) => x.chemicalId) })),
          bundle,
        );
      });
    });

    r.get('/v1/advisories/:district', async (req) => advisoryLinks(z.object({ district: z.string().max(40) }).parse(req.params).district));

    // ── Reports ─────────────────────────────────────────────────────────────
    r.get('/v1/reports/spray-log.csv', { preHandler: requireRole('manager') }, async (req, reply) => {
      const q = z.object({ season: z.coerce.number().int().min(2020).max(2100).default(new Date().getUTCFullYear()), orchardId: z.string().optional() }).parse(req.query);
      const { bundle } = await currentReference(db);
      const chem = new Map(bundle.chemicals.map((c) => [c.id, c]));
      const rows = await withTenant(db, who(req).tenantId, async (tx) => (await tx.query(
        `SELECT s.*, b.name AS block_name, o.name AS orchard_name, u.name AS operator
         FROM public.spray_events s JOIN public.blocks b ON b.id = s.block_id JOIN public.orchards o ON o.id = b.orchard_id
         LEFT JOIN public.users u ON u.id::text = s.operator_user_id
         WHERE s.deleted_at IS NULL AND extract(year FROM s.sprayed_on) = $1 AND ($2::text IS NULL OR o.id = $2) ORDER BY s.sprayed_on`,
        [q.season, q.orchardId ?? null],
      )).rows);
      const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
      const lines = [['date', 'orchard', 'block', 'stage', 'product', 'active_ingredients', 'frac_irac', 'dose_per_100l', 'unit', 'quantity', 'tank_l', 'batch', 'cibrc_reg_no', 'operator', 'violations', 'override_reason', 'corrects_id'].join(',')];
      for (const s of rows)
        for (const p of s.products ?? []) {
          const c = chem.get(p.chemicalId);
          const batches = (p.batches ?? []) as { batchNo?: string; registrationNo?: string }[];
          lines.push([s.sprayed_on, s.orchard_name, s.block_name, bundle.stages.find((x) => x.id === s.stage_id)?.name ?? s.stage_id, c?.product ?? p.chemicalId, c?.activeIngredients.join('+'), [c?.fracGroup && `FRAC ${c.fracGroup}`, c?.iracGroup && `IRAC ${c.iracGroup}`].filter(Boolean).join(' '),
            p.dosePer100L, p.unit, p.quantity, s.tank_litres, batches.map((x) => x.batchNo).filter(Boolean).join('|'), batches.map((x) => x.registrationNo).filter(Boolean).join('|'), s.operator,
            (s.violations ?? []).filter((v: { severity: string }) => v.severity !== 'info').map((v: { code: string }) => v.code).join('|'), s.override_reason, s.corrects_id].map(esc).join(','));
        }
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="spray-log-${q.season}.csv"`);
      return lines.join('\n');
    });

    r.get('/v1/reports/season', { preHandler: requireRole('manager') }, async (req) => {
      const q = z.object({ season: z.coerce.number().int().min(2020).max(2100).default(new Date().getUTCFullYear()) }).parse(req.query);
      return withTenant(db, who(req).tenantId, async (tx) => {
        const { rows } = await tx.query(
          `SELECT b.id, b.name, b.area_kanal, o.name AS orchard,
             (SELECT count(*) FROM public.spray_events s WHERE s.block_id = b.id AND s.deleted_at IS NULL AND extract(year FROM s.sprayed_on) = $1)::int AS sprays,
             (SELECT coalesce(sum(box_count),0) FROM public.harvest_records h WHERE h.block_id = b.id AND h.deleted_at IS NULL AND h.corrects_id IS NULL AND extract(year FROM h.picked_on) = $1)::float AS boxes,
             (SELECT coalesce(sum(box_count * price_per_box_inr),0) FROM public.harvest_records h WHERE h.block_id = b.id AND h.deleted_at IS NULL AND h.corrects_id IS NULL AND extract(year FROM h.picked_on) = $1)::float AS revenue_inr
           FROM public.blocks b JOIN public.orchards o ON o.id = b.orchard_id WHERE b.deleted_at IS NULL ORDER BY o.name, b.name`, [q.season]);
        const { rows: exp } = await tx.query(`SELECT category, sum(amount_inr)::float AS total FROM public.expenses WHERE deleted_at IS NULL AND extract(year FROM spent_on) = $1 GROUP BY category`, [q.season]);
        const revenue = rows.reduce((s, r) => s + r.revenue_inr, 0);
        const cost = exp.reduce((s, e) => s + e.total, 0);
        return { season: q.season, blocks: rows, expenses: exp, totals: { revenueInr: revenue, costInr: cost, marginInr: revenue - cost, boxes: rows.reduce((s, r) => s + r.boxes, 0) } };
      });
    });
  });

  return app;
}
