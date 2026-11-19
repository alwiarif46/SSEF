import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { BUNDLE_2026, type ReferenceBundle } from '@orchard/reference';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { createPool, type Db } from '../src/db.js';
import { issueToken, verifyToken } from '../src/auth.js';
import { recordedCycle, runCycle } from '../src/worker.js';
import { synthetic } from '../src/weather/providers.js';
import { createAdmin } from '../src/lanes/admin/create-admin.js';
import { issueAdminToken, loginBackoffMs, verifyAdminToken } from '../src/lanes/admin/auth.js';
import { clearReferenceCache } from '../src/reference.js';
import { checkBundle, diffBundles, prepareBundle } from '../src/lanes/admin/bundle.js';
import { workerHealth, type WorkerRun } from '../src/lanes/admin/store.js';

const ADMIN_DB = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DBNAME = `orchard_lane_admin_${process.pid}`;
const SUPER_URL = ADMIN_DB.replace(/\/postgres$/, `/${DBNAME}`);
let db: Db;
let su: pg.Client;
let app: FastifyInstance;

const season = Number(new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }));
let tenantA = '', tenantB = '', ownerA = '';
let tenantToken = '';
let adminToken = '';
let adminId = '';

beforeAll(async () => {
  const c = new pg.Client({ connectionString: ADMIN_DB });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${DBNAME}`);
  await c.query(`CREATE DATABASE ${DBNAME}`);
  await c.end();
  await migrate(SUPER_URL, () => {});
  su = new pg.Client({ connectionString: SUPER_URL });
  await su.connect();
  db = createPool(`postgres://orchard_app:orchard_app@localhost:5432/${DBNAME}`);
  app = buildApp(db);
  await app.ready();

  // Fixtures written as the owner role (independent of the tenant-facing routes).
  const a = (await su.query(`SELECT * FROM app.create_tenant_with_owner('Mir Orchards', 'Ali Mir', '9419100001', 'x', 'Shopian')`)).rows[0];
  const b = (await su.query(`SELECT * FROM app.create_tenant_with_owner('Dar Fruits', 'Bilal Dar', '9419100002', 'x', 'Baramulla')`)).rows[0];
  tenantA = a.tenant_id; ownerA = a.user_id; tenantB = b.tenant_id;
  await su.query(`INSERT INTO public.users (tenant_id, name, phone, role, password_hash) VALUES ($1, 'Gulzar', '9419100010', 'worker', 'x')`, [tenantA]);
  await su.query(`INSERT INTO public.orchards (id, tenant_id, name, lat, lng, elevation_m, notes) VALUES ('orch-admin-a1', $1, 'Shopian Upper', 33.72, 74.83, 2050, 'secret orchard note')`, [tenantA]);
  await su.query(`INSERT INTO public.blocks (id, tenant_id, orchard_id, name, system_type) VALUES ('blk-admin-a1', $1, 'orch-admin-a1', 'HDP-1', 'hdp'), ('blk-admin-a2', $1, 'orch-admin-a1', 'Trad-1', 'traditional')`, [tenantA]);
  await su.query(`INSERT INTO public.spray_events (id, tenant_id, block_id, sprayed_on, products) VALUES
    ('spr-admin-a1', $1, 'blk-admin-a1', $2, '[{"chemicalId":"captan-50wp"}]'),
    ('spr-admin-a2', $1, 'blk-admin-a2', $3, '[{"chemicalId":"captan-50wp"}]'),
    ('spr-admin-a3', $1, 'blk-admin-a2', $4, '[{"chemicalId":"captan-50wp"}]')`, [tenantA, `${season}-04-01`, `${season}-05-01`, `${season - 1}-05-01`]);
  tenantToken = await issueToken({ userId: ownerA, tenantId: tenantA, role: 'owner' });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await db?.end();
  await su?.end();
  const c = new pg.Client({ connectionString: ADMIN_DB });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${DBNAME}`);
  await c.end();
});

const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, token?: string, payload?: unknown) => {
  const r = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, body: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body, headers: r.headers };
};

const clone = (b: ReferenceBundle): ReferenceBundle => JSON.parse(JSON.stringify(b));

describe('admin bootstrap and login', () => {
  it('CLI creates the first admin; duplicates need --reset', async () => {
    const r = await createAdmin(SUPER_URL, { email: 'Ops@SebOrchard.in', name: 'Platform Ops', password: 'correct-horse-battery' });
    expect(r).toMatchObject({ email: 'ops@seborchard.in', created: true });
    adminId = r.id;
    await expect(createAdmin(SUPER_URL, { email: 'ops@seborchard.in', name: 'x', password: 'another-long-pass' })).rejects.toThrow(/already exists/);
    await expect(createAdmin(SUPER_URL, { email: 'weak@seborchard.in', name: 'x', password: 'short' })).rejects.toThrow();
  });

  it('logs in with email + password; rejects bad credentials', async () => {
    expect((await call('POST', '/v1/admin/login', undefined, { email: 'ops@seborchard.in', password: 'wrong-password' })).status).toBe(401);
    expect((await call('POST', '/v1/admin/login', undefined, { email: 'nobody@seborchard.in', password: 'whatever-pass' })).status).toBe(401);
    const ok = await call('POST', '/v1/admin/login', undefined, { email: 'OPS@seborchard.in', password: 'correct-horse-battery' });
    expect(ok.status).toBe(200);
    expect(ok.body.admin).toEqual({ id: adminId, email: 'ops@seborchard.in', name: 'Platform Ops' });
    adminToken = ok.body.token;
    const me = await call('GET', '/v1/admin/me', adminToken);
    expect(me.body).toMatchObject({ id: adminId, email: 'ops@seborchard.in' });
    expect((await call('GET', '/v1/admin/me')).status).toBe(401);
    expect((await call('GET', '/v1/admin/me', 'garbage')).status).toBe(401);
  });

  it('a tenant token is never an admin token, and vice versa', async () => {
    // Tenant token on every admin route → 401.
    for (const [m, u] of [['GET', '/v1/admin/me'], ['GET', '/v1/admin/tenants'], ['GET', '/v1/admin/worker-runs'], ['GET', '/v1/admin/reference'], ['GET', '/v1/admin/audit'],
      ['PATCH', `/v1/admin/tenants/${tenantA}`], ['POST', '/v1/admin/reference/publish']] as const)
      expect((await call(m, u, tenantToken, m === 'GET' ? undefined : {})).status).toBe(401);
    // Admin token on tenant routes → 401.
    expect((await call('GET', '/v1/me', tenantToken)).status).toBe(200);
    expect((await call('GET', '/v1/me', adminToken)).status).toBe(401);
    expect((await call('GET', '/v1/reference/current', adminToken)).status).toBe(401);
    // And at the verifier level.
    await expect(verifyAdminToken(tenantToken)).rejects.toThrow();
    await expect(verifyToken(adminToken)).rejects.toThrow();
  });

  it('throttles per email+IP without letting anyone lock a known admin out', async () => {
    const login = (password: string, remoteAddress: string) =>
      app.inject({ method: 'POST', url: '/v1/admin/login', payload: { email: 'ops@seborchard.in', password }, remoteAddress });
    for (let i = 0; i < 8; i++) expect((await login('wrong-password', '10.9.0.1')).statusCode).toBe(401);
    expect((await login('correct-horse-battery', '10.9.0.1')).statusCode).toBe(429);
    // The real admin, elsewhere, still gets in (after a short backoff, never a lock).
    expect((await login('correct-horse-battery', '10.9.0.2')).statusCode).toBe(200);
    // Unknown emails take the same failure path, including the audit write.
    const n = async () => (await su.query(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action = 'admin.login_failed'`)).rows[0].n as number;
    const before = await n();
    const r = await app.inject({ method: 'POST', url: '/v1/admin/login', payload: { email: 'ghost@seborchard.in', password: 'whatever-pass' }, remoteAddress: '10.9.0.3' });
    expect(r.statusCode).toBe(401);
    expect(await n()).toBe(before + 1);
    expect(loginBackoffMs(4)).toBe(0);
    expect(loginBackoffMs(6)).toBe(200);
    expect(loginBackoffMs(50)).toBe(5_000);
  });

  it('deactivated admins lose access immediately', async () => {
    const other = await createAdmin(SUPER_URL, { email: 'temp@seborchard.in', name: 'Temp', password: 'temporary-password' });
    const t = await issueAdminToken(other.id);
    expect((await call('GET', '/v1/admin/me', t)).status).toBe(200);
    await su.query('UPDATE public.platform_admins SET active = false WHERE id = $1', [other.id]);
    expect((await call('GET', '/v1/admin/me', t)).status).toBe(401);
    expect((await call('POST', '/v1/admin/login', undefined, { email: 'temp@seborchard.in', password: 'temporary-password' })).status).toBe(401);
  });
});

