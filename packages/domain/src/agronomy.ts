import type { Variety } from '@orchard/reference';
import { FERTILISER_BY_AGE, FERTILISER_SPLITS, SPRAY_VOLUME_L_PER_TREE, HDP_FERTIGATION } from '@orchard/reference';
import { daysBetween } from './dates.js';
import { round } from './units.js';

// ── Harvest maturity ────────────────────────────────────────────────────────

export interface MaturitySample {
  date: string;
  firmnessLb?: number;
  tssBrix?: number;
  starchIndex?: number; // 1–6 (SKUAST-K) scale
  redColourPct?: number;
  seedBrownPct?: number;
}

export interface MaturityVerdict {
  ready: boolean;
  score: number; // 0..1 share of indices passing
  purpose: 'ca_storage' | 'table';
  checks: { index: string; value?: number; target: string; pass?: boolean }[];
  dafb?: number;
  advice: string;
}

/** SKUAST-K 2026 harvest indices: starch 2.5 (CA) / 3.5 (table), red > 75%, TSS 12–14, firmness 16–18 lb, seed > 75% brown. */
export function assessMaturity(s: MaturitySample, opts: { variety?: Variety; fullBloom?: string; purpose?: 'ca_storage' | 'table' } = {}): MaturityVerdict {
  const purpose = opts.purpose ?? 'table';
  const v = opts.variety;
  const starchTarget = purpose === 'ca_storage' ? 2.5 : 3.5;
  const firmMin = v?.maturity?.firmnessLbMin ?? 16;
  const firmMax = v?.maturity?.firmnessLbMax ?? 18;
  const tssMin = v?.maturity?.tssBrixMin ?? 12;
  const colourMatters = !/golden|granny|sunehari/i.test(v?.name ?? '');
  const checks: MaturityVerdict['checks'] = [
    { index: 'Starch-iodine', value: s.starchIndex, target: purpose === 'ca_storage' ? '≈ 2.5' : '≈ 3.5', pass: s.starchIndex == null ? undefined : Math.abs(s.starchIndex - starchTarget) <= 0.5 || s.starchIndex > starchTarget },
    { index: 'TSS (°Brix)', value: s.tssBrix, target: `≥ ${tssMin}`, pass: s.tssBrix == null ? undefined : s.tssBrix >= tssMin },
    { index: 'Firmness (lb)', value: s.firmnessLb, target: `${firmMin}–${firmMax}`, pass: s.firmnessLb == null ? undefined : s.firmnessLb <= firmMax + 0.5 && s.firmnessLb >= firmMin - 2 },
    { index: 'Seed colour (% brown)', value: s.seedBrownPct, target: '> 75%', pass: s.seedBrownPct == null ? undefined : s.seedBrownPct > 75 },
  ];
  if (colourMatters) checks.push({ index: 'Red colour (%)', value: s.redColourPct, target: '> 75%', pass: s.redColourPct == null ? undefined : s.redColourPct > 75 });
  let dafb: number | undefined;
  if (opts.fullBloom) {
    dafb = daysBetween(opts.fullBloom, s.date);
    if (v?.dafbMin != null) checks.push({ index: 'Days after full bloom', value: dafb, target: `${v.dafbMin}–${v.dafbMax ?? v.dafbMin + 10}`, pass: dafb >= v.dafbMin });
  }
  const measured = checks.filter((c) => c.pass != null);
  const passing = measured.filter((c) => c.pass).length;
  const score = measured.length ? passing / measured.length : 0;
  const tooSoft = s.firmnessLb != null && s.firmnessLb < firmMin - 2;
  const ready = measured.length >= 2 && score >= 0.75;
  const advice = tooSoft
    ? 'Fruit is softening past storage quality — harvest immediately and market quickly.'
    : ready
      ? purpose === 'ca_storage' ? 'Ready for CA-storage harvest.' : 'Ready for table-fruit harvest. Pick in 2–3 rounds.'
      : measured.length < 2 ? 'Measure at least two indices (starch, TSS, firmness).' : 'Not yet mature — re-sample in 3–5 days.';
  return { ready, score: round(score, 2), purpose, checks, ...(dafb != null ? { dafb } : {}), advice };
}

// ── Nutrients ───────────────────────────────────────────────────────────────

export function annualFertiliser(treeAgeYears: number) {
  const age = Math.max(1, Math.min(15, Math.floor(treeAgeYears)));
  return FERTILISER_BY_AGE.find((r) => r.age === age)!;
}

/** Per-tree and per-block fertiliser for a stage (SKUAST-K split). */
export function fertiliserForStage(stageId: string, treeAgeYears: number, trees: number) {
  const split = FERTILISER_SPLITS.find((s) => s.stageId === stageId);
  if (!split) return null;
  const a = annualFertiliser(treeAgeYears);
  const perTree = { fymKg: round(a.fymKg * split.fym, 1), ureaG: round(a.ureaG * split.urea, 0), dapG: round(a.dapG * split.dap, 0), mopG: round(a.mopG * split.mop, 0) };
  return {
    perTree,
    block: { fymKg: round(perTree.fymKg * trees, 0), ureaKg: round((perTree.ureaG * trees) / 1000, 1), dapKg: round((perTree.dapG * trees) / 1000, 1), mopKg: round((perTree.mopG * trees) / 1000, 1) },
    note: 'Place fertiliser 1–2 ft from the trunk in moist soil. Rain-fed: half N and all P & K at the first dose.',
  };
}

export function hdpFertigationSplit(plantingYear: number, season: number) {
  const year = Math.max(1, Math.min(5, season - plantingYear + 1));
  const r = HDP_FERTIGATION.perSplitByYear.find((x) => x.year === year)!;
  return { ...r, splits: HDP_FERTIGATION.splits, window: [HDP_FERTIGATION.start, HDP_FERTIGATION.end] as const, provenance: HDP_FERTIGATION.provenance };
}

// ── Spray volume ────────────────────────────────────────────────────────────

export function litresPerTree(system: 'traditional' | 'hdp' | 'medium_density', ageYears: number): number {
  const t = SPRAY_VOLUME_L_PER_TREE[system];
  return t.find((r) => ageYears <= r.maxAge)!.l;
}

// ── Pollination ─────────────────────────────────────────────────────────────

/** Recommend 10–20% pollinizers (≥ 1 in every 5–10 trees), Golden Delicious/crabs in Kashmir. */
export function pollinizerCheck(mix: { varietyId: string; trees: number }[], varieties: Variety[]) {
  const total = mix.reduce((s, m) => s + m.trees, 0);
  const pol = mix
    .filter((m) => {
      const v = varieties.find((x) => x.id === m.varietyId);
      return v && (v.pollinizerRole === 'pollinizer' || v.pollinizerRole === 'both');
    })
    .reduce((s, m) => s + m.trees, 0);
  const share = total ? pol / total : 0;
  return { share: round(share * 100, 1), ok: share >= 0.1, advice: share >= 0.1 ? 'Pollinizer share adequate.' : 'Plant or top-work pollinizers (Golden Delicious, Red Fuji, crab apple) to ≥ 10–20% of trees; place 3–4 bee hives/ha at 5–10% bloom.' };
}
