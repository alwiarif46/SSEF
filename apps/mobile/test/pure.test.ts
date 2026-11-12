import { describe, expect, it } from 'vitest';
import { SYNC_TABLES, SYNC_SCHEMA_VERSION, planStage } from '@orchard/domain';
import { BUNDLE_2026 } from '@orchard/reference';
import { buildTableSpecs, COLUMN_TYPES } from '../src/db/schemaDef';
import { decodeRow, encodeRow } from '../src/db/codec';
import { acceptedAppendOnly, normalizePulled, preparePush, pullUrl, pushUrl, toRejectedIds, type Changes } from '../src/sync/mapping';
import { buildPlanContext, expiryStatus, latestScouting, sprayHistory, usageByChemical, weatherHours } from '../src/lib/context';
import { uuidv4 } from '../src/lib/uuid';

const empty = (): Changes => Object.fromEntries(SYNC_TABLES.map((t) => [t.name, { created: [], updated: [], deleted: [] }]));

describe('schema generation', () => {
  const specs = buildTableSpecs();
  it('covers every sync table with timestamps', () => {
    expect(specs.map((s) => s.name)).toEqual(SYNC_TABLES.map((t) => t.name));
    for (const s of specs) {
      expect(s.columns.map((c) => c.name)).toContain('created_at');
      expect(s.columns.map((c) => c.name)).toContain('updated_at');
      expect(s.columns.some((c) => c.name === 'id' || c.name === 'tenant_id')).toBe(false);
    }
  });
  it('json columns become strings, required columns non-optional, FKs indexed', () => {
    const spray = specs.find((s) => s.name === 'spray_events')!;
    expect(spray.columns.find((c) => c.name === 'products')).toEqual({ name: 'products', type: 'string' });
    expect(spray.columns.find((c) => c.name === 'block_id')).toEqual({ name: 'block_id', type: 'string', isIndexed: true });
    expect(spray.columns.find((c) => c.name === 'locked')).toMatchObject({ type: 'boolean', isOptional: true });
    expect(SYNC_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});

describe('codec', () => {
  it('round-trips json and drops unknown columns', () => {
    const enc = encodeRow('spray_events', { block_id: 'b', products: [{ chemicalId: 'captan-50wp', quantity: 600 }], tank_litres: '200', bogus: 1 });
    expect(enc).toEqual({ block_id: 'b', products: '[{"chemicalId":"captan-50wp","quantity":600}]', tank_litres: 200 });
    const dec = decodeRow<{ products: unknown[] }>('spray_events', { id: 'x', ...enc });
    expect(dec.products).toEqual([{ chemicalId: 'captan-50wp', quantity: 600 }]);
    expect(COLUMN_TYPES.blocks!.variety_mix).toBe('json');
  });
});

describe('sync mapping', () => {
  it('builds urls', () => {
    expect(pullUrl('http://h/', null)).toBe(`http://h/v1/sync?last_pulled_at=0&schema_version=${SYNC_SCHEMA_VERSION}`);
    expect(pushUrl('http://h', 5)).toBe('http://h/v1/sync?last_pulled_at=5');
  });
  it('normalizes pulled rows: objects → json strings, strips server-only fields, fills missing tables', () => {
    const c = normalizePulled({ blocks: { created: [{ id: 'b1', tenant_id: 't', name: 'A', system_type: 'hdp', variety_mix: [{ varietyId: 'gala-redlum', trees: 100 }], tree_count: '100', scab_resistant: 'true', created_at: '2026-01-01T00:00:00Z', server_updated_at: 9 }] } });
    expect(c.blocks!.created[0]).toEqual({ id: 'b1', name: 'A', system_type: 'hdp', variety_mix: '[{"varietyId":"gala-redlum","trees":100}]', tree_count: 100, scab_resistant: true, created_at: Date.parse('2026-01-01T00:00:00Z') });
    expect(Object.keys(c)).toHaveLength(SYNC_TABLES.length);
  });
  it('push: drops pull-only tables except alert acknowledgement fields', () => {
    const ch = empty();
    ch.orchards!.created.push({ id: 'o1', name: 'X', _status: 'created', _changed: '' });
    ch.weather_daily!.updated.push({ id: 'w1', min_c: 1, _status: 'updated', _changed: 'min_c' });
    ch.infection_alerts!.updated.push({ id: 'a1', title: 'hacked', acknowledged: true, _status: 'updated', _changed: 'acknowledged,title' });
    const p = preparePush(ch);
    expect(Object.keys(p).sort()).toEqual(['infection_alerts', 'orchards']);
    expect(p.infection_alerts!.updated[0]).toEqual({ id: 'a1', _status: 'updated', _changed: 'acknowledged', acknowledged: true });
  });
  it('rejected ids and append-only acceptance', () => {
    const ch = empty();
    ch.spray_events!.created.push({ id: 's1' }, { id: 's2' });
    ch.orchards!.created.push({ id: 'o1' });
    const res = { ok: true, rejected: [{ table: 'spray_events', id: 's2', reason: 'locked' }] };
    expect(toRejectedIds(res)).toEqual({ spray_events: ['s2'] });
    expect(acceptedAppendOnly(ch, res)).toEqual({ spray_events: ['s1'] });
  });
});

describe('planner context from rows', () => {
  const block = { id: 'b', orchard_id: 'o', name: 'B', system_type: 'traditional' as const, expected_harvest_date: '2026-09-10', scab_resistant: false };
  const events = [
    { id: 'e1', block_id: 'b', sprayed_on: '2026-04-12', products: [{ chemicalId: 'chlorothalonil-difenoconazole-44sc', dosePer100L: 180, unit: 'ml', quantity: 360, recommendationId: 's04-pink-bud-r04' }] },
    { id: 'e2', block_id: 'b', sprayed_on: '2026-04-13', products: [{ chemicalId: 'captan-50wp', dosePer100L: 300, unit: 'g', quantity: 600 }], corrects_id: undefined },
  ];
  it('history ignores corrected originals', () => {
    const h = sprayHistory([...events, { id: 'e3', block_id: 'b', sprayed_on: '2026-04-13', products: [{ chemicalId: 'mancozeb-75wp', dosePer100L: 300, unit: 'g', quantity: 600 }], corrects_id: 'e2' }]);
    expect(h.map((x) => x.chemicalIds[0])).toEqual(['chlorothalonil-difenoconazole-44sc', 'mancozeb-75wp']);
  });
  it('feeds planStage end to end', () => {
    const weather = [{ id: 'w', orchard_id: 'o', day: '2026-05-01', is_forecast: true, precip_mm: 8, hourly: [{ time: '2026-05-01T12:00:00.000Z', tempC: 12, rh: 95, precipMm: 8 }] }];
    const scouting = [{ id: 'x', block_id: 'b', observed_on: '2026-04-29', pest_id: 'european-red-mite', value: 7 }];
    const ctx = buildPlanContext({ block, events, scouting, weather, chemicals: BUNDLE_2026.chemicals, date: '2026-05-01', tankLitres: 200, nowIso: '2026-05-01T00:00:00.000Z' });
    expect(ctx.rainForecastMm48h).toBe(8);
    expect(ctx.scouting?.mitesPerLeaf).toBe(7);
    expect(ctx.daysSinceFungicide).toBe(18);
    expect(ctx.doneRecommendationIds).toEqual(['s04-pink-bud-r04']);
    const plan = planStage(BUNDLE_2026, 's06-petal-fall', ctx);
    expect(plan.find((p) => p.recommendation.category === 'fungicide')!.status).toBe('due');
    expect(plan.find((p) => p.recommendation.category === 'miticide')!.status).toBe('due');
    expect(plan.find((p) => p.recommendation.category === 'fungicide')!.options.find((o) => o.chemical.id === 'difenoconazole-25ec')!.eligible).toBe(true);
  });
  it('misc helpers', () => {
    expect(weatherHours([{ id: 'w', orchard_id: 'o', day: 'd', hourly: [{ time: 'b', tempC: 1, rh: 1, precipMm: 0 }, { time: 'a', tempC: 1, rh: 1, precipMm: 0 }, null as never] }]).map((h) => h.time)).toEqual(['a', 'b']);
    expect(latestScouting([], '2026-05-01')).toEqual({ observedTargets: [] });
    expect(usageByChemical([{ chemicalId: 'a', quantity: 1 }, { chemicalId: 'a', quantity: 2 }])).toEqual({ a: 3 });
    expect(expiryStatus('2026-01-01', '2026-05-01')).toBe('expired');
    expect(expiryStatus('2026-06-01', '2026-05-01')).toBe('soon');
    expect(uuidv4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