describe('tenants', () => {
  it('lists per-tenant aggregates only', async () => {
    const r = await call('GET', '/v1/admin/tenants', adminToken);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    const a = r.body.find((t: { id: string }) => t.id === tenantA);
    expect(Object.keys(a).sort()).toEqual(['billing_status', 'blocks', 'created_at', 'district', 'id', 'last_activity_at', 'name', 'orchards', 'plan', 'sprays_this_season', 'users'].sort());
    expect(a).toMatchObject({ name: 'Mir Orchards', plan: 'pilot', billing_status: 'trial', district: 'Shopian', users: 2, orchards: 1, blocks: 2, sprays_this_season: 2 });
    expect(a.last_activity_at).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/secret orchard note|password|9419100001|HDP-1/);
    const b = r.body.find((t: { id: string }) => t.id === tenantB);
    expect(b).toMatchObject({ users: 1, orchards: 0, blocks: 0, sprays_this_season: 0, last_activity_at: null });
    const s = await call('GET', '/v1/admin/tenants?q=baramulla', adminToken);
    expect(s.body.map((t: { id: string }) => t.id)).toEqual([tenantB]);
  });

  it('changes plan / billing status and audits it', async () => {
    const r = await call('PATCH', `/v1/admin/tenants/${tenantB}`, adminToken, { plan: 'pro', billing_status: 'active' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: tenantB, name: 'Dar Fruits', plan: 'pro', billing_status: 'active' });
    expect((await call('PATCH', `/v1/admin/tenants/${tenantB}`, adminToken, { billing_status: 'bogus' })).status).toBe(400);
    expect((await call('PATCH', `/v1/admin/tenants/${tenantB}`, adminToken, {})).status).toBe(400);
    expect((await call('PATCH', `/v1/admin/tenants/${tenantB}`, adminToken, { plan: 'pro', tenant_id: tenantA })).status).toBe(400);
    expect((await call('PATCH', `/v1/admin/tenants/${randomUUID()}`, adminToken, { plan: 'pro' })).status).toBe(404);
    const audit = await call('GET', '/v1/admin/audit', adminToken);
    const entry = audit.body.find((e: { action: string }) => e.action === 'tenant.plan_update');
    expect(entry).toMatchObject({ admin_id: adminId, admin_email: 'ops@seborchard.in', target: tenantB,
      detail: { before: { plan: 'pilot', billing_status: 'trial' }, after: { plan: 'pro', billing_status: 'active' } } });
    expect(audit.body.some((e: { action: string }) => e.action === 'admin.login')).toBe(true);
    expect(audit.body.some((e: { action: string }) => e.action === 'admin.login_failed')).toBe(true);
    // Tenant sees its new plan through its own (RLS-scoped) route.
    const tokenB = await issueToken({ userId: randomUUID(), tenantId: tenantB, role: 'owner' });
    expect((await call('GET', '/v1/me', tokenB)).body.tenant).toMatchObject({ plan: 'pro', billing_status: 'active' });
  });
});

