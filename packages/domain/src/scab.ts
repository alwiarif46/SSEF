import { isNightIst, isWet, normaliseHours, type WeatherHour, type WetnessOptions } from './weather.js';
import { istHour } from './dates.js';

/**
 * Apple scab (Venturia inaequalis) infection engine — Revised Mills
 * (MacHardy & Gadoury 1989, extended to low temperatures by Stensvand et al. 1997).
 *
 * ADVISORY ONLY. Indian Himalayan studies show Mills needs local adjustment (more wetting
 * required; symptoms 1–2 days later). Until a tenant region is calibrated (`calibrated: true`)
 * every event is flagged advisory and must never suppress a scheduled spray.
 */

/**
 * Revised Mills (Stensvand et al. 1997 / MacHardy & Gadoury 1989) — hours of continuous leaf
 * wetness for a LIGHT infection by mean °C. Columns: [°C, ascospore h, conidia h].
 * Source: BC Ministry of Agriculture & OMAFRA revised Mills table (verified).
 */
export const REVISED_MILLS: ReadonlyArray<[tempC: number, ascospore: number, conidia: number]> = [
  [1, 40.5, 37.4], [2, 34.7, 33.6], [3, 29.6, 30.0], [4, 27.8, 26.6], [5, 21.2, 23.4],
  [6, 18.0, 20.5], [7, 15.4, 17.8], [8, 13.4, 15.2], [9, 12.2, 12.6], [10, 11.0, 10.0],
  [11, 9.0, 9.5], [12, 8.3, 9.3], [13, 8.0, 9.2], [14, 7.0, 9.2], [15, 7.0, 9.2],
  [16, 6.1, 9.0], [17, 6.0, 8.8], [18, 6.0, 8.5], [19, 6.0, 8.2], [20, 6.0, 7.9],
  [21, 6.0, 7.8], [22, 6.0, 7.8], [23, 6.0, 8.3], [24, 6.1, 9.3], [25, 8.0, 11.1], [26, 11.3, 14.0],
];

/** OMAFRA (Mills adapted, Stensvand & Carisse 2006) primary-infection bands: [°C, light, moderate, heavy]. */
export const MILLS_SEVERITY: ReadonlyArray<[number, number, number, number]> = [
  [1, 40, 69, 93], [2, 34, 69, 93], [3, 30, 52, 65], [4, 27, 42, 57], [5, 21, 34, 50], [6, 18, 27, 44],
  [7, 15, 23, 37], [8, 13, 21, 34], [9, 12, 17, 27], [10, 11, 16, 26], [11, 9, 14, 22], [12, 8, 12, 20],
  [13, 8, 12, 20], [14, 7, 11, 19], [15, 7, 11, 19], [16, 6, 9, 16], [24, 6, 9, 16], [25, 8, 11, 18], [26, 10, 14, 23],
];

/** @deprecated kept for API compatibility: ascospore column only. */
export const REVISED_MILLS_ASCOSPORE: ReadonlyArray<[number, number]> = REVISED_MILLS.map(([t, a]) => [t, a]);

/** Severity multipliers derived from the OMAFRA bands (moderate ≈ 1.5×, heavy ≈ 2.5× light). */
export const SEVERITY_FACTORS = { moderate: 1.5, severe: 2.5 } as const;

function interp<T extends readonly number[]>(table: ReadonlyArray<T>, col: number, x: number): number {
  if (x < table[0]![0]! - 0.5 || x > table.at(-1)![0]! + 0.5) return Infinity;
  if (x <= table[0]![0]!) return table[0]![col]!;
  for (let i = 1; i < table.length; i++) {
    const r1 = table[i]!, r0 = table[i - 1]!;
    if (x <= r1[0]!) return r0[col]! + ((r1[col]! - r0[col]!) * (x - r0[0]!)) / (r1[0]! - r0[0]!);
  }
  return table.at(-1)![col]!;
}

/**
 * Proportion of seasonal ascospores mature (PAT). Logistic fit to the SKUAST-K Kashmir validation
 * of the Rossi model (Bashir et al., Sci. Rep. 2026): onset PAT 0.016 at ≈157 CDD, exhaustion
 * PAT 0.99 at ≈955 CDD; CDD = hourly degree-days base 0 °C (/24) from green tip.
 */
