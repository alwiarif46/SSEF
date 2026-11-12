/**
 * Pure derivations from synced rows → inputs for @orchard/domain engines (planner, risk, alerts).
 */
import type { PastSpray, WeatherHour, PlanContext } from '@orchard/domain';
import type { Chemical } from '@orchard/reference';
import type { BlockRow, ScoutRow, SprayEventRow, WeatherDailyRow } from './types';

export function sprayHistory(events: SprayEventRow[]): PastSpray[] {
  // A correction supersedes the record it corrects.
  const corrected = new Set(events.map((e) => e.corrects_id).filter(Boolean));
  return events
    .filter((e) => !corrected.has(e.id))
    .map((e) => ({ date: e.sprayed_on, chemicalIds: (e.products ?? []).map((p) => p.chemicalId) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function weatherHours(days: WeatherDailyRow[]): WeatherHour[] {
  const out: WeatherHour[] = [];
  for (const d of days) for (const h of (d.hourly ?? []) as WeatherHour[]) if (h && typeof h.time === 'string') out.push({ ...h, isForecast: h.isForecast ?? d.is_forecast ?? false });
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export function rainNextHours(hours: WeatherHour[], nowIso: string, h = 48): number {
  const now = Date.parse(nowIso);
  return hours.filter((x) => Date.parse(x.time) > now && Date.parse(x.time) <= now + h * 3_600_000).reduce((s, x) => s + (x.precipMm || 0), 0);
}

/** Rain from daily rows when hourly isn't cached. */
export function rainNextDays(days: WeatherDailyRow[], todayIso: string, n = 2): number {
  return days.filter((d) => d.day >= todayIso && d.day < addDays(todayIso, n)).reduce((s, d) => s + (d.precip_mm ?? 0), 0);
}

export function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function latestScouting(obs: ScoutRow[], todayIso: string, withinDays = 10): NonNullable<PlanContext['scouting']> {
  const since = addDays(todayIso, -withinDays);
  const recent = obs.filter((o) => o.observed_on >= since).sort((a, b) => b.observed_on.localeCompare(a.observed_on));
  const latest = (ids: string[]) => recent.find((o) => ids.includes(o.pest_id) && o.value != null)?.value;
  const mites = latest(['european-red-mite', 'two-spotted-mite']);
  const thrips = latest(['blossom-thrips']);
  return {
    ...(mites != null ? { mitesPerLeaf: mites } : {}),
    ...(thrips != null ? { thripsPerFlower: thrips } : {}),
    observedTargets: [...new Set(recent.filter((o) => (o.value ?? o.severity ?? 1) > 0).map((o) => o.pest_id))],
  };
}

export function daysSinceCategory(events: SprayEventRow[], chemicals: Chemical[], category: Chemical['category'], todayIso: string): number | undefined {
  const ids = new Set(chemicals.filter((c) => c.category === category).map((c) => c.id));
  const last = events.filter((e) => (e.products ?? []).some((p) => ids.has(p.chemicalId))).map((e) => e.sprayed_on).sort().at(-1);
  return last ? Math.round((Date.parse(todayIso) - Date.parse(last)) / 86_400_000) : undefined;
}

export function doneRecommendationIds(events: SprayEventRow[], season: number): string[] {
  return [...new Set(events.filter((e) => e.sprayed_on.startsWith(String(season))).flatMap((e) => (e.products ?? []).map((p) => p.recommendationId).filter((x): x is string => !!x)))];
}

export function blockSystem(b: BlockRow): 'traditional' | 'hdp' {
  return b.system_type === 'hdp' ? 'hdp' : 'traditional';
}

export function buildPlanContext(args: {
  block: BlockRow; events: SprayEventRow[]; scouting: ScoutRow[]; weather: WeatherDailyRow[]; chemicals: Chemical[]; date: string; tankLitres: number; nowIso?: string;
}): PlanContext {
  const { block, events, scouting, weather, chemicals, date, tankLitres } = args;
  const hours = weatherHours(weather);
  const rain = hours.length ? rainNextHours(hours, args.nowIso ?? new Date().toISOString()) : weather.length ? rainNextDays(weather, date) : undefined;
  const dsf = daysSinceCategory(events, chemicals, 'fungicide', date);
  return {
    date,
    system: blockSystem(block),
    scabResistant: !!block.scab_resistant,
    ...(block.expected_harvest_date ? { plannedHarvestDate: block.expected_harvest_date } : {}),
    history: sprayHistory(events),
    tankLitres,
    scouting: latestScouting(scouting, date),
    ...(rain != null ? { rainForecastMm48h: rain } : {}),
    ...(dsf != null ? { daysSinceFungicide: dsf } : {}),
    doneRecommendationIds: doneRecommendationIds(events, +date.slice(0, 4)),
  };
}

/** Inventory deduction: quantity used per chemical for a set of product lines. */
export function usageByChemical(lines: { chemicalId: string; quantity: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) out[l.chemicalId] = (out[l.chemicalId] ?? 0) + l.quantity;
  return out;
}

export function expiryStatus(expiry: string | undefined, todayIso: string): 'expired' | 'soon' | 'ok' | 'unknown' {
  if (!expiry) return 'unknown';
  const d = Math.round((Date.parse(expiry) - Date.parse(todayIso)) / 86_400_000);
  return d < 0 ? 'expired' : d <= 60 ? 'soon' : 'ok';
}