describe('reference publishing', () => {
  const banned = (): ReferenceBundle => {
    const b = clone(BUNDLE_2026);
    b.version = { ...b.version, id: `skuastk-${season + 1}`, season: season + 1, effectiveFrom: `${season + 1}-01-01`, effectiveTo: `${season + 1}-12-31` };
    const rec = b.recommendations[0]!;
    rec.options[0]!.dosePer100L = rec.options[0]!.dosePer100L * 2;
    b.recommendations.find((r) => r.category === 'insecticide')!.options.push({ chemicalId: 'malathion-50ec', dosePer100L: 100, doseUnit: 'ml' });
    return b;
  };

  it('the compiled bundle passes the shared checks', () => {
    expect(checkBundle(BUNDLE_2026)).toMatchObject({ ok: true, errors: [] });
    expect(diffBundles(BUNDLE_2026, BUNDLE_2026).summary).toEqual({ added: 0, removed: 0, changed: 0, doseChanges: 0 });
  });

  it('lists versions with status and etag', async () => {
    const r = await call('GET', '/v1/admin/reference', adminToken);
    expect(r.status).toBe(200);
    expect(r.body.versions[0]).toMatchObject({ version_id: 'skuastk-2026', status: 'under_review', stages: BUNDLE_2026.stages.length });
    expect(r.body.versions[0].etag).toMatch(/^[0-9a-f]{32}$/);
    expect((await call('GET', '/v1/admin/reference/skuastk-2026', adminToken)).body.version.id).toBe('skuastk-2026');
    expect((await call('GET', '/v1/admin/reference/nope', adminToken)).status).toBe(404);
  });

  it('validate detects a banned product in a recommendation, regulatory impact and dose diff', async () => {
    const b = banned();
    const r = await call('POST', '/v1/admin/reference/validate', adminToken, b);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.errors.some((e: string) => e.includes('recommends banned malathion-50ec'))).toBe(true);
    expect(r.body.regulatoryImpact.some((i: { affected: { chemicalId: string }[] }) => i.affected.some((a) => a.chemicalId === 'malathion-50ec'))).toBe(true);
    const rec0 = BUNDLE_2026.recommendations[0]!;
    const opt0 = rec0.options[0]!;
    expect(r.body.diff.doseChanges).toContainEqual(expect.objectContaining({
      kind: 'changed', recommendationId: rec0.id, stageId: rec0.stageId, chemicalId: opt0.chemicalId,
      before: { dosePer100L: opt0.dosePer100L, doseUnit: opt0.doseUnit }, after: { dosePer100L: opt0.dosePer100L * 2, doseUnit: opt0.doseUnit },
    }));
    expect(r.body.diff.doseChanges).toContainEqual(expect.objectContaining({ kind: 'added', chemicalId: 'malathion-50ec', before: null }));
    expect(r.body.diff.recommendations.changed.length).toBe(2);
    expect(r.body.diff.against.versionId).toBe('skuastk-2026');

    const shape = await call('POST', '/v1/admin/reference/validate', adminToken, { version: { id: 'x' } });
    expect(shape.body.ok).toBe(false);
    expect(shape.body.diff).toBeNull();
    expect(shape.body.errors.length).toBeGreaterThan(0);
  });

  it('publish requires verifiedBy and zero errors; supersedes older published seasons', async () => {
    const good = clone(BUNDLE_2026);
    good.recommendations[0]!.options[0]!.dosePer100L += 10;
    const noSign = await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: good, status: 'published' });
    expect(noSign.status).toBe(422);
    expect(noSign.body.error).toMatch(/verifiedBy/);
    const bad = await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: banned(), status: 'published', verifiedBy: 'Dr. Sheikh (SKUAST-K)' });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.some((e: string) => e.includes('banned'))).toBe(true);
    expect((await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: banned(), status: 'under_review' })).status).toBe(422);

    // Drafts may carry errors (never served to growers).
    const draft = await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: banned(), status: 'draft' });
    expect(draft.status).toBe(201);
    expect(draft.body.warnings.length).toBeGreaterThan(0);

    const pub = await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: good, status: 'published', verifiedBy: 'Dr. Sheikh (SKUAST-K)' });
    expect(pub.status).toBe(201);
    expect(pub.body).toMatchObject({ version_id: 'skuastk-2026', status: 'published', superseded: [] });
    const current = await call('GET', '/v1/reference/current', tenantToken);
    expect(current.headers.etag).toBe(`"${pub.body.etag}"`);
    expect(current.body.version).toMatchObject({ status: 'published', verifiedBy: 'Dr. Sheikh (SKUAST-K)' });
    expect(current.body.recommendations[0].options[0].dosePer100L).toBe(good.recommendations[0]!.options[0]!.dosePer100L);

    // Next season published → previous published season superseded.
    const next = clone(good);
    next.version = { ...next.version, id: `skuastk-${season + 2}`, season: season + 2, effectiveFrom: `${season + 2}-01-01`, effectiveTo: `${season + 2}-12-31` };
    const pub2 = await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: next, status: 'published', verifiedBy: 'Dr. Sheikh (SKUAST-K)' });
    expect(pub2.body.superseded).toEqual(['skuastk-2026']);
    const list = (await call('GET', '/v1/admin/reference', adminToken)).body;
    expect(list.current.versionId).toBe(`skuastk-${season + 2}`);
    const statuses = Object.fromEntries(list.versions.map((v: { version_id: string; status: string }) => [v.version_id, v.status]));
    expect(statuses).toMatchObject({ 'skuastk-2026': 'superseded', [`skuastk-${season + 1}`]: 'draft', [`skuastk-${season + 2}`]: 'published' });
    expect((await su.query(`SELECT bundle->'version'->>'status' AS s FROM public.reference_bundles WHERE version_id = 'skuastk-2026'`)).rows[0].s).toBe('superseded');

    const audit = (await call('GET', '/v1/admin/audit?limit=500', adminToken)).body.filter((e: { action: string }) => e.action === 'reference.store');
    expect(audit).toHaveLength(3);
    expect(audit[0]).toMatchObject({ target: `skuastk-${season + 2}`, detail: { status: 'published', verifiedBy: 'Dr. Sheikh (SKUAST-K)', superseded: ['skuastk-2026'] } });
  });

  it('a stored version is never demoted: a draft cannot clobber the published bundle', async () => {
    const live = `skuastk-${season + 2}`;
    const before = (await call('GET', '/v1/reference/current', tenantToken)).headers.etag;
    // The console's "start from a stored version" flow: load the live bundle, edit, store as draft.
    const copy = (await call('GET', `/v1/admin/reference/${live}`, adminToken)).body as ReferenceBundle;
    copy.recommendations[0]!.options[0]!.dosePer100L += 1;
    const draft = await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: copy, status: 'draft' });
    expect(draft.status).toBe(409);
    expect(draft.body.error).toMatch(/is published; use a new version id/);
    expect((await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: copy, status: 'under_review' })).status).toBe(409);
    // A superseded version cannot be revived as a draft either.
    const old = (await call('GET', '/v1/admin/reference/skuastk-2026', adminToken)).body as ReferenceBundle;
    expect((await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: old, status: 'draft' })).status).toBe(409);
    clearReferenceCache();
    const after = await call('GET', '/v1/reference/current', tenantToken);
    expect(after.headers.etag).toBe(before);
    expect(after.body.version).toMatchObject({ id: live, status: 'published' });

    // Under review is allowed alongside the published season (served behind it), but then cannot be clobbered by a draft.
    const rc = clone(copy);
    rc.version = { ...rc.version, id: `${live}-rc1` };
    expect((await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: rc, status: 'under_review' })).status).toBe(201);
    expect((await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: rc, status: 'draft' })).status).toBe(409);
    expect((await call('GET', '/v1/reference/current', tenantToken)).body.version.id).toBe(live);
    // A revision stored under a new id is fine.
    const rev = clone(copy);
    rev.version = { ...rev.version, id: `${live}-draft1` };
    expect((await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: rev, status: 'draft' })).status).toBe(201);
  });

  it('sign-off is never inherited from the bundle; unsigned bundles cannot outrank the published one', async () => {
    const live = `skuastk-${season + 2}`;
    const signed = (await call('GET', `/v1/admin/reference/${live}`, adminToken)).body as ReferenceBundle;
    expect(signed.version.verifiedBy).toBe('Dr. Sheikh (SKUAST-K)');
    signed.recommendations[0]!.options[0]!.dosePer100L *= 3;
    const r = await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: signed, status: 'published' });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/verifiedBy/);
    expect(prepareBundle(signed, 'published')).toMatchObject({ refused: expect.stringMatching(/verifiedBy/) });
    // Drafts and under_review bundles carry no sign-off at all.
    const d = prepareBundle(signed, 'draft', 'Someone');
    if ('refused' in d) throw new Error(d.refused);
    expect(d.bundle.version.verifiedBy).toBeUndefined();
    expect(d.bundle.version.verifiedAt).toBeUndefined();
    // Re-publishing with the publisher's own sign-off stamps a fresh verifiedAt.
    const at = new Date('2030-03-01T10:00:00Z');
    const p = prepareBundle(signed, 'published', 'Dr. Lone (SKUAST-K)', at);
    if ('refused' in p) throw new Error(p.refused);
    expect(p.bundle.version).toMatchObject({ verifiedBy: 'Dr. Lone (SKUAST-K)', verifiedAt: at.toISOString() });
    const ok = await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: signed, status: 'published', verifiedBy: 'Dr. Lone (SKUAST-K)' });
    expect(ok.status).toBe(201);
    const cur = await call('GET', '/v1/reference/current', tenantToken);
    expect(cur.body.version.verifiedBy).toBe('Dr. Lone (SKUAST-K)');
    expect(cur.body.version.verifiedAt).not.toBe(signed.version.verifiedAt);

    // An unsigned under_review bundle for a newer season would be served first → refused.
    const newer = clone(signed);
    newer.version = { ...newer.version, id: `skuastk-${season + 3}`, season: season + 3, effectiveFrom: `${season + 3}-01-01`, effectiveTo: `${season + 3}-12-31` };
    const ur = await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: newer, status: 'under_review' });
    expect(ur.status).toBe(409);
    expect(ur.body.error).toMatch(/served ahead/);
    // Publishing a season older than the published one is refused (it would leave two published rows).
    const older = clone(signed);
    older.version = { ...older.version, id: `skuastk-${season + 1}-r2`, season: season + 1, effectiveFrom: `${season + 1}-01-01`, effectiveTo: `${season + 1}-12-31` };
    const op = await call('POST', '/v1/admin/reference/publish', adminToken, { bundle: older, status: 'published', verifiedBy: 'Dr. Lone (SKUAST-K)' });
    expect(op.status).toBe(409);
    expect(op.body.error).toMatch(/older than the published season/);
    expect((await su.query(`SELECT count(*)::int AS n FROM public.reference_bundles WHERE status = 'published'`)).rows[0].n).toBe(1);
  });

  it('the store function enforces sign-off even when called directly', async () => {
    const p = prepareBundle(BUNDLE_2026, 'draft');
    if ('refused' in p) throw new Error(p.refused);
    const forged = { ...p.bundle, version: { ...p.bundle.version, status: 'published' as const, verifiedBy: undefined } };
    const c = await db.connect();
    try {
      await expect(c.query('SELECT * FROM app.admin_store_reference($1, $2, $3, $4::jsonb, $5)', ['skuastk-2026', 2026, 'published', JSON.stringify(forged), p.etag])).rejects.toThrow(/verifiedBy/);
      await expect(c.query('SELECT * FROM public.platform_admins')).rejects.toThrow(/permission denied/);
      await expect(c.query(`UPDATE public.reference_bundles SET status = 'published'`)).rejects.toThrow(/permission denied/);
    } finally {
      c.release();
    }
  });
});

