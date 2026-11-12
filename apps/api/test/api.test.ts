import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { BUNDLE_2026 } from '@orchard/reference';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { createPool, type Db } from '../src/db.js';
import { runCycle } from '../src/worker.js';
import { synthetic, openMeteo } from '../src/weather/providers.js';
import { sendPending, type PushMessage } from '../src/push.js';

const ADMIN = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DBNAME = `orchard_test_${process.pid}`;
let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
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
});

const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, token?: string, payload?: unknown) => {
  const r = await app.inject({ method, url, ...(payload ? { payload: payload as object } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, body: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body, headers: r.headers };
};
const sync = (token: string, changes: Record<string, unknown>, lastPulledAt = 0) => call('POST', `/v1/sync?last_pulled_at=${lastPulledAt}`, token, { changes });
const pullAll = (token: string, lastPulledAt = 0) => call('GET', `/v1/sync?last_pulled_at=${lastPulledAt}&schema_version=1`, token);
const C = (rows: unknown[]) => ({ created: rows, updated: [], deleted: [] });

let ownerA = '', ownerB = '', worker = '', manager = '';
const orchardId = randomUUID(), blockId = randomUUID();

describe('auth', () => {
  it('signs up two tenants, rejects duplicates and bad logins', async () => {
    const a = await call('POST', '/v1/auth/signup', undefined, { tenantName: 'Mir Orchards', name: 'Ali Mir', phone: '9419000001', password: 'secret-pass-1', district: 'Shopian' });
    expect(a.status).toBe(201);
    ownerA = a.body.token;
    const b = await call('POST', '/v1/auth/signup', undefined, { tenantName: 'Dar Fruits', name: 'Bilal Dar', phone: '9419000002', password: 'secret-pass-2' });
    ownerB = b.body.token;
    expect((await call('POST', '/v1/auth/signup', undefined, { tenantName: 'Dup Co', name: 'Dup', phone: '9419000001', password: 'secret-pass-3' })).status).toBe(409);
    expect((await call('POST', '/v1/auth/login', undefined, { phone: '9419000001', password: 'wrong-pass' })).status).toBe(401);
    expect((await call('POST', '/v1/auth/login', undefined, { phone: '9419000001', password: 'secret-pass-1' })).status).toBe(200);
    expect((await call('GET', '/v1/me')).status).toBe(401);
    expect((await call('GET', '/v1/me', 'garbage')).status).toBe(401);
  });

  it('owner creates manager and worker; worker cannot create users', async () => {
    expect((await call('POST', '/v1/users', ownerA, { name: 'Gulzar', phone: '9419000010', password: 'worker-pass-1', role: 'worker' })).status).toBe(201);
    expect((await call('POST', '/v1/users', ownerA, { name: 'Manzoor', phone: '9419000011', password: 'manager-pass-1', role: 'manager' })).status).toBe(201);
    worker = (await call('POST', '/v1/auth/login', undefined, { phone: '9419000010', password: 'worker-pass-1' })).body.token;
    manager = (await call('POST', '/v1/auth/login', undefined, { phone: '9419000011', password: 'manager-pass-1' })).body.token;
    expect((await call('POST', '/v1/users', worker, { name: 'X', phone: '9419000099', password: 'worker-pass-9', role: 'manager' })).status).toBe(403);
    expect((await call('GET', '/v1/users', manager)).body).toHaveLength(3);
  });
});

describe('sync + tenant isolation', () => {
  it('pushes orchard and block, pulls them back; other tenant sees nothing', async () => {
    const r = await sync(manager, {
      orchards: C([{ id: orchardId, name: 'Shopian Upper', district: 'Shopian', lat: 33.72, lng: 74.83, elevation_m: 2050, area_kanal: 12, tenant_id: randomUUID() }]),
      blocks: C([{ id: blockId, orchard_id: orchardId, name: 'HDP-1', system_type: 'hdp', rootstock_id: 'm9-t337', planting_year: 2021, tree_count: 1600, variety_mix: JSON.stringify([{ varietyId: 'gala-redlum', trees: 1400 }, { varietyId: 'golden-delicious', trees: 200 }]), expected_harvest_date: '2026-08-20' }]),
    });
    expect(r.body).toMatchObject({ ok: true, rejected: [] });
    const a = await pullAll(ownerA);
    expect(a.body.changes.orchards.created).toHaveLength(1);
    expect(JSON.parse(a.body.changes.blocks.created[0].variety_mix)).toHaveLength(2);
    expect(a.body.changes.orchards.created[0].tenant_id).toBeUndefined();
    const b = await pullAll(ownerB);
    expect(b.body.changes.orchards.created).toHaveLength(0);
  });

  it('tenant B cannot overwrite or reference tenant A rows', async () => {
    const r = await sync(ownerB, { blocks: { created: [], updated: [{ id: blockId, orchard_id: orchardId, name: 'hijack', system_type: 'hdp' }], deleted: [] } });
    expect(r.body.rejected).toHaveLength(1);
    const a = await pullAll(ownerA);
    expect(a.body.changes.blocks.created[0].name).toBe('HDP-1');
  });

  it('enforces role gates per table', async () => {
    const r = await sync(worker, { orchards: C([{ id: randomUUID(), name: 'Worker orchard' }]) });
    expect(r.body.rejected[0].reason).toMatch(/cannot create orchards/);
    const d = await sync(worker, { blocks: { created: [], updated: [], deleted: [blockId] } });
    expect(d.body.rejected[0].reason).toMatch(/cannot delete/);
  });

  it('rejects unknown tables and invalid rows', async () => {
    const r = await sync(manager, { users: C([{ id: randomUUID() }]), blocks: C([{ id: randomUUID(), name: 'No orchard', system_type: 'hdp' }]) });
    expect(r.body.rejected.map((x: { reason: string }) => x.reason).sort()).toEqual(['orchard_id is required', 'unknown table']);
  });

  it('incremental pull returns only changes since the checkpoint', async () => {
    const first = await pullAll(ownerA);
    const ts = first.body.timestamp;
    await new Promise((res) => setTimeout(res, 20));
    await sync(manager, { blocks: { created: [], updated: [{ id: blockId, name: 'HDP-1 (north)', _changed: 'name' }], deleted: [] } }, ts);
    const inc = await pullAll(ownerA, ts);
    expect(inc.body.changes.blocks.updated.map((b: { name: string }) => b.name)).toContain('HDP-1 (north)');
    expect(inc.body.changes.blocks.created).toHaveLength(0);
  });
});

describe('spray records: append-only, compliance, inventory', () => {
  const sprayId = randomUUID();
  it('deducts inventory FIFO by expiry and records batch traceability', async () => {
    const inv1 = randomUUID(), inv2 = randomUUID();
    await sync(manager, { chemical_inventory: C([
      { id: inv1, chemical_id: 'captan-50wp', batch_no: 'CAP-OLD', expiry_date: '2026-12-31', quantity: 0.5, unit: 'kg', registration_no: 'CIR-1234', dealer: 'Shopian Agro', invoice_no: 'INV-77' },
      { id: inv2, chemical_id: 'captan-50wp', batch_no: 'CAP-NEW', expiry_date: '2027-12-31', quantity: 2, unit: 'kg', registration_no: 'CIR-1234' },
    ]) });
    const r = await sync(worker, { spray_events: C([{ id: sprayId, block_id: blockId, stage_id: 's02-green-tip', sprayed_on: '2026-03-20', tank_litres: 200, products: JSON.stringify([{ chemicalId: 'captan-50wp', dosePer100L: 300, unit: 'g', quantity: 600 }]) }]) });
    expect(r.body.ok).toBe(true);
    const p = await pullAll(ownerA);
    const inv = Object.fromEntries(p.body.changes.chemical_inventory.created.map((x: { batch_no: string; quantity: number }) => [x.batch_no, x.quantity]));
    expect(inv).toEqual({ 'CAP-OLD': 0, 'CAP-NEW': 1.9 });
    const spray = p.body.changes.spray_events.created[0];
    expect(spray.locked).toBe(true);
    expect(JSON.parse(spray.products)[0].batches.map((b: { batchNo: string }) => b.batchNo)).toEqual(['CAP-OLD', 'CAP-NEW']);
  });

  it('locked sprays reject edits and deletes; corrections are new linked rows', async () => {
    const e = await sync(manager, { spray_events: { created: [], updated: [{ id: sprayId, notes: 'oops', _changed: 'notes' }], deleted: [] } });
    expect(e.body.rejected[0].reason).toMatch(/immutable/);
    const d = await sync(ownerA, { spray_events: { created: [], updated: [], deleted: [sprayId] } });
    expect(d.body.rejected[0].reason).toMatch(/locked/);
    const c = await sync(worker, { spray_events: C([{ id: randomUUID(), block_id: blockId, sprayed_on: '2026-03-20', corrects_id: sprayId, products: JSON.stringify([{ chemicalId: 'captan-50wp', dosePer100L: 300, unit: 'g', quantity: 500 }]), notes: 'actual quantity 500 g' }]) });
    expect(c.body.ok).toBe(true);
  });

  it('server re-checks compliance and flags violations on recorded facts', async () => {
    const r = await sync(worker, { spray_events: C([{ id: randomUUID(), block_id: blockId, sprayed_on: '2026-04-02', products: JSON.stringify([{ chemicalId: 'malathion-50ec', dosePer100L: 100, unit: 'ml', quantity: 200 }]) }]) });
    expect(r.body.flags[0].violations.map((v: { code: string }) => v.code)).toContain('BANNED');
    const v = await call('POST', '/v1/spray/validate', worker, { blockId, date: '2026-08-10', chemicalIds: ['captan-50wp'] });
    expect(v.body.map((x: { code: string }) => x.code)).toContain('PHI_DEFACTO');
  });
});

describe('weather worker, alerts, push', () => {
  it('ingests weather, writes daily rows and alerts, drains push outbox', async () => {
    await call('POST', '/v1/push-tokens', ownerA, { token: 'ExponentPushToken[test-token-123]', platform: 'android' });
    const res = await runCycle(db, synthetic(), BUNDLE_2026, new Date('2026-04-20T06:00:00Z'));
    expect(res.errors).toEqual([]);
    expect(res.orchards).toBe(1);
    expect(res.hours).toBe(168);
    const again = await runCycle(db, synthetic(), BUNDLE_2026, new Date('2026-04-20T06:00:00Z'));
    expect(again.newAlerts).toBe(0); // idempotent upserts
    const p = await pullAll(ownerA);
    expect(p.body.changes.weather_daily.created.length).toBeGreaterThanOrEqual(7);
    const sent: PushMessage[] = [];
    await sendPending(db, async (m) => { sent.push(...m); });
    expect(sent.every((m) => m.to.startsWith('ExponentPushToken'))).toBe(true);
    // Other tenant never sees this weather.
    expect((await pullAll(ownerB)).body.changes.weather_daily.created).toHaveLength(0);
  });

  it('forced alert: worker can acknowledge but not edit server-owned fields', async () => {
    const hours = Array.from({ length: 72 }, (_, i) => ({ time: new Date(Date.parse('2026-04-20T00:00:00Z') + i * 3_600_000).toISOString(), tempC: 12, rh: 97, precipMm: 1.2, isForecast: false }));
    const prov = { name: 'fixture', hourly: async () => hours };
    const r = await runCycle(db, prov, BUNDLE_2026, new Date('2026-04-22T23:00:00Z'));
    expect(r.newAlerts).toBeGreaterThan(0);
    const p = await pullAll(worker);
    const alert = p.body.changes.infection_alerts.created.find((a: { type: string }) => a.type === 'scab_infection');
    expect(alert).toBeTruthy();
    expect(alert.advisory).toBe(true);
    const ack = await sync(worker, { infection_alerts: { created: [], updated: [{ id: alert.id, acknowledged: true, acknowledged_at: new Date().toISOString(), title: 'hacked' }], deleted: [] } });
    expect(ack.body.ok).toBe(true);
    const after = (await pullAll(worker)).body.changes.infection_alerts.created.find((a: { id: string }) => a.id === alert.id);
    expect(after).toMatchObject({ acknowledged: true, title: alert.title });
    const tasks = (await pullAll(manager)).body.changes.tasks.created;
    expect(tasks.some((t: { alert_id: string }) => t.alert_id)).toBe(true);
  });

  it('open-meteo adapter parses unixtime hourly payload', async () => {
    const f = async () => ({ ok: true, status: 200, json: async () => ({ hourly: { time: [1776650400, 1776654000], temperature_2m: [10, 11], relative_humidity_2m: [90, 95], precipitation: [0, 1.2], dew_point_2m: [8, 10], wind_speed_10m: [3, 4], weather_code: [61, 96] } }) });
    const h = await openMeteo('http://om.local', undefined, f).hourly(33.7, 74.8, 1, 1, new Date(1776652000 * 1000));
    expect(h).toHaveLength(2);
    expect(h[1]).toMatchObject({ weatherCode: 96, isForecast: true, precipMm: 1.2 });
  });
});

describe('intelligence & reports', () => {
  it('plan, risk, reference etag, advisories, reports', async () => {
    const plan = await call('GET', `/v1/blocks/${blockId}/plan?date=2026-04-28&tank=400&stage=s06-petal-fall`, worker);
    expect(plan.status).toBe(200);
    const fung = plan.body.plan.find((p: { recommendation: { category: string } }) => p.recommendation.category === 'fungicide');
    expect(fung.options[0].dose.tankLitres).toBe(400);
    const risk = await call('GET', `/v1/orchards/${orchardId}/risk`, worker);
    expect(risk.status).toBe(200);
    expect(risk.body.scab.advisory).toBe(true);
    const ref = await call('GET', '/v1/reference/current', worker);
    expect(ref.body.stages).toHaveLength(15);
    const etag = ref.headers.etag as string;
    const r304 = await app.inject({ method: 'GET', url: '/v1/reference/current', headers: { authorization: `Bearer ${worker}`, 'if-none-match': etag } });
    expect(r304.statusCode).toBe(304);
    expect((await call('GET', '/v1/advisories/shopian', worker)).body.known).toBe(true);
    const csv = await call('GET', '/v1/reports/spray-log.csv?season=2026', manager);
    expect(csv.body.split('\n')[1]).toContain('Captan 50 WP');
    expect(csv.body).toContain('CIR-1234');
    expect((await call('GET', '/v1/reports/spray-log.csv?season=2026', worker)).status).toBe(403);
    const season = await call('GET', '/v1/reports/season?season=2026', manager);
    expect(season.body.blocks[0].sprays).toBeGreaterThanOrEqual(2);
    expect((await call('GET', `/v1/orchards/${orchardId}/risk`, ownerB)).status).toBe(404);
  });
});