export function ascosporeMaturity(cdd: number): number {
  return 1 / (1 + Math.exp(5.833 - 0.01092 * cdd));
}

/** Hourly base-0 °C degree-days (in degree-day units) from a start instant. */
export function cumulativeDegreeDaysBase0(hours: WeatherHour[], fromIso: string): number {
  return hours.filter((h) => h.time >= fromIso).reduce((s, h) => s + Math.max(0, h.tempC) / 24, 0);
}

export type ScabSeverity = 'light' | 'moderate' | 'severe';

export interface ScabOptions extends WetnessOptions {
  /** Dry interruptions shorter than this do not end a wet period (MacHardy-Gadoury: 8 h). */
  maxDryGapHours?: number;
  /** Primary-ascospore season [start, end] ISO dates (green tip → ascospore depletion, ≈ early June in Kashmir). */
  primarySeason?: [string, string];
  /** Green-tip instant: when set, primary season is decided by the Kashmir PAT model instead. */
  greenTip?: string;
  /** Ascospores are mostly released in daylight: if wetting begins at night, count from 06:00 IST. */
  nightDischargeRule?: boolean;
  /** Local calibration multiplier on required hours (India: > 1.0). */
  wetHoursFactor?: number;
  /** Extra days added to symptom-expression estimate (India: 1–2). */
  incubationLagDays?: number;
  calibrated?: boolean;
}

export interface ScabInfection {
  start: string;
  end: string;
  wetHours: number;
  meanTempC: number;
  type: 'primary' | 'secondary';
  severity: ScabSeverity;
  requiredHours: number;
  /** Estimated date lesions become visible. */
  symptomsExpected: string;
  /** Latest instant a curative (post-infection) fungicide can still act, by class. */
  curativeDeadlines: { class: string; until: string }[];
  advisory: boolean;
  forecast: boolean;
}

export interface WetPeriod {
  start: string;
  end: string;
  wetHours: number;
  meanTempC: number;
  hours: WeatherHour[];
  forecast: boolean;
}

/** Interpolated light-infection threshold for ascospores at `tempC`. Infinity outside table range. */
export const ascosporeHours = (tempC: number) => interp(REVISED_MILLS, 1, tempC);

/** Conidial (secondary) light-infection threshold (Stensvand 1997 column). */
export const conidialHours = (tempC: number) => interp(REVISED_MILLS, 2, tempC);

/** Hours for moderate / heavy primary infection (OMAFRA bands). */
export const moderateHours = (tempC: number) => interp(MILLS_SEVERITY, 2, tempC);
export const heavyHours = (tempC: number) => interp(MILLS_SEVERITY, 3, tempC);

/** Approximate incubation (days) to visible lesions, decreasing with temperature (Mills). */
export function incubationDays(meanTempC: number): number {
  // Lesion appearance (days) from the revised Mills table.
  const t: [number, number][] = [[6, 17], [9, 17], [10, 16], [11, 15], [13, 14], [15, 12.5], [16, 9.5], [22, 9.5]];
  if (meanTempC <= 6) return 18;
  if (meanTempC >= 22) return 9;
  return Math.round(interp(t, 1, meanTempC));
}

const HOUR = 3_600_000;

/** Group hourly data into wet periods, bridging dry gaps shorter than maxDryGapHours. */
export function wetPeriods(raw: WeatherHour[], o: ScabOptions = {}): WetPeriod[] {
  const hours = normaliseHours(raw);
  const gap = o.maxDryGapHours ?? 8;
  const out: WetPeriod[] = [];
  let cur: WeatherHour[] = [];
  let dryRun = 0;
  let lastTime: number | null = null;
  const flush = () => {
    if (cur.length) {
      const temps = cur.map((h) => h.tempC);
      out.push({
        start: cur[0]!.time,
        end: new Date(Date.parse(cur.at(-1)!.time) + HOUR).toISOString(),
        wetHours: cur.length,
        meanTempC: temps.reduce((a, b) => a + b, 0) / temps.length,
        hours: cur,
        forecast: cur.some((h) => h.isForecast),
      });
    }
    cur = [];
    dryRun = 0;
  };
  for (const h of hours) {
    const t = Date.parse(h.time);
    // A data hole is treated as dry hours.
    if (lastTime != null && t - lastTime > HOUR) dryRun += Math.round((t - lastTime) / HOUR) - 1;
    lastTime = t;
    if (dryRun >= gap) flush();
    if (isWet(h, o)) {
      cur.push(h);
      dryRun = 0;
    } else if (cur.length) dryRun++;
  }
  flush();
  return out;
}