describe('worker run log', () => {
  it('records each cycle, including per-orchard errors, with a health indicator', async () => {
    const res = await runCycle(db, synthetic(), BUNDLE_2026, new Date(`${season}-04-20T06:00:00Z`));
    expect(res.errors).toEqual([]);
    expect(res.orchards).toBe(1);
    const failing = { name: 'broken', hourly: async () => { throw new Error('provider timeout'); } };
    const res2 = await runCycle(db, failing, BUNDLE_2026);
    expect(res2.errors).toEqual([{ orchardId: 'orch-admin-a1', error: 'provider timeout' }]);

    const r = await call('GET', '/v1/admin/worker-runs', adminToken);
    expect(r.status).toBe(200);
    const [latest, first] = r.body.runs;
    expect(latest).toMatchObject({ provider: 'broken', orchards: 0, errors: [{ orchardId: 'orch-admin-a1', error: 'provider timeout' }] });
    expect(latest.finished_at).toBeTruthy();
    expect(first).toMatchObject({ provider: 'synthetic', orchards: 1, hours: res.hours, alerts: res.alerts, new_alerts: res.newAlerts, errors: [], pushed: null });
    expect(r.body.health.status).toBe('failing');
    expect((await call('GET', '/v1/admin/worker-runs?limit=1', adminToken)).body.runs).toHaveLength(1);
  });

  it('records the push drain count, and push failures as cycle errors', async () => {
    await recordedCycle(db, synthetic(), BUNDLE_2026, new Date(`${season}-04-21T06:00:00Z`), async () => 3);
    let [run] = (await call('GET', '/v1/admin/worker-runs?limit=1', adminToken)).body.runs;
    expect(run).toMatchObject({ provider: 'synthetic', orchards: 1, pushed: 3, errors: [] });
    await recordedCycle(db, synthetic(), BUNDLE_2026, new Date(`${season}-04-21T07:00:00Z`), async () => { throw new Error('expo down'); });
    [run] = (await call('GET', '/v1/admin/worker-runs?limit=1', adminToken)).body.runs;
    expect(run).toMatchObject({ orchards: 1, pushed: null, errors: [{ orchardId: '*', error: 'push: expo down' }] });
  });

  it('health classification', () => {
    const now = Date.parse('2026-05-01T12:00:00Z');
    const run = (minAgo: number, p: Partial<WorkerRun> = {}): WorkerRun => ({
      id: 1, started_at: new Date(now - minAgo * 60_000).toISOString(), finished_at: new Date(now - minAgo * 60_000 + 30_000).toISOString(),
      orchards: 3, hours: 100, alerts: 1, new_alerts: 0, pushed: 0, errors: [], provider: 'synthetic', ...p,
    });
    expect(workerHealth([], 60, now).status).toBe('unknown');
    expect(workerHealth([run(10)], 60, now).status).toBe('ok');
    expect(workerHealth([run(10, { errors: [{ orchardId: 'o', error: 'x' }] })], 60, now).status).toBe('degraded');
    expect(workerHealth([run(10, { orchards: 0, errors: [{ orchardId: 'o', error: 'x' }] })], 60, now).status).toBe('failing');
    expect(workerHealth([run(500)], 60, now).status).toBe('stale');
    expect(workerHealth([run(2, { finished_at: null }), run(62)], 60, now).status).toBe('running');
    expect(workerHealth([run(90, { finished_at: null }), run(150)], 60, now).status).toBe('failing');
  });
});
