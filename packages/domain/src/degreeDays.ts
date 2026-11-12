import type { DailySummary } from './weather.js';
import { cToF } from './units.js';

/**
 * Single-sine, horizontal-cutoff degree-days (Baskerville & Emin 1969; UC IPM method).
 * Inputs and thresholds in the same unit.
 */
export function singleSineDD(min: number, max: number, lower: number, upper: number): number {
  if (max < min) [min, max] = [max, min];
  if (min >= upper) return upper - lower;
  if (max <= lower) return 0;
  const mean = (max + min) / 2;
  const a = (max - min) / 2;
  if (min >= lower && max <= upper) return mean - lower;
  const PI = Math.PI;
  if (min < lower && max <= upper) {
    const t1 = Math.asin((lower - mean) / a);
    return ((mean - lower) * (PI / 2 - t1) + a * Math.cos(t1)) / PI;
  }
  if (min >= lower && max > upper) {
    const t2 = Math.asin((upper - mean) / a);
    return ((mean - lower) * (t2 + PI / 2) + (upper - lower) * (PI / 2 - t2) - a * Math.cos(t2)) / PI;
  }
  const t1 = Math.asin((lower - mean) / a);
  const t2 = Math.asin((upper - mean) / a);
  return ((mean - lower) * (t2 - t1) + a * (Math.cos(t1) - Math.cos(t2)) + (upper - lower) * (PI / 2 - t2)) / PI;
}

export interface DDMilestone {
  dd: number;
  key: string;
  label: string;
  action?: string;
}

/** Codling moth (Cydia pomonella), °F-days after biofix, 50/88 °F, WSU/UC model. */
export const CODLING_MOTH_MILESTONES: DDMilestone[] = [
  { dd: 100, key: 'cm_egg_laying', label: 'Sustained egg laying begins' },
  { dd: 250, key: 'cm_first_hatch', label: 'First egg hatch (1st generation)', action: 'Apply first cover spray (ovicide/larvicide per schedule).' },
  { dd: 500, key: 'cm_peak_hatch', label: '≈30–50% 1st-generation egg hatch', action: 'Maintain cover; re-apply per product residual.' },
  { dd: 920, key: 'cm_hatch_end', label: '1st-generation egg hatch nearly complete' },
  { dd: 1000, key: 'cm_2nd_flight', label: '2nd-generation flight begins', action: 'Re-check traps; prepare 2nd-generation cover.' },
  { dd: 1260, key: 'cm_2nd_hatch', label: '2nd-generation egg hatch begins', action: 'Apply 2nd-generation cover spray (respect PHI).' },
];

export interface DDResult {
  date: string;
  dd: number;
  cumulative: number;
  reached: DDMilestone[];
}

/** Accumulate °F-days from biofix using daily min/max in °C. */
export function accumulateDD(
  days: DailySummary[],
  biofix: string,
  opts: { lowerF?: number; upperF?: number; milestones?: DDMilestone[] } = {},
): DDResult[] {
  const lower = opts.lowerF ?? 50, upper = opts.upperF ?? 88;
  const ms = [...(opts.milestones ?? CODLING_MOTH_MILESTONES)].sort((a, b) => a.dd - b.dd);
  let cum = 0;
  const out: DDResult[] = [];
  for (const d of days) {
    if (d.date < biofix) continue;
    const dd = singleSineDD(cToF(d.minC), cToF(d.maxC), lower, upper);
    const before = cum;
    cum += dd;
    out.push({ date: d.date, dd, cumulative: cum, reached: ms.filter((m) => before < m.dd && cum >= m.dd) });
  }
  return out;
}

/** Days until a DD target, projecting with the mean daily DD of the last `window` days. */
export function projectDate(results: DDResult[], targetDD: number, window = 7): { date: string; days: number } | null {
  const last = results.at(-1);
  if (!last) return null;
  if (last.cumulative >= targetDD) return { date: last.date, days: 0 };
  const recent = results.slice(-window);
  const rate = recent.reduce((s, r) => s + r.dd, 0) / recent.length;
  if (rate <= 0.01) return null;
  const days = Math.ceil((targetDD - last.cumulative) / rate);
  const d = new Date(Date.parse(last.date) + days * 86_400_000).toISOString().slice(0, 10);
  return { date: d, days };
}

/** Biofix helper: first date with N consecutive trap catches and sunset temp ≥ 62 °F (16.7 °C). */
export function detectBiofix(
  catches: { date: string; moths: number; sunsetTempC?: number }[],
  consecutive = 2,
): string | null {
  const s = [...catches].sort((a, b) => a.date.localeCompare(b.date));
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const warm = c.sunsetTempC == null || c.sunsetTempC >= 16.7;
    run = c.moths > 0 && warm ? run + 1 : 0;
    if (run >= consecutive) return s[i - consecutive + 1]!.date;
  }
  return null;
}
