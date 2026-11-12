import { currentStage, nextStage, type PlanContext, type WeatherHour, type PastSpray } from '@orchard/domain';
import type { ReferenceBundle } from '@orchard/reference';
import type { Row, Tables } from './data';

export const live = (rows: Row[] | undefined) => (rows ?? []).filter((r) => !r.deleted_at);

/** Hourly weather for an orchard reconstructed from synced weather_daily rows. */
export function orchardHours(tables: Tables, orchardId: string): WeatherHour[] {
  const days = live(tables.weather_daily).filter((d) => d.orchard_id === orchardId).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const out: WeatherHour[] = [];
  for (const d of days) for (const h of (d.hourly as WeatherHour[] | null) ?? []) if (h && typeof h === 'object' && 'time' in h) out.push(h);
  return out;
}

export function orchardDaily(tables: Tables, orchardId: string) {
  return live(tables.weather_daily).filter((d) => d.orchard_id === orchardId).sort((a, b) => String(a.day).localeCompare(String(b.day)));
}

export function stageFor(ref: ReferenceBundle, date: string, orchard?: Row, block?: Row) {
  return currentStage(ref.stages, date, {
    ...(orchard?.elevation_m != null ? { elevationM: Number(orchard.elevation_m) } : {}),
    ...(block?.observed_stage_id ? { observedStageId: String(block.observed_stage_id) } : {}),
  });
}

export const nextStageFor = (ref: ReferenceBundle, date: string, orchard?: Row) => nextStage(ref.stages, date, orchard?.elevation_m != null ? Number(orchard.elevation_m) : undefined);

export function sprayHistory(tables: Tables, blockId: string): PastSpray[] {
  return live(tables.spray_events)
    .filter((s) => s.block_id === blockId)
    .map((s) => ({ date: String(s.sprayed_on), chemicalIds: ((s.products as { chemicalId: string }[]) ?? []).map((p) => p.chemicalId) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Plan context for planStage from local data (same rules the server uses). */
export function planContext(tables: Tables, ref: ReferenceBundle, block: Row, date: string, tankLitres: number): PlanContext {
  const history = sprayHistory(tables, block.id);
  const since = new Date(Date.parse(date) - 10 * 86_400_000).toISOString().slice(0, 10);
  const scout = live(tables.scouting_observations).filter((s) => s.block_id === block.id && String(s.observed_on) >= since).sort((a, b) => String(b.observed_on).localeCompare(String(a.observed_on)));
  const mites = scout.find((s) => /mite/.test(String(s.pest_id)))?.value;
  const thrips = scout.find((s) => s.pest_id === 'blossom-thrips')?.value;
  const hours = orchardHours(tables, String(block.orchard_id));
  const now = Date.now();
  const future = hours.filter((h) => Date.parse(h.time) > now && Date.parse(h.time) <= now + 48 * 3_600_000);
  const fung = new Set(ref.chemicals.filter((c) => c.category === 'fungicide').map((c) => c.id));
  const lastF = [...history].reverse().find((h) => h.chemicalIds.some((id) => fung.has(id)));
  return {
    date,
    system: block.system_type === 'hdp' ? 'hdp' : 'traditional',
    scabResistant: !!block.scab_resistant,
    tankLitres,
    history,
    ...(block.expected_harvest_date ? { plannedHarvestDate: String(block.expected_harvest_date) } : {}),
    scouting: {
      ...(mites != null ? { mitesPerLeaf: Number(mites) } : {}),
      ...(thrips != null ? { thripsPerFlower: Number(thrips) } : {}),
      observedTargets: scout.map((s) => String(s.pest_id)),
    },
    ...(future.length ? { rainForecastMm48h: future.reduce((s, h) => s + h.precipMm, 0) } : {}),
    ...(lastF ? { daysSinceFungicide: Math.round((Date.parse(date) - Date.parse(lastF.date)) / 86_400_000) } : {}),
  };
}

export const chemName = (ref: ReferenceBundle, id: string) => ref.chemicals.find((c) => c.id === id)?.product ?? id;
export const pestName = (ref: ReferenceBundle, id: string) => ref.pests.find((p) => p.id === id)?.name ?? id;
export const varietyName = (ref: ReferenceBundle, id: string) => ref.varieties.find((v) => v.id === id)?.name ?? id;
export const stageName = (ref: ReferenceBundle, id?: string | null) => (id ? ref.stages.find((s) => s.id === id)?.name ?? id : '—');
export const SYSTEM_LABEL: Record<string, string> = { traditional: 'Traditional', hdp: 'High density (HDP)', medium_density: 'Medium density' };
