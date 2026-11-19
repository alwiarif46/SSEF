import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { createPool, withTenant, type Db } from '../src/db.js';
import { pull, PULL_OVERLAP_MS } from '../src/sync/sync.js';
import { sendPending, type PushMessage } from '../src/push.js';
import { accountsConfig } from '../src/lanes/accounts/config.js';
import { LogSms, logSms, msg91Sms, msisdn, e164, twilioSms, type FetchLike } from '../src/lanes/accounts/sms.js';
import { inQuietHours, wantsAlert, DEFAULT_PREFS } from '../src/lanes/accounts/prefs.js';

const ADMIN = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DBNAME = `orchard_lane_accounts_test_${process.pid}`;
const DB_ADMIN_URL = ADMIN.replace(/\/postgres$/, `/${DBNAME}`);
let db: Db;
let app: FastifyInstance;
let su: pg.Client;

const defaults = structuredClone(accountsConfig);

beforeAll(async () => {
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${DBNAME}`);
  await c.query(`CREATE DATABASE ${DBNAME}`);
  await c.end();
  await migrate(DB_ADMIN_URL, () => {});
  db = createPool(`postgres://orchard_app:orchard_app@localhost:5432/${DBNAME}`);
  su = new pg.Client({ connectionString: DB_ADMIN_URL });
  await su.connect();
  app = buildApp(db);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await db?.end();
  await su?.end();
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${DBNAME}`);
  await c.end();
});

beforeEach(() => {
  Object.assign(accountsConfig.otp, defaults.otp, { resendCooldownSec: 0 });
  Object.assign(accountsConfig.login, defaults.login);
});

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
const call = async (method: Method, url: string, token?: string, payload?: unknown, ip = '127.0.0.1') => {
  const r = await app.inject({ method, url, remoteAddress: ip, ...(payload ? { payload: payload as object } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, body: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body, headers: r.headers };
};
const C = (rows: unknown[]) => ({ created: rows, updated: [], deleted: [] });
const sync = (token: string, changes: Record<string, unknown>, lastPulledAt = 0) => call('POST', `/v1/sync?last_pulled_at=${lastPulledAt}`, token, { changes });
const pullAll = (token: string, lastPulledAt = 0) => call('GET', `/v1/sync?last_pulled_at=${lastPulledAt}&schema_version=1`, token);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

let owner = '', manager = '', worker = '', worker2 = '', otherOwner = '';
let tenantId = '', workerId = '', worker2Id = '', managerId = '', otherWorkerId = '';
const OWNER_PHONE = '9622000001', MANAGER_PHONE = '9622000002', WORKER_PHONE = '9622000003', WORKER2_PHONE = '9622000004';

const login = async (phone: string, password: string) => (await call('POST', '/v1/auth/login', undefined, { phone, password })).body as { token: string; user: { id: string } };

describe('setup', () => {
  it('creates two tenants with a manager and two workers', async () => {
    const s = await call('POST', '/v1/auth/signup', undefined, { tenantName: 'Wani Orchards', name: 'Rafiq Wani', phone: OWNER_PHONE, password: 'owner-pass-1' });
    expect(s.status).toBe(201);
    owner = s.body.token;
    tenantId = s.body.tenant.id;
    for (const [name, phone, role, pw] of [['Manzoor', MANAGER_PHONE, 'manager', 'manager-pass-1'], ['Gulzar', WORKER_PHONE, 'worker', 'worker-pass-1'], ['Shabir', WORKER2_PHONE, 'worker', 'worker-pass-2']] as const)
      expect((await call('POST', '/v1/users', owner, { name, phone, password: pw, role })).status).toBe(201);
    const m = await login(MANAGER_PHONE, 'manager-pass-1');
    const w = await login(WORKER_PHONE, 'worker-pass-1');
    const w2 = await login(WORKER2_PHONE, 'worker-pass-2');
    [manager, managerId, worker, workerId, worker2, worker2Id] = [m.token, m.user.id, w.token, w.user.id, w2.token, w2.user.id];
    const o = await call('POST', '/v1/auth/signup', undefined, { tenantName: 'Other Co', name: 'Other Owner', phone: '9622000099', password: 'other-pass-1' });
    otherOwner = o.body.token;
    expect((await call('POST', '/v1/users', otherOwner, { name: 'Other Worker', phone: '9622000098', password: 'other-pass-2', role: 'worker' })).status).toBe(201);
    otherWorkerId = (await login('9622000098', 'other-pass-2')).user.id;
  });
});

describe('SMS OTP login', () => {
  it('answers identically for known and unknown phones and only delivers to accounts', async () => {
    logSms.clear();
    const known = await call('POST', '/v1/auth/otp/request', undefined, { phone: WORKER_PHONE, purpose: 'login' });
    const unknown = await call('POST', '/v1/auth/otp/request', undefined, { phone: '9622999999', purpose: 'login' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(logSms.lastOtp(WORKER_PHONE)).toMatch(/^[0-9]{6}$/);
    expect(logSms.lastOtp('9622999999')).toBeUndefined();
    expect((await call('POST', '/v1/auth/otp/verify', undefined, { phone: '9622999999', code: '123456', purpose: 'login' })).status).toBe(401);
  });

  it('stores only a hash, verifies once and returns a working token', async () => {
    await call('POST', '/v1/auth/otp/request', undefined, { phone: WORKER_PHONE, purpose: 'login' });
    const code = logSms.lastOtp(WORKER_PHONE)!;
    const { rows } = await su.query('SELECT code_hash FROM app.otp_codes WHERE phone = $1 AND consumed_at IS NULL', [WORKER_PHONE]);
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).not.toContain(code);
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
    const ok = await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER_PHONE, code, purpose: 'login' });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ id: workerId, role: 'worker', phone: WORKER_PHONE });
    expect((await call('GET', '/v1/me', ok.body.token)).body.user.id).toBe(workerId);
    expect((await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER_PHONE, code, purpose: 'login' })).status).toBe(401);
  });

  it('a login code cannot be used for reset, and a new code supersedes the old one', async () => {
    await call('POST', '/v1/auth/otp/request', undefined, { phone: WORKER_PHONE, purpose: 'login' });
    const first = logSms.lastOtp(WORKER_PHONE)!;
    expect((await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER_PHONE, code: first, purpose: 'reset' })).status).toBe(401);
    await call('POST', '/v1/auth/otp/request', undefined, { phone: WORKER_PHONE, purpose: 'login' });
    const second = logSms.lastOtp(WORKER_PHONE)!;
    if (first !== second) expect((await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER_PHONE, code: first, purpose: 'login' })).status).toBe(401);
    expect((await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER_PHONE, code: second, purpose: 'login' })).status).toBe(200);
  });

  it('burns the code after 5 wrong attempts', async () => {
    await call('POST', '/v1/auth/otp/request', undefined, { phone: WORKER_PHONE, purpose: 'login' });
    const code = logSms.lastOtp(WORKER_PHONE)!;
    const wrong = code === '000000' ? '111111' : '000000';
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER_PHONE, code: wrong, purpose: 'login' }));
    expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(results[4]!.body.error).toMatch(/too many wrong attempts/);
    expect((await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER_PHONE, code, purpose: 'login' })).status).toBe(401);
  });

  it('expires codes', async () => {
    await call('POST', '/v1/auth/otp/request', undefined, { phone: WORKER_PHONE, purpose: 'login' });
    const code = logSms.lastOtp(WORKER_PHONE)!;
    await su.query(`UPDATE app.otp_codes SET expires_at = now() - interval '1 second' WHERE phone = $1 AND consumed_at IS NULL`, [WORKER_PHONE]);
    expect((await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER_PHONE, code, purpose: 'login' })).status).toBe(401);
  });

  it('rate-limits per phone (cooldown + window) and per IP, identically for unknown phones', async () => {
    accountsConfig.otp.resendCooldownSec = 30;
    expect((await call('POST', '/v1/auth/otp/request', undefined, { phone: '9622555001', purpose: 'login' })).status).toBe(200);
    const again = await call('POST', '/v1/auth/otp/request', undefined, { phone: '9622555001', purpose: 'login' });
    expect(again.status).toBe(429);
    expect(again.headers['retry-after']).toBe('30');
    accountsConfig.otp.resendCooldownSec = 0;
    accountsConfig.otp.phoneMaxPerWindow = 2;
    expect((await call('POST', '/v1/auth/otp/request', undefined, { phone: '9622555001', purpose: 'reset' })).status).toBe(200);
    expect((await call('POST', '/v1/auth/otp/request', undefined, { phone: '9622555001', purpose: 'login' })).status).toBe(429);
    accountsConfig.otp.phoneMaxPerWindow = 100;
    accountsConfig.otp.ipMaxPerWindow = 3;
    const ip = '10.9.8.7';
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await call('POST', '/v1/auth/otp/request', undefined, { phone: `962277700${i}`, purpose: 'login' }, ip)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect((await call('POST', '/v1/auth/otp/request', undefined, { phone: '9622777009', purpose: 'login' }, '10.9.8.8')).status).toBe(200);
  });

  it('validates input', async () => {
    expect((await call('POST', '/v1/auth/otp/request', undefined, { phone: 'abc', purpose: 'login' })).status).toBe(400);
    expect((await call('POST', '/v1/auth/otp/request', undefined, { phone: WORKER_PHONE, purpose: 'admin' })).status).toBe(400);
    expect((await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER_PHONE, code: 'abcdef', purpose: 'login' })).status).toBe(400);
  });
});

describe('password reset', () => {
  it('resets via OTP + single-use reset token and clears a lockout', async () => {
    for (let i = 0; i < 5; i++) await call('POST', '/v1/auth/login', undefined, { phone: WORKER2_PHONE, password: 'nope-nope' });
    expect((await call('POST', '/v1/auth/login', undefined, { phone: WORKER2_PHONE, password: 'worker-pass-2' })).status).toBe(429);
    await call('POST', '/v1/auth/otp/request', undefined, { phone: WORKER2_PHONE, purpose: 'reset' });
    const code = logSms.lastOtp(WORKER2_PHONE)!;
    const v = await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER2_PHONE, code, purpose: 'reset' });
    expect(v.status).toBe(200);
    expect(v.body.token).toBeUndefined();
    expect(typeof v.body.resetToken).toBe('string');
    expect((await call('POST', '/v1/auth/password/reset', undefined, { resetToken: v.body.resetToken, password: 'short' })).status).toBe(400);
    expect((await call('POST', '/v1/auth/password/reset', undefined, { resetToken: v.body.resetToken, password: 'brand-new-pass-2' })).status).toBe(200);
    expect((await call('POST', '/v1/auth/password/reset', undefined, { resetToken: v.body.resetToken, password: 'another-pass-22' })).status).toBe(401);
    expect((await call('POST', '/v1/auth/login', undefined, { phone: WORKER2_PHONE, password: 'worker-pass-2' })).status).toBe(401);
    const ok = await call('POST', '/v1/auth/login', undefined, { phone: WORKER2_PHONE, password: 'brand-new-pass-2' });
    expect(ok.status).toBe(200);
    worker2 = ok.body.token;
  });

  it('rejects forged and expired reset tokens', async () => {
    expect((await call('POST', '/v1/auth/password/reset', undefined, { resetToken: 'x'.repeat(43), password: 'brand-new-pass-3' })).status).toBe(401);
    await call('POST', '/v1/auth/otp/request', undefined, { phone: WORKER2_PHONE, purpose: 'reset' });
    const v = await call('POST', '/v1/auth/otp/verify', undefined, { phone: WORKER2_PHONE, code: logSms.lastOtp(WORKER2_PHONE)!, purpose: 'reset' });
    await su.query(`UPDATE app.password_resets SET expires_at = now() - interval '1 second' WHERE phone = $1 AND used_at IS NULL`, [WORKER2_PHONE]);
    expect((await call('POST', '/v1/auth/password/reset', undefined, { resetToken: v.body.resetToken, password: 'brand-new-pass-3' })).status).toBe(401);
  });
});

describe('login throttling (Postgres-backed)', () => {
  it('locks a phone after 5 failures for 15 minutes, shared across app instances', async () => {
    const phone = MANAGER_PHONE;
    const r = [];
    for (let i = 0; i < 5; i++) r.push((await call('POST', '/v1/auth/login', undefined, { phone, password: 'wrong-pass' })).status);
    expect(r).toEqual([401, 401, 401, 401, 401]);
    const locked = await call('POST', '/v1/auth/login', undefined, { phone, password: 'manager-pass-1' });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(14 * 60);
    const { rows: [row] } = await su.query(`SELECT failures, locked_until > now() + interval '14 minutes' AS long FROM app.login_throttle WHERE scope = 'phone' AND key = $1`, [phone]);
    expect(row).toMatchObject({ failures: 5, long: true });
    const app2 = buildApp(db);
    await app2.ready();
    expect((await app2.inject({ method: 'POST', url: '/v1/auth/login', payload: { phone, password: 'manager-pass-1' } })).statusCode).toBe(429);
    await app2.close();
    // Lock expiry restores access and a success clears the counter.
    await su.query(`UPDATE app.login_throttle SET locked_until = now() - interval '1 second' WHERE key = $1`, [phone]);
    expect((await call('POST', '/v1/auth/login', undefined, { phone, password: 'manager-pass-1' })).status).toBe(200);
    expect((await su.query(`SELECT 1 FROM app.login_throttle WHERE scope = 'phone' AND key = $1`, [phone])).rowCount).toBe(0);
  });

  it('caps failures per IP across phones', async () => {
    accountsConfig.login.ipMaxFailures = 3;
    const ip = '10.1.1.1';
    const r = [];
    for (let i = 0; i < 4; i++) r.push((await call('POST', '/v1/auth/login', undefined, { phone: `962288800${i}`, password: 'wrong-pass' }, ip)).status);
    expect(r).toEqual([401, 401, 401, 429]);
    expect((await call('POST', '/v1/auth/login', undefined, { phone: OWNER_PHONE, password: 'owner-pass-1' }, ip)).status).toBe(429);
    expect((await call('POST', '/v1/auth/login', undefined, { phone: OWNER_PHONE, password: 'owner-pass-1' }, '10.1.1.2')).status).toBe(200);
  });
});

// ── Orchard assignment ─────────────────────────────────────────────────────
const O1 = randomUUID(), O2 = randomUUID(), B1 = randomUUID(), B2 = randomUUID();
const T_MINE_O2 = randomUUID(), T_OTHER_O2 = randomUUID(), T_O1 = randomUUID(), S_B2 = randomUUID(), A_O2 = randomUUID();

describe('worker orchard assignment', () => {
  it('seeds two orchards with blocks, tasks, sprays and an alert', async () => {
    const r = await sync(manager, {
      orchards: C([{ id: O1, name: 'Shopian Upper' }, { id: O2, name: 'Pulwama Lower' }]),
      blocks: C([{ id: B1, orchard_id: O1, name: 'B1', system_type: 'hdp' }, { id: B2, orchard_id: O2, name: 'B2', system_type: 'traditional' }]),
      tasks: C([
        { id: T_MINE_O2, orchard_id: O2, title: 'Prune', kind: 'pruning', status: 'open', assignee_user_id: workerId },
        { id: T_OTHER_O2, orchard_id: O2, title: 'Mow', kind: 'other', status: 'open' },
        { id: T_O1, orchard_id: O1, block_id: B1, title: 'Scout', kind: 'scouting', status: 'open' },
      ]),
    });
    expect(r.body).toMatchObject({ ok: true });
    expect((await sync(worker, { spray_events: C([{ id: S_B2, block_id: B2, sprayed_on: '2026-04-01', products: JSON.stringify([{ chemicalId: 'captan-50wp', dosePer100L: 300 }]) }]) })).body.ok).toBe(true);
    await su.query(`INSERT INTO public.infection_alerts (id, tenant_id, orchard_id, dedupe_key, type, severity, title) VALUES ($1, $2, $3, 'k1', 'frost', 'high', 'Frost')`, [A_O2, tenantId, O2]);
  });

  it('REST: owner/manager only, workers only, tenant-scoped, orchards validated', async () => {
    expect((await call('GET', `/v1/users/${workerId}/orchards`, manager)).body).toEqual({ userId: workerId, role: 'worker', orchardIds: [] });
    expect((await call('PUT', `/v1/users/${workerId}/orchards`, worker, { orchardIds: [O1] })).status).toBe(403);
    expect((await call('GET', `/v1/users/${workerId}/orchards`, worker)).status).toBe(403);
    expect((await call('PUT', `/v1/users/${managerId}/orchards`, owner, { orchardIds: [O1] })).status).toBe(400);
    const bad = await call('PUT', `/v1/users/${workerId}/orchards`, manager, { orchardIds: [O1, 'not-an-orchard-1'] });
    expect(bad.status).toBe(400);
    expect(bad.body.orchardIds).toEqual(['not-an-orchard-1']);
    expect((await call('PUT', `/v1/users/${otherWorkerId}/orchards`, owner, { orchardIds: [O1] })).status).toBe(404);
    expect((await call('PUT', `/v1/users/${workerId}/orchards`, otherOwner, { orchardIds: [] })).status).toBe(404);
    expect((await call('GET', '/v1/user-orchards', manager)).body).toEqual([]);
  });

  it('unassigned workers keep seeing everything', async () => {
    const p = await pullAll(worker);
    expect(ids(p.body.changes.orchards.created)).toEqual([O1, O2].sort());
  });

  it('assigned worker pulls only assigned orchards (plus own tasks); incremental pull evicts the rest', async () => {
    const before = await pullAll(worker);
    const ts = before.body.timestamp;
    await new Promise((res) => setTimeout(res, 20));
    const put = await call('PUT', `/v1/users/${workerId}/orchards`, manager, { orchardIds: [O1, O1] });
    expect(put.body).toEqual({ userId: workerId, orchardIds: [O1] });
    expect((await call('GET', '/v1/user-orchards', owner)).body).toEqual([{ userId: workerId, orchardIds: [O1] }]);

    const full = (await pullAll(worker)).body.changes;
    expect(ids(full.orchards.created)).toEqual([O1]);
    expect(ids(full.blocks.created)).toEqual([B1]);
    expect(ids(full.tasks.created)).toEqual([T_MINE_O2, T_O1].sort());
    expect(full.spray_events.created).toHaveLength(0);
    expect(full.infection_alerts.created).toHaveLength(0);

    const inc = (await pullAll(worker, ts)).body.changes;
    expect(inc.orchards.deleted).toEqual([O2]);
    expect(inc.blocks.deleted).toEqual([B2]);
    expect(inc.tasks.deleted).toEqual([T_OTHER_O2]);
    expect(inc.spray_events.deleted).toEqual([S_B2]);
    expect(inc.infection_alerts.deleted).toEqual([A_O2]);
    expect(ids(inc.orchards.updated)).toEqual([O1]);

    // Once the checkpoint is past the change (and the re-send overlap window), nothing is re-sent.
    const ts2 = (await pullAll(worker, ts)).body.timestamp;
    const quiet = (await pullAll(worker, ts2 + PULL_OVERLAP_MS + 1000)).body.changes;
    expect(quiet.orchards.deleted).toHaveLength(0);
    expect(quiet.orchards.updated).toHaveLength(0);

    // Managers and other (unassigned) workers are unaffected.
    expect(ids((await pullAll(manager)).body.changes.orchards.created)).toEqual([O1, O2].sort());
    expect(ids((await pullAll(worker2)).body.changes.blocks.created)).toEqual([B1, B2].sort());
  });

  it('pull(viewer) applies the same scope when called directly', async () => {
    const r = await withTenant(db, tenantId, (tx) => pull(tx, 0, { userId: workerId, tenantId, role: 'worker' }));
    expect(ids(r.changes.blocks.created as { id: string }[])).toEqual([B1]);
    const all = await withTenant(db, tenantId, (tx) => pull(tx, 0));
    expect(ids(all.changes.blocks.created as { id: string }[])).toEqual([B1, B2].sort());
  });

  it('assigned worker cannot write outside assigned orchards', async () => {
    const blocked = await sync(worker, {
      spray_events: C([{ id: randomUUID(), block_id: B2, sprayed_on: '2026-04-05', products: JSON.stringify([{ chemicalId: 'captan-50wp', dosePer100L: 300 }]) }]),
      scouting_observations: C([{ id: randomUUID(), block_id: B2, observed_on: '2026-04-05', pest_id: 'scab' }]),
      trap_catches: C([{ id: randomUUID(), orchard_id: O2, trap_code: 'T1', caught_on: '2026-04-05', moths: 3 }]),
      tasks: { created: [], updated: [{ id: T_OTHER_O2, status: 'done', _changed: 'status' }], deleted: [] },
      infection_alerts: { created: [], updated: [{ id: A_O2, acknowledged: true }], deleted: [] },
    });
    expect(blocked.body.rejected).toHaveLength(5);
    expect(new Set(blocked.body.rejected.map((x: { reason: string }) => x.reason))).toEqual(new Set(['orchard not assigned to you']));
    // Writes inside the assigned orchard are accepted.
    const moved = await sync(worker, { scouting_observations: C([{ id: randomUUID(), block_id: B1, observed_on: '2026-04-05', pest_id: 'scab' }]) });
    expect(moved.body.ok).toBe(true);
    const allowed = await sync(worker, {
      spray_events: C([{ id: randomUUID(), block_id: B1, sprayed_on: '2026-04-05', products: JSON.stringify([{ chemicalId: 'captan-50wp', dosePer100L: 300 }]) }]),
      tasks: { created: [], updated: [{ id: T_MINE_O2, status: 'done', _changed: 'status' }, { id: T_O1, status: 'in_progress', _changed: 'status' }], deleted: [] },
    });
    expect(allowed.body).toMatchObject({ ok: true, rejected: [] });
    const hijack = await sync(worker, { tasks: { created: [], updated: [{ id: T_O1, orchard_id: O2, _changed: 'orchard_id' }], deleted: [] } });
    expect(hijack.body.rejected[0].reason).toBe('orchard not assigned to you');
    // The unassigned worker still writes anywhere.
    const free = await sync(worker2, { scouting_observations: C([{ id: randomUUID(), block_id: B2, observed_on: '2026-04-05', pest_id: 'scab' }]) });
    expect(free.body.ok).toBe(true);
  });

  it('widening and clearing assignments re-sends the full visible set', async () => {
    const ts = (await pullAll(worker)).body.timestamp;
    await new Promise((res) => setTimeout(res, 20));
    await call('PUT', `/v1/users/${workerId}/orchards`, owner, { orchardIds: [O1, O2] });
    const inc = (await pullAll(worker, ts)).body.changes;
    expect(ids(inc.orchards.updated)).toEqual([O1, O2].sort());
    expect(inc.orchards.deleted).toEqual([]);
    const ts2 = (await pullAll(worker)).body.timestamp;
    await new Promise((res) => setTimeout(res, 20));
    expect((await call('PUT', `/v1/users/${workerId}/orchards`, owner, { orchardIds: [] })).body.orchardIds).toEqual([]);
    const cleared = (await pullAll(worker, ts2)).body.changes;
    expect(ids(cleared.blocks.updated)).toEqual([B1, B2].sort());
  });
});

// ── Notification preferences + push ────────────────────────────────────────
describe('notification preferences', () => {
  it('defaults, validation, round trip, per-user isolation', async () => {
    const d = await call('GET', '/v1/me/notifications', worker);
    expect(d.body).toMatchObject({ alertTypes: null, minSeverity: 'low', quietHoursStart: null, quietHoursEnd: null, smsFallback: false });
    expect(d.body.options.alertTypes).toContain('scab_infection');
    expect((await call('GET', '/v1/me/notifications')).status).toBe(401);
    expect((await call('PUT', '/v1/me/notifications', worker, { alertTypes: null, minSeverity: 'low', quietHoursStart: '22:00', quietHoursEnd: null, smsFallback: false })).status).toBe(400);
    expect((await call('PUT', '/v1/me/notifications', worker, { alertTypes: null, minSeverity: 'extreme', quietHoursStart: null, quietHoursEnd: null, smsFallback: false })).status).toBe(400);
    expect((await call('PUT', '/v1/me/notifications', worker, { alertTypes: null, minSeverity: 'low', quietHoursStart: '25:00', quietHoursEnd: '06:00', smsFallback: false })).status).toBe(400);
    const put = await call('PUT', '/v1/me/notifications', worker, { alertTypes: ['frost', 'hail', 'frost'], minSeverity: 'medium', quietHoursStart: '22:00', quietHoursEnd: '06:00', smsFallback: true });
    expect(put.body).toEqual({ alertTypes: ['frost', 'hail'], minSeverity: 'medium', quietHoursStart: '22:00', quietHoursEnd: '06:00', smsFallback: true });
    expect((await call('GET', '/v1/me/notifications', worker)).body).toMatchObject(put.body);
    expect((await call('GET', '/v1/me/notifications', worker2)).body.alertTypes).toBeNull();
    const { rows } = await su.query('SELECT tenant_id FROM public.notification_prefs WHERE user_id = $1', [workerId]);
    expect(rows[0].tenant_id).toBe(tenantId);
  });

  it('quiet hours and filters (unit)', () => {
    const p = { ...DEFAULT_PREFS, quietHoursStart: '22:00', quietHoursEnd: '06:00' };
    expect(inQuietHours(p, new Date('2026-04-20T17:00:00Z'))).toBe(true); // 22:30 IST
    expect(inQuietHours(p, new Date('2026-04-20T00:15:00Z'))).toBe(true); // 05:45 IST
    expect(inQuietHours(p, new Date('2026-04-20T00:30:00Z'))).toBe(false); // 06:00 IST
    expect(inQuietHours({ quietHoursStart: '13:00', quietHoursEnd: '14:00' }, new Date('2026-04-20T07:45:00Z'))).toBe(true); // 13:15 IST
    expect(wantsAlert(p, { type: 'frost', severity: 'critical' }, new Date('2026-04-20T17:00:00Z'))).toBe(true);
    expect(wantsAlert(p, { type: 'frost', severity: 'high' }, new Date('2026-04-20T17:00:00Z'))).toBe(false);
    expect(wantsAlert({ ...DEFAULT_PREFS, minSeverity: 'high' }, { severity: 'medium' }, new Date())).toBe(false);
    expect(wantsAlert({ ...DEFAULT_PREFS, alertTypes: ['hail'] }, { type: 'frost', severity: 'critical' }, new Date())).toBe(false);
    expect(wantsAlert({ ...DEFAULT_PREFS, alertTypes: [] }, { type: 'frost', severity: 'critical' }, new Date())).toBe(false);
  });

  it('push delivery honours prefs, quiet hours, assignments; critical SMS fallback', async () => {
    // Fresh tenant so recipients are fully controlled.
    const s = await call('POST', '/v1/auth/signup', undefined, { tenantName: 'Push Co', name: 'Push Owner', phone: '9633000001', password: 'push-pass-01' });
    const pOwner = s.body.token, pTenant = s.body.tenant.id;
    const mk = async (name: string, phone: string, role: 'manager' | 'worker') => {
      await call('POST', '/v1/users', pOwner, { name, phone, password: 'push-pass-02', role });
      return login(phone, 'push-pass-02');
    };
    const frostOnly = await mk('Frost Only', '9633000002', 'manager');
    const highOnly = await mk('High Only', '9633000003', 'manager');
    const sleeper = await mk('Sleeper', '9633000004', 'worker');
    const noToken = await mk('No Token', '9633000005', 'worker');
    const scoped = await mk('Scoped', '9633000006', 'worker');
    const PO1 = randomUUID(), PO2 = randomUUID();
    await sync(pOwner, { orchards: C([{ id: PO1, name: 'P1' }, { id: PO2, name: 'P2' }]) });
    await call('PUT', `/v1/users/${scoped.user.id}/orchards`, pOwner, { orchardIds: [PO1] });
    const tok = (u: string) => `ExponentPushToken[${u}]`;
    for (const [t, u] of [[pOwner, 'owner'], [frostOnly.token, 'frost'], [highOnly.token, 'high'], [sleeper.token, 'sleeper'], [scoped.token, 'scoped']] as const)
      await call('POST', '/v1/push-tokens', t, { token: tok(u), platform: 'android' });
    const prefs = (token: string, b: object) => call('PUT', '/v1/me/notifications', token, { alertTypes: null, minSeverity: 'low', quietHoursStart: null, quietHoursEnd: null, smsFallback: false, ...b });
    await prefs(frostOnly.token, { alertTypes: ['frost'] });
    await prefs(highOnly.token, { minSeverity: 'high' });
    await prefs(sleeper.token, { quietHoursStart: '22:00', quietHoursEnd: '06:00' });
    await prefs(noToken.token, { smsFallback: true });

    const alert = async (orchard: string, type: string, severity: string, title: string) => {
      const id = randomUUID();
      await su.query(`INSERT INTO public.infection_alerts (id, tenant_id, orchard_id, dedupe_key, type, severity, title) VALUES ($1, $2, $3, $1, $4, $5, $6)`, [id, pTenant, orchard, type, severity, title]);
      await su.query(`INSERT INTO public.push_outbox (tenant_id, alert_id, title, body, data) VALUES ($1, $2, $3, 'body', $4)`, [pTenant, id, title, JSON.stringify({ orchardId: orchard, type })]);
    };
    await alert(PO1, 'scab_infection', 'medium', 'scab-medium-P1');
    await alert(PO2, 'frost', 'critical', 'frost-critical-P2');
    await alert(PO1, 'hail', 'high', 'hail-high-P1');

    const sent: PushMessage[] = [];
    const sms = new LogSms(() => {});
    // 22:30 IST: the sleeper only gets critical alerts.
    const n = await sendPending(db, async (m) => { sent.push(...m); }, { sms, now: new Date('2026-04-20T17:00:00Z') });
    expect(n).toBeGreaterThanOrEqual(3);
    const got = (u: string) => sent.filter((m) => m.to === tok(u)).map((m) => m.title).sort();
    expect(got('owner')).toEqual(['frost-critical-P2', 'hail-high-P1', 'scab-medium-P1']);
    expect(got('frost')).toEqual(['frost-critical-P2']);
    expect(got('high')).toEqual(['frost-critical-P2', 'hail-high-P1']);
    expect(got('sleeper')).toEqual(['frost-critical-P2']);
    expect(got('scoped')).toEqual(['hail-high-P1', 'scab-medium-P1']);
    expect(sms.sent.map((m) => [m.to, m.kind])).toEqual([['9633000005', 'alert']]);
    expect(sms.sent[0]!.text).toContain('frost-critical-P2');
    const { rows } = await su.query(`SELECT count(*)::int AS n FROM public.push_outbox WHERE tenant_id = $1 AND status = 'pending'`, [pTenant]);
    expect(rows[0].n).toBe(0);
  });

  it('a failing push sender leaves messages pending and sends no SMS', async () => {
    const s = await call('POST', '/v1/auth/signup', undefined, { tenantName: 'Fail Co', name: 'Fail Owner', phone: '9644000001', password: 'fail-pass-01' });
    await call('POST', '/v1/push-tokens', s.body.token, { token: 'ExponentPushToken[fail-owner]', platform: 'android' });
    await call('POST', '/v1/users', s.body.token, { name: 'Sms User', phone: '9644000002', password: 'fail-pass-02', role: 'worker' });
    const w = await login('9644000002', 'fail-pass-02');
    await call('PUT', '/v1/me/notifications', w.token, { alertTypes: null, minSeverity: 'low', quietHoursStart: null, quietHoursEnd: null, smsFallback: true });
    await su.query(`INSERT INTO public.push_outbox (tenant_id, title, body, data) VALUES ($1, 'Critical', 'b', '{"type":"frost","severity":"critical"}')`, [s.body.tenant.id]);
    const sms = new LogSms(() => {});
    await sendPending(db, async () => { throw new Error('expo down'); }, { sms });
    expect(sms.sent).toHaveLength(0);
    const { rows } = await su.query(`SELECT status, attempts FROM public.push_outbox WHERE tenant_id = $1`, [s.body.tenant.id]);
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1 });
  });
});

// ── SMS drivers ────────────────────────────────────────────────────────────
describe('SMS providers', () => {
  const recorder = (status = 200, response = '{"type":"success"}') => {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const f: FetchLike = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, text: async () => response }; };
    return { calls, f };
  };

  it('normalises numbers', () => {
    expect(msisdn('9419000001')).toBe('919419000001');
    expect(msisdn('+919419000001')).toBe('919419000001');
    expect(msisdn('09419000001')).toBe('919419000001');
    expect(e164('9419000001')).toBe('+919419000001');
  });

  it('msg91 Flow API request', async () => {
    const { calls, f } = recorder();
    await msg91Sms({ authKey: 'AK', templateId: 'TPL', fetch: f }).send({ to: '9419000001', kind: 'otp', text: 'x', vars: { otp: '123456' } });
    expect(calls[0]!.url).toBe('https://control.msg91.com/api/v5/flow');
    expect(calls[0]!.init.headers.authkey).toBe('AK');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ template_id: 'TPL', short_url: '0', recipients: [{ mobiles: '919419000001', otp: '123456' }] });
    await expect(msg91Sms({ authKey: 'AK', templateId: 'TPL', fetch: recorder(200, '{"type":"error","message":"bad template"}').f }).send({ to: '9419000001', kind: 'otp', text: 'x', vars: { otp: '1' } })).rejects.toThrow(/bad template/);
    await expect(msg91Sms({ authKey: 'AK', templateId: 'TPL', fetch: recorder(401, 'nope').f }).send({ to: '9419000001', kind: 'otp', text: 'x', vars: {} })).rejects.toThrow(/HTTP 401/);
    await expect(msg91Sms({ authKey: 'AK', templateId: 'TPL', fetch: f }).send({ to: '9419000001', kind: 'alert', text: 'x', vars: {} })).rejects.toThrow(/MSG91_ALERT_TEMPLATE_ID/);
  });

  it('twilio Messages API request', async () => {
    const { calls, f } = recorder(201, '{}');
    await twilioSms({ sid: 'AC1', token: 'tok', from: '+15550001111', fetch: f }).send({ to: '9419000001', kind: 'otp', text: 'Your code 123456', vars: { otp: '123456' } });
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(calls[0]!.init.headers.authorization).toBe(`Basic ${Buffer.from('AC1:tok').toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.init.body))).toEqual({ To: '+919419000001', From: '+15550001111', Body: 'Your code 123456' });
    await expect(twilioSms({ sid: 'AC1', token: 'tok', from: '+1', fetch: recorder(400, 'bad').f }).send({ to: '9419000001', kind: 'otp', text: 'x', vars: {} })).rejects.toThrow(/twilio SMS failed/);
    await expect(twilioSms({ sid: '', token: '', from: '', fetch: f }).send({ to: '9419000001', kind: 'otp', text: 'x', vars: {} })).rejects.toThrow(/TWILIO_SID/);
  });
});

describe('database privileges', () => {
  it('app role cannot read pre-tenant tables directly', async () => {
    for (const t of ['app.otp_codes', 'app.password_resets', 'app.login_throttle'])
      await expect(db.query(`SELECT * FROM ${t} LIMIT 1`)).rejects.toThrow(/permission denied/);
  });
});
