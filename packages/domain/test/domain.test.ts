import { describe, expect, it } from 'vitest';
import { BUNDLE_2026, validateBundle } from '@orchard/reference';
import {
  scaleDose, formatQuantity, sprayVolumeLitres, validateSpray, isBlocked, singleSineDD, accumulateDD, detectBiofix,
  ascosporeHours, conidialHours, evaluateScab, wetPeriods, ascosporeMaturity, generateAlerts, currentStage, planStage,
  stageWindows, mergeIncoming, assessMaturity, fertiliserForStage, treesPerKanal, kanalToHectare, dailySummaries, diseaseRisks,
  nextStage, pollinizerCheck,
} from '../src/index.js';
import { series } from './helpers.js';

const B = BUNDLE_2026;

describe('reference bundle', () => {
  it('is internally consistent', () => expect(validateBundle(B)).toEqual([]));
  it('has 15 SKUAST-K 2026 stages in order', () => {
    expect(B.stages.map((s) => s.order)).toEqual([...Array(15)].map((_, i) => i + 1));
    expect(B.stages[4]!.pollinatorSensitive).toBe(true);
  });
  it('never recommends banned products', () => {
    const banned = new Set(B.chemicals.filter((c) => c.status === 'banned').map((c) => c.id));
    for (const r of B.recommendations) for (const o of r.options) expect(banned.has(o.chemicalId)).toBe(false);
  });
});

describe('units', () => {
  it('kanal conversions', () => {
    expect(kanalToHectare(19.77)).toBeCloseTo(1, 2);
    expect(treesPerKanal(1, 3)).toBe(168);
  });
});

describe('tank scaler', () => {
  it('scales per-100-L doses and preserves official figure', () => {
    const d = scaleDose({ chemicalId: 'captan-50wp', dosePer100L: 300, doseUnit: 'g' }, 600);
    expect(d.quantity).toBe(1800);
    expect(d.officialPer100L).toBe(300);
    expect(d.display).toBe('1.8 kg');
  });
  it('rejects bad tanks', () => expect(() => scaleDose({ chemicalId: 'x', dosePer100L: 1, doseUnit: 'g' }, 0)).toThrow());
  it('formats', () => {
    expect(formatQuantity(0.4, 'l')).toBe('400 ml');
    expect(formatQuantity(45, 'ml')).toBe('45 ml');
  });
  it('spray volume by system and age', () => {
    expect(sprayVolumeLitres({ trees: 20, system: 'traditional', treeAgeYears: 25 })).toBe(300);
    expect(sprayVolumeLitres({ trees: 167, system: 'hdp', treeAgeYears: 6 })).toBe(417.5);
  });
});

describe('compliance', () => {
  const base = { chemicals: B.chemicals, defactoPhiDays: B.defactoPhiDays, stages: B.stages };
  it('blocks banned malathion', () => {
    const v = validateSpray({ date: '2026-06-01', chemicalIds: ['malathion-50ec'] }, [], base);
    expect(v.map((x) => x.code)).toContain('BANNED');
    expect(isBlocked(v)).toBe(true);
  });
  it('blocks sprays inside 21 days of harvest, warns inside 28', () => {
    const v1 = validateSpray({ date: '2026-08-20', chemicalIds: ['captan-50wp'], plannedHarvestDate: '2026-09-05' }, [], base);
    expect(v1.find((x) => x.code === 'PHI_DEFACTO')?.severity).toBe('block');
    const v2 = validateSpray({ date: '2026-08-10', chemicalIds: ['captan-50wp'], plannedHarvestDate: '2026-09-05' }, [], base);
    expect(v2.find((x) => x.code === 'PHI_WINDOW_WARN')?.severity).toBe('warn');
    expect(isBlocked(v2)).toBe(false);
  });
  it('enforces label PHI beyond the de-facto window', () => {
    const v = validateSpray({ date: '2026-08-01', chemicalIds: ['chlorothalonil-75wp'], plannedHarvestDate: '2026-09-05' }, [], base);
    expect(v.find((x) => x.code === 'PHI_LABEL')).toBeTruthy();
  });
  it('nutrients are exempt from PHI', () => {
    const v = validateSpray({ date: '2026-09-01', chemicalIds: ['calcium-chloride'], plannedHarvestDate: '2026-09-05' }, [], base);
    expect(isBlocked(v)).toBe(false);
  });
  it('never repeats a molecule in consecutive fungicide sprays (mixtures included)', () => {
    const hist = [{ date: '2026-04-28', chemicalIds: ['difenoconazole-25ec'] }, { date: '2026-05-02', chemicalIds: ['chlorpyriphos-20ec'] }];
    const v = validateSpray({ date: '2026-05-12', chemicalIds: ['chlorothalonil-difenoconazole-44sc'] }, hist, base);
    expect(v.find((x) => x.code === 'REPEAT_MOLECULE')?.severity).toBe('block');
  });
  it('warns on same DMI group but different molecule', () => {
    const v = validateSpray({ date: '2026-05-12', chemicalIds: ['flusilazole-40ec'] }, [{ date: '2026-04-28', chemicalIds: ['difenoconazole-25ec'] }], base);
    expect(v.map((x) => x.code)).toEqual(['NO_HARVEST_DATE', 'REPEAT_FRAC_GROUP']);
  });
  it('multi-site protectants may follow each other if molecules differ', () => {
    const v = validateSpray({ date: '2026-04-01', chemicalIds: ['captan-50wp'] }, [{ date: '2026-03-20', chemicalIds: ['mancozeb-75wp'] }], base);
    expect(v.filter((x) => x.severity !== 'info')).toEqual([]);
  });
  it('blocks insecticides at flowering and warns on tank mixes and short gaps', () => {
    const v = validateSpray({ date: '2026-04-20', chemicalIds: ['thiacloprid-217sc', 'captan-50wp'], stageId: 's05-flowering' }, [{ date: '2026-04-18', chemicalIds: ['mancozeb-75wp'] }], base);
    const codes = v.map((x) => x.code);
    expect(codes).toContain('BLOOM_INSECTICIDE');
    expect(codes).toContain('MIX_FUNGICIDE_INSECTICIDE');
    expect(codes).toContain('INSECTICIDE_FUNGICIDE_GAP');
  });
  it('caps DMI use per season', () => {
    const dmis = ['difenoconazole-25ec', 'flusilazole-40ec', 'penconazole-10ec', 'hexaconazole-5ec'];
    const hist = dmis.map((id, i) => ({ date: `2026-0${4 + Math.floor(i / 2)}-${10 + (i % 2) * 10}`, chemicalIds: [id, 'captan-50wp'] }));
    const v = validateSpray({ date: '2026-07-20', chemicalIds: ['myclobutanil-10wp'] }, hist, base);
    expect(v.map((x) => x.code)).toContain('SEASON_GROUP_CAP');
  });
});

