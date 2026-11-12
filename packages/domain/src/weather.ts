import { istDay, istHour } from './dates.js';

/** One hour of weather at an orchard. All instants UTC ISO. */
export interface WeatherHour {
  time: string;
  tempC: number;
  rh: number; // %
  precipMm: number;
  dewPointC?: number;
  windKph?: number;
  /** WMO weather code when the provider supplies one (95–99 thunderstorm; 96/99 with hail). */
  weatherCode?: number;
  isForecast?: boolean;
}

export interface WetnessOptions {
  /** RH threshold for the leaf-wetness proxy (best-validated simple model: ≥ 90%). */
  rhThreshold?: number;
  /** Alternative proxy: dew-point depression below this (°C). Off when undefined. */
  dewPointDepressionC?: number;
  /** Rain this heavy in an hour counts as wet regardless of RH. */
  rainMm?: number;
}

export function isWet(h: WeatherHour, o: WetnessOptions = {}): boolean {
  const rhT = o.rhThreshold ?? 90;
  if (h.precipMm >= (o.rainMm ?? 0.2)) return true;
  if (h.rh >= rhT) return true;
  if (o.dewPointDepressionC != null && h.dewPointC != null && h.tempC - h.dewPointC < o.dewPointDepressionC) return true;
  return false;
}

/** Magnus formula dew point (°C). */
export function dewPoint(tempC: number, rh: number): number {
  const a = 17.62, b = 243.12;
  const g = Math.log(Math.max(rh, 1) / 100) + (a * tempC) / (b + tempC);
  return (b * g) / (a - g);
}

export interface DailySummary {
  date: string; // IST calendar day
  minC: number;
  maxC: number;
  meanC: number;
  precipMm: number;
  meanRh: number;
  hours: number;
}

/** Aggregate hourly data into IST calendar days. Days with < 18 hours are flagged by `hours`. */
export function dailySummaries(hours: WeatherHour[]): DailySummary[] {
  const by = new Map<string, WeatherHour[]>();
  for (const h of hours) {
    const d = istDay(h.time);
    (by.get(d) ?? by.set(d, []).get(d)!).push(h);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hs]) => ({
      date,
      minC: Math.min(...hs.map((h) => h.tempC)),
      maxC: Math.max(...hs.map((h) => h.tempC)),
      meanC: hs.reduce((s, h) => s + h.tempC, 0) / hs.length,
      precipMm: hs.reduce((s, h) => s + h.precipMm, 0),
      meanRh: hs.reduce((s, h) => s + h.rh, 0) / hs.length,
      hours: hs.length,
    }));
}

export const isNightIst = (time: string) => {
  const h = istHour(time);
  return h >= 20 || h < 6;
};

/** Sort, de-duplicate by hour (forecast replaced by observation), and drop invalid rows. */
export function normaliseHours(hours: WeatherHour[]): WeatherHour[] {
  const m = new Map<string, WeatherHour>();
  for (const h of hours) {
    if (!Number.isFinite(h.tempC) || !Number.isFinite(h.rh)) continue;
    const key = new Date(Date.parse(h.time)).toISOString().slice(0, 13);
    const prev = m.get(key);
    if (!prev || (prev.isForecast && !h.isForecast)) m.set(key, { ...h, time: `${key}:00:00.000Z`, rh: Math.min(100, Math.max(0, h.rh)), precipMm: Math.max(0, h.precipMm || 0) });
  }
  return [...m.values()].sort((a, b) => a.time.localeCompare(b.time));
}
