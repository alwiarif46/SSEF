import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { hashPassword, verifyPassword } from '../../auth.js';
import { config } from '../../config.js';
import { withoutTenant, type Db } from '../../db.js';
import { clearReferenceCache, currentReference } from '../../reference.js';
import { LoginThrottle, authenticateAdmin, issueAdminToken, loginBackoffMs, whoAdmin } from './auth.js';
import { checkBundle, diffBundles, impactOf, isStoreRefusal, prepareBundle, storeReference } from './bundle.js';
import { listAudit, listTenants, listWorkerRuns, recordAudit, setTenantPlan, workerHealth } from './store.js';


const email = z.string().trim().toLowerCase().email().max(200);
const plan = z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/, 'plan: lowercase slug, 2–32 chars');
const billingStatus = z.enum(['trial', 'active', 'past_due', 'cancelled']);

/** Platform admin lane: admin auth, tenants, worker runs, reference publishing, audit log. */
export async function register(app: FastifyInstance, db: Db): Promise<void> {
  // Brute-force protection without a lockout anyone can trigger:
  //  * hard limit per (email, IP) pair and a looser one per IP — an attacker elsewhere cannot lock a known admin out;
  //  * per-email exponential backoff (never a lock) to slow attempts spread across many IPs.
  // Every key is counted whether or not the email exists, so throttling never reveals which admins exist.
  const pairThrottle = new LoginThrottle(8);
  const ipThrottle = new LoginThrottle(40);
  const emailBackoff = new LoginThrottle(Number.POSITIVE_INFINITY);
  // Verified against when the email is unknown, so response timing does not reveal which admins exist.
  const dummyHash = hashPassword(randomUUID());

  app.post('/v1/admin/login', async (req, reply) => {
    const b = z.object({ email, password: z.string().min(1).max(200) }).parse(req.body);
    const pair = `p:${b.email}|${req.ip}`, ip = `ip:${req.ip}`, mail = `e:${b.email}`;
    if (pairThrottle.blocked([pair]) || ipThrottle.blocked([ip])) return reply.code(429).send({ error: 'too many attempts, try again later' });
    const wait = loginBackoffMs(emailBackoff.failures(mail));
    if (wait) await sleep(wait);
    const row = await withoutTenant(db, async (tx) => (await tx.query('SELECT id, email, name, password_hash, active FROM app.admin_lookup($1)', [b.email])).rows[0]);
    const ok = await verifyPassword(b.password, row?.password_hash ?? (await dummyHash));
    if (!row || !ok || !row.active) {
      pairThrottle.fail([pair]);
      ipThrottle.fail([ip]);
      emailBackoff.fail([mail]);
      // Same audit write for known and unknown emails, so the failure path costs the same either way.
      const reason = !row ? 'unknown_email' : row.active ? 'bad_password' : 'inactive';
      await withoutTenant(db, (tx) => recordAudit(tx, row?.id ?? null, 'admin.login_failed', b.email, { ip: req.ip, reason }));
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    pairThrottle.reset([pair]);
    emailBackoff.reset([mail]);
    await withoutTenant(db, (tx) => recordAudit(tx, row.id, 'admin.login', row.email, { ip: req.ip }));
    return { token: await issueAdminToken(row.id), admin: { id: row.id, email: row.email, name: row.name } };
  });

  // Everything else under /v1/admin requires an admin token.
  await app.register(async (r) => {
    r.addHook('preHandler', authenticateAdmin(db));

    r.get('/v1/admin/me', async (req) => {
      const a = whoAdmin(req);
      return { id: a.adminId, email: a.email, name: a.name };
    });

    // ── Tenants ─────────────────────────────────────────────────────────────
    r.get('/v1/admin/tenants', async (req) => {
      const q = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
      const rows = await withoutTenant(db, listTenants);
      if (!q.q) return rows;
      const needle = q.q.toLowerCase();
      return rows.filter((t) => [t.name, t.district ?? '', t.plan, t.billing_status, t.id].some((v) => v.toLowerCase().includes(needle)));
    });

    r.patch('/v1/admin/tenants/:id', async (req, reply) => {
      const a = whoAdmin(req);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const b = z.object({ plan: plan.optional(), billing_status: billingStatus.optional() }).strict()
        .refine((x) => x.plan !== undefined || x.billing_status !== undefined, 'plan or billing_status is required').parse(req.body);
      const updated = await withoutTenant(db, async (tx) => {
        const u = await setTenantPlan(tx, id, b.plan ?? null, b.billing_status ?? null);
        if (u) await recordAudit(tx, a.adminId, 'tenant.plan_update', u.id, {
          tenant: u.name,
          before: { plan: u.previous_plan, billing_status: u.previous_billing_status },
          after: { plan: u.plan, billing_status: u.billing_status },
        });
        return u;
      });
      if (!updated) return reply.code(404).send({ error: 'tenant not found' });
      return { id: updated.id, name: updated.name, plan: updated.plan, billing_status: updated.billing_status };
    });

    // ── Worker runs ─────────────────────────────────────────────────────────
    r.get('/v1/admin/worker-runs', async (req) => {
      const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(50) }).parse(req.query);
      const runs = await withoutTenant(db, (tx) => listWorkerRuns(tx, q.limit));
      return { runs, health: workerHealth(runs, config.workerIntervalMin), intervalMin: config.workerIntervalMin };
    });

    // ── Reference data ──────────────────────────────────────────────────────
    r.get('/v1/admin/reference', async () => {
      const [current, rows] = await Promise.all([
        currentReference(db),
        withoutTenant(db, async (tx) => (await tx.query(
          `SELECT version_id, season, status, etag, published_at, created_at,
             bundle->'version'->>'source' AS source, bundle->'version'->>'verifiedBy' AS verified_by, bundle->'version'->>'verifiedAt' AS verified_at,
             jsonb_array_length(bundle->'stages') AS stages, jsonb_array_length(bundle->'recommendations') AS recommendations,
             jsonb_array_length(bundle->'chemicals') AS chemicals
           FROM public.reference_bundles ORDER BY season DESC, created_at DESC`)).rows),
      ]);
      return {
        current: { versionId: current.bundle.version.id, etag: current.etag, status: current.status },
        versions: rows.map((v) => ({ ...v, published_at: v.published_at && new Date(v.published_at).toISOString(), created_at: new Date(v.created_at).toISOString() })),
      };
    });

    r.get('/v1/admin/reference/:versionId', async (req, reply) => {
      const { versionId } = z.object({ versionId: z.string().min(1).max(64) }).parse(req.params);
      const row = await withoutTenant(db, async (tx) => (await tx.query('SELECT bundle FROM public.reference_bundles WHERE version_id = $1', [versionId])).rows[0]);
      if (!row) return reply.code(404).send({ error: 'version not found' });
      return row.bundle;
    });

    r.post('/v1/admin/reference/validate', async (req) => {
      const check = checkBundle(req.body);
      const current = await currentReference(db);
      if (!check.bundle) return { ok: false, errors: check.errors, regulatoryImpact: [], diff: null, against: { versionId: current.bundle.version.id, etag: current.etag } };
      return {
        ok: check.ok,
        errors: check.errors,
        regulatoryImpact: impactOf(check.bundle),
        diff: diffBundles(current.bundle, check.bundle),
        against: { versionId: current.bundle.version.id, etag: current.etag },
      };
    });

    r.post('/v1/admin/reference/publish', async (req, reply) => {
      const a = whoAdmin(req);
      const b = z.object({
        bundle: z.unknown(),
        status: z.enum(['draft', 'under_review', 'published']),
        verifiedBy: z.string().trim().min(2).max(200).optional(),
      }).strict().parse(req.body);
      // Sign-off is the publisher's own, named in this request; one embedded in the bundle is ignored.
      if (b.status === 'published' && !b.verifiedBy) return reply.code(422).send({ error: 'publishing requires verifiedBy (agronomist sign-off)', errors: [] });
      const prepared = prepareBundle(b.bundle, b.status, b.verifiedBy);
      if ('refused' in prepared) return reply.code(422).send({ error: prepared.refused, errors: prepared.errors });
      const current = await currentReference(db);
      const diff = diffBundles(current.bundle, prepared.bundle);
      let stored;
      try {
        stored = await withoutTenant(db, async (tx) => {
          const s = await storeReference(tx, prepared);
          await recordAudit(tx, a.adminId, 'reference.store', s.version_id, {
            status: s.status, season: s.season, etag: s.etag, verifiedBy: prepared.bundle.version.verifiedBy ?? null,
            superseded: s.superseded, warnings: prepared.errors.length, summary: diff.summary, doseChanges: diff.doseChanges.length,
            against: diff.against.versionId,
          });
          return s;
        });
      } catch (e) {
        if (isStoreRefusal(e)) return reply.code(409).send({ error: e.message, errors: [] });
        throw e;
      }
      clearReferenceCache();
      return reply.code(201).send({ ...stored, warnings: prepared.errors });
    });

    // ── Audit log ───────────────────────────────────────────────────────────
    r.get('/v1/admin/audit', async (req) => {
      const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.number().int().positive().optional() }).parse(req.query);
      return withoutTenant(db, (tx) => listAudit(tx, q.limit, q.before ?? null));
    });
  });
}