describe('degree days', () => {
  it('single sine matches known cases', () => {
    expect(singleSineDD(55, 75, 50, 88)).toBeCloseTo(15, 5);
    expect(singleSineDD(40, 45, 50, 88)).toBe(0);
    expect(singleSineDD(90, 95, 50, 88)).toBe(38);
    const dd = singleSineDD(40, 80, 50, 88);
    expect(dd).toBeGreaterThan(10);
    expect(dd).toBeLessThan(15);
    expect(singleSineDD(60, 100, 50, 88)).toBeLessThan(30);
  });
  it('accumulates from biofix and reports milestones', () => {
    const days = [...Array(40)].map((_, i) => ({ date: `2026-05-${String(i + 1).padStart(2, '0')}`.replace(/-05-(3[2-9]|4\d)/, (m) => m), minC: 12, maxC: 28, meanC: 20, precipMm: 0, meanRh: 50, hours: 24 }))
      .slice(0, 31);
    const r = accumulateDD(days, '2026-05-01');
    expect(r.at(-1)!.cumulative).toBeGreaterThan(250);
    expect(r.some((x) => x.reached.some((m) => m.key === 'cm_first_hatch'))).toBe(true);
  });
  it('biofix detection', () => {
    expect(detectBiofix([{ date: '2026-05-01', moths: 0 }, { date: '2026-05-03', moths: 2, sunsetTempC: 18 }, { date: '2026-05-04', moths: 4, sunsetTempC: 19 }])).toBe('2026-05-03');
  });
});