const inSeason = (iso: string, s?: [string, string]) => !!s && iso.slice(0, 10) >= s[0] && iso.slice(0, 10) <= s[1];

/** Primary (ascospore) phase: PAT between onset (0.016) and exhaustion (0.99) when green tip known. */
function phase(iso: string, hours: WeatherHour[], o: ScabOptions): 'none' | 'primary' | 'secondary' {
  if (o.greenTip) {
    if (iso < o.greenTip) return 'none';
    const pat = ascosporeMaturity(cumulativeDegreeDaysBase0(hours.filter((h) => h.time <= iso), o.greenTip));
    if (pat < 0.016) return 'none';
    return pat < 0.99 ? 'primary' : 'secondary';
  }
  return inSeason(iso, o.primarySeason) ? 'primary' : 'secondary';
}

export function evaluateScab(hours: WeatherHour[], o: ScabOptions = {}): ScabInfection[] {
  const factor = o.wetHoursFactor ?? 1;
  const nightRule = o.nightDischargeRule ?? true;
  const out: ScabInfection[] = [];
  for (const p of wetPeriods(hours, o)) {
    const ph = phase(p.start, hours, o);
    if (ph === 'none') continue;
    const primary = ph === 'primary';
    let counted = p.hours;
    if (primary && nightRule && isNightIst(p.start)) {
      // Discount wet hours before the first daylight hour (06:00 IST).
      const idx = counted.findIndex((h) => !isNightIst(h.time) && istHour(h.time) >= 6);
      counted = idx === -1 ? [] : counted.slice(idx);
    }
    if (!counted.length) continue;
    const mean = counted.reduce((s, h) => s + h.tempC, 0) / counted.length;
    const base = (primary ? ascosporeHours(mean) : conidialHours(mean)) * factor;
    if (!Number.isFinite(base) || counted.length < base) continue;
    const n = counted.length;
    const severity: ScabSeverity = primary
      ? n >= heavyHours(mean) * factor ? 'severe' : n >= moderateHours(mean) * factor ? 'moderate' : 'light'
      : n >= base * SEVERITY_FACTORS.severe ? 'severe' : n >= base * SEVERITY_FACTORS.moderate ? 'moderate' : 'light';
    const startMs = Date.parse(counted[0]!.time);
    const lag = o.incubationLagDays ?? 0;
    out.push({
      start: counted[0]!.time,
      end: p.end,
      wetHours: counted.length,
      meanTempC: Math.round(mean * 10) / 10,
      type: primary ? 'primary' : 'secondary',
      severity,
      requiredHours: Math.ceil(base),
      symptomsExpected: new Date(startMs + (incubationDays(mean) + lag) * 24 * HOUR).toISOString().slice(0, 10),
      curativeDeadlines: [
        { class: 'Dodine (FRAC U12)', until: new Date(startMs + 36 * HOUR).toISOString() },
        { class: 'Anilinopyrimidine (FRAC 9)', until: new Date(startMs + 48 * HOUR).toISOString() },
        { class: 'DMI (FRAC 3)', until: new Date(startMs + 72 * HOUR).toISOString() },
      ],
      advisory: !o.calibrated,
      forecast: p.forecast,
    });
  }
  return out;
}

/** Current running wetness: how far into a potential infection the orchard is right now. */
export function wetnessProgress(hours: WeatherHour[], nowIso: string, o: ScabOptions = {}) {
  const ps = wetPeriods(hours.filter((h) => h.time <= nowIso), o);
  const last = ps.at(-1);
  if (!last || Date.parse(nowIso) - Date.parse(last.end) > (o.maxDryGapHours ?? 8) * HOUR) return null;
  const ph = phase(last.start, hours, o);
  if (ph === 'none') return null;
  const primary = ph === 'primary';
  const need = (primary ? ascosporeHours(last.meanTempC) : conidialHours(last.meanTempC)) * (o.wetHoursFactor ?? 1);
  return { ...last, hours: undefined, requiredHours: Math.ceil(need), percent: Math.min(100, Math.round((last.wetHours / need) * 100)) };
}