describe('scab (revised Mills)', () => {
  it('table lookups', () => {
    expect(ascosporeHours(10)).toBe(11);
    expect(ascosporeHours(18)).toBe(6);
    expect(ascosporeHours(0)).toBe(Infinity);
    expect(conidialHours(20)).toBeCloseTo(7.9);
    expect(ascosporeHours(10.5)).toBeCloseTo(10);
  });
  it('detects a light primary infection at 12 h / 10 °C in daylight', () => {
    const h = series('2026-04-10T08:00', [{ hours: 12, tempC: 10, rh: 95, precipMm: 1 }, { hours: 12, tempC: 12, rh: 60 }]);
    const inf = evaluateScab(h, { primarySeason: ['2026-03-15', '2026-05-15'] });
    expect(inf).toHaveLength(1);
    expect(inf[0]).toMatchObject({ type: 'primary', severity: 'light', wetHours: 12, advisory: true });
  });
  it('no infection when wetness is too short', () => {
    const h = series('2026-04-10T08:00', [{ hours: 8, tempC: 10, rh: 95 }, { hours: 12, tempC: 12, rh: 60 }]);
    expect(evaluateScab(h, { primarySeason: ['2026-03-15', '2026-05-15'] })).toHaveLength(0);
  });
  it('bridges dry gaps shorter than 8 h', () => {
    const h = series('2026-04-10T08:00', [{ hours: 6, tempC: 10, rh: 95 }, { hours: 4, tempC: 10, rh: 70 }, { hours: 6, tempC: 10, rh: 95 }, { hours: 10, tempC: 10, rh: 60 }]);
    const p = wetPeriods(h);
    expect(p).toHaveLength(1);
    expect(p[0]!.wetHours).toBe(12);
  });
  it('night rule discounts pre-dawn wet hours for ascospores', () => {
    const h = series('2026-04-10T21:00', [{ hours: 14, tempC: 10, rh: 95, precipMm: 1 }, { hours: 10, tempC: 14, rh: 60 }]);
    // 21:00–11:00 wet: only 06:00–11:00 = 5 h count → no infection.
    expect(evaluateScab(h, { primarySeason: ['2026-03-15', '2026-05-15'] })).toHaveLength(0);
    expect(evaluateScab(h, { primarySeason: ['2026-03-15', '2026-05-15'], nightDischargeRule: false })).toHaveLength(1);
  });
  it('severity bands and local calibration factor', () => {
    const h = series('2026-04-10T08:00', [{ hours: 30, tempC: 10, rh: 98, precipMm: 1 }, { hours: 12, tempC: 12, rh: 50 }]);
    expect(evaluateScab(h, { primarySeason: ['2026-03-15', '2026-05-15'] })[0]!.severity).toBe('severe');
    const light = series('2026-04-10T08:00', [{ hours: 12, tempC: 10, rh: 95 }, { hours: 12, tempC: 12, rh: 60 }]);
    expect(evaluateScab(light, { primarySeason: ['2026-03-15', '2026-05-15'], wetHoursFactor: 1.2 })).toHaveLength(0);
  });
  it('PAT model matches the Kashmir validation milestones', () => {
    expect(ascosporeMaturity(157)).toBeCloseTo(0.016, 2);
    expect(ascosporeMaturity(955)).toBeCloseTo(0.99, 2);
    expect(ascosporeMaturity(534)).toBeGreaterThan(0.4);
  });
});

describe('alerts', () => {
  it('protect-before-rain, spray window and frost', () => {
    const past = series('2026-04-01T00:00', [{ hours: 24 * 9, tempC: 8, rh: 60 }]);
    const fut = series('2026-04-10T00:00', [{ hours: 8, tempC: -3, rh: 60, isForecast: true }, { hours: 10, tempC: 14, rh: 50, isForecast: true }, { hours: 12, tempC: 9, rh: 97, precipMm: 1.5, isForecast: true }]);
    const now = new Date(Date.parse('2026-04-10T00:00+05:30') - 1).toISOString();
    const a = generateAlerts({ orchardId: 'o1', now, hours: [...past, ...fut], scabSusceptible: true, lastFungicide: { date: '2026-03-25' }, phenologyStage: 'full-pink', criticalTemps: B.criticalTemps, scab: { primarySeason: ['2026-03-15', '2026-05-15'] } });
    const types = a.map((x) => x.type);
    expect(types).toContain('protect_before_rain');
    expect(types).toContain('frost');
    expect(types).toContain('spray_window');
    expect(a.find((x) => x.type === 'frost')!.severity).toBe('high');
    expect(new Set(a.map((x) => x.dedupeKey)).size).toBe(a.length);
  });
  it('hail from WMO code', () => {
    const now = new Date().toISOString();
    const h = [{ time: new Date(Date.now() + 3_600_000 * 5).toISOString(), tempC: 20, rh: 80, precipMm: 10, weatherCode: 96, isForecast: true }];
    expect(generateAlerts({ orchardId: 'o', now, hours: h }).some((x) => x.type === 'hail')).toBe(true);
  });
});

describe('planner', () => {
  it('finds stage by date and elevation', () => {
    expect(currentStage(B.stages, '2026-04-15')!.id).toBe('s05-flowering');
    expect(currentStage(B.stages, '2026-04-15', { elevationM: 2300 })!.order).toBeLessThan(5);
    expect(currentStage(B.stages, '2026-01-15')!.id).toBe('s15-dormancy');
    expect(currentStage(B.stages, '2026-01-15', { observedStageId: 's02-green-tip' })!.id).toBe('s02-green-tip');
    expect(stageWindows(B.stages, 2026).at(-1)!.end).toBe('2027-02-19');
    expect(nextStage(B.stages, '2026-03-01')!.stage.id).toBe('s02-green-tip');
  });
  it('plans petal fall with rotation, thresholds and tank scaling', () => {
    const plan = planStage(B, 's06-petal-fall', {
      date: '2026-05-01', system: 'traditional', tankLitres: 200, rainForecastMm48h: 12,
      history: [{ date: '2026-04-12', chemicalIds: ['chlorothalonil-difenoconazole-44sc'] }],
      scouting: { mitesPerLeaf: 2 },
    });
    const fung = plan.find((p) => p.recommendation.category === 'fungicide')!;
    expect(fung.status).toBe('due');
    const difen = fung.options.find((o) => o.chemical.id === 'difenoconazole-25ec')!;
    expect(difen.eligible).toBe(false);
    expect(difen.dose.quantity).toBe(60);
    expect(fung.options[0]!.eligible).toBe(true);
    expect(fung.options.filter((o) => o.preferred)).toHaveLength(1);
    expect(plan.find((p) => p.recommendation.category === 'miticide')!.status).toBe('not_needed');
  });
  it('low-spray programme skips scab-only protectants for resistant varieties', () => {
    const plan = planStage(B, 's02-green-tip', { date: '2026-03-20', system: 'traditional', tankLitres: 100, history: [], scabResistant: true, rainForecastMm48h: 20 });
    expect(plan[0]!.status).toBe('skipped_resistant');
  });
  it('pre-harvest filters products by PHI', () => {
    const plan = planStage(B, 's12-pre-harvest', { date: '2026-08-10', system: 'traditional', tankLitres: 100, history: [], plannedHarvestDate: '2026-09-08' });
    const f = plan.find((p) => p.recommendation.category === 'fungicide')!;
    expect(f.options.find((o) => o.chemical.id === 'propineb-70wp')!.eligible).toBe(false);
    expect(f.options.find((o) => o.chemical.id === 'captan-50wp')!.eligible).toBe(true);
  });
});

describe('sync merge', () => {
  it('append-only records reject updates once locked', () => {
    expect(mergeIncoming('append_only', { id: '1', locked: true, dose: 1 }, { id: '1', dose: 2 }, ['dose'], false).action).toBe('reject');
  });
  it('field merge unions arrays and applies only changed fields', () => {
    const r = mergeIncoming('field_merge', { id: '1', photos: ['a'], severity: 2, notes: 'x' }, { id: '1', photos: ['b'], severity: 2, notes: 'stale' }, ['photos'], true);
    expect(r.row).toMatchObject({ photos: ['a', 'b'], notes: 'x' });
  });
  it('strips server-owned columns', () => {
    const r = mergeIncoming('lww', undefined, { id: '1', tenant_id: 'evil', name: 'A' }, undefined, false);
    expect(r.row).toEqual({ name: 'A' });
  });
});

describe('agronomy', () => {
  it('harvest maturity', () => {
    const v = B.varieties.find((x) => x.id === 'red-delicious')!;
    const r = assessMaturity({ date: '2026-09-15', firmnessLb: 17, tssBrix: 13, starchIndex: 3.5, redColourPct: 80, seedBrownPct: 80 }, { variety: v, fullBloom: '2026-04-30' });
    expect(r.ready).toBe(true);
    expect(r.dafb).toBe(138);
    expect(assessMaturity({ date: '2026-08-15', firmnessLb: 22, tssBrix: 9, starchIndex: 1.5 }).ready).toBe(false);
  });
  it('fertiliser splits by stage', () => {
    const f = fertiliserForStage('s02-green-tip', 15, 20)!;
    expect(f.perTree).toMatchObject({ ureaG: 350, dapG: 645, mopG: 750, fymKg: 100 });
    expect(fertiliserForStage('s05-flowering', 10, 1)).toBeNull();
  });
  it('pollinizer share', () => {
    expect(pollinizerCheck([{ varietyId: 'red-delicious', trees: 90 }, { varietyId: 'golden-delicious', trees: 10 }], B.varieties).ok).toBe(true);
  });
  it('disease risk indices', () => {
    const h = series('2026-07-01T00:00', [{ hours: 24 * 7, tempC: 27, rh: 95, precipMm: 0.5 }]);
    const r = diseaseRisks(h);
    expect(r.find((x) => x.key === 'alternaria')!.level).toBe('high');
    expect(dailySummaries(h)).toHaveLength(7);
  });
});

import { regulatoryImpact } from '../src/index.js';
describe('regulatory impact', () => {
  it('current schedule has no affected entries; a new ban flags entries and lists alternatives', () => {
    expect(regulatoryImpact(B)).toEqual([]);
    const banned = { ...B, chemicals: B.chemicals.map((c) => (c.id === 'captan-50wp' ? { ...c, status: 'banned' as const, statusReference: 'hypothetical' } : c)) };
    const impact = regulatoryImpact(banned);
    expect(impact.length).toBeGreaterThan(3);
    const gt = impact.find((i) => i.recommendationId.startsWith('s02'))!;
    expect(gt.alternatives).toContain('mancozeb-75wp');
    expect(gt.alternatives).not.toContain('captan-50wp');
  });
});
