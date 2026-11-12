import type { ReferenceBundle, SprayStage, StageRecommendation, Chemical } from '@orchard/reference';
import { MITE_THRESHOLDS } from '@orchard/reference';
import { addDays, daysBetween } from './dates.js';
import { scaleDose, type ScaledDose } from './tank.js';
import { validateSpray, isBlocked, type PastSpray, type Violation } from './compliance.js';

/** Reference elevation for the inferred calendar windows. */
export const REFERENCE_ELEVATION_M = 1700;
/** Phenology delay with altitude (≈ 2–4 weeks across 1,500–2,500 m). */
export const DAYS_PER_100M = 3;

export function elevationShiftDays(elevationM?: number): number {
  if (elevationM == null) return 0;
  return Math.round(((elevationM - REFERENCE_ELEVATION_M) / 100) * DAYS_PER_100M);
}

export interface StageWindow {
  stage: SprayStage;
  start: string;
  end: string;
}

/** Concrete dated windows for a season, shifted by orchard elevation. Dormancy wraps the year. */
export function stageWindows(stages: SprayStage[], season: number, elevationM?: number): StageWindow[] {
  const shift = elevationShiftDays(elevationM);
  return [...stages]
    .sort((a, b) => a.order - b.order)
    .map((stage) => {
      const wraps = stage.windowEnd < stage.windowStart;
      const start = addDays(`${season}-${stage.windowStart}`, shift);
      const end = addDays(`${wraps ? season + 1 : season}-${stage.windowEnd}`, shift);
      return { stage, start, end };
    });
}

/**
 * Current stage for a date. An observed phenology record (from scouting) always wins over
 * the calendar estimate.
 */
export function currentStage(
  stages: SprayStage[],
  date: string,
  opts: { elevationM?: number; observedStageId?: string } = {},
): SprayStage | undefined {
  if (opts.observedStageId) {
    const s = stages.find((x) => x.id === opts.observedStageId);
    if (s) return s;
  }
  const year = +date.slice(0, 4);
  // Check this season and the previous one (for Jan–Feb dormancy).
  for (const season of [year, year - 1]) {
    const wins = stageWindows(stages, season, opts.elevationM).filter((w) => date >= w.start && date <= w.end);
    if (wins.length) return wins.sort((a, b) => b.stage.order - a.stage.order)[0]!.stage; // latest overlapping
  }
  return undefined;
}

export interface PlanContext {
  date: string;
  system: 'traditional' | 'hdp';
  scabResistant?: boolean;
  plannedHarvestDate?: string;
  history: PastSpray[];
  tankLitres: number;
  /** Latest scouting counts. */
  scouting?: { mitesPerLeaf?: number; thripsPerFlower?: number; observedTargets?: string[] };
  rainForecastMm48h?: number;
  /** Days since last fungicide spray (for flowering's 10-day-gap rule). */
  daysSinceFungicide?: number;
  /** Stage-recommendation ids already completed this season. */
  doneRecommendationIds?: string[];
}

export type RecStatus = 'due' | 'conditional' | 'not_needed' | 'done' | 'skipped_resistant';

export interface PlannedOption {
  chemical: Chemical;
  dose: ScaledDose;
  violations: Violation[];
  eligible: boolean;
  /** Ranking hint: protectant-first for resistant varieties; low-risk groups first generally. */
  rank: number;
  preferred?: boolean;
}

export interface PlannedRecommendation {
  recommendation: StageRecommendation;
  status: RecStatus;
  reason: string;
  options: PlannedOption[];
  supplementary: boolean;
}

function decideStatus(rec: StageRecommendation, stage: SprayStage, ctx: PlanContext): { status: RecStatus; reason: string } {
  if (ctx.doneRecommendationIds?.includes(rec.id)) return { status: 'done', reason: 'Already applied this season.' };
  if (rec.systemType !== 'both' && rec.systemType !== ctx.system) return { status: 'not_needed', reason: `Applies to ${rec.systemType} blocks only.` };
  if (ctx.scabResistant && rec.skipForScabResistant && rec.category === 'fungicide' && rec.target.every((t) => t === 'apple-scab'))
    return { status: 'skipped_resistant', reason: 'Low-spray programme: scab-only protectant skipped for Rvi6 scab-resistant variety.' };
  if (!rec.needBased) return { status: 'due', reason: 'Scheduled spray for this stage.' };

  const s = ctx.scouting ?? {};
  if (rec.category === 'miticide') {
    const thr = MITE_THRESHOLDS[stage.id] ?? 5;
    if (s.mitesPerLeaf == null) return { status: 'conditional', reason: `Scout mites: spray only above ${thr} per leaf.` };
    return s.mitesPerLeaf > thr
      ? { status: 'due', reason: `${s.mitesPerLeaf} mites/leaf exceeds ${thr}.` }
      : { status: 'not_needed', reason: `${s.mitesPerLeaf} mites/leaf is below the ${thr} threshold.` };
  }
  if (rec.target.includes('blossom-thrips')) {
    if (s.thripsPerFlower == null) return { status: 'conditional', reason: 'Scout thrips: spray only at ≥ 2 per flower.' };
    return s.thripsPerFlower >= 2
      ? { status: 'due', reason: `${s.thripsPerFlower} thrips/flower ≥ 2.` }
      : { status: 'not_needed', reason: 'Thrips below threshold.' };
  }
  if (rec.category === 'fungicide') {
    const rain = ctx.rainForecastMm48h;
    if (stage.pollinatorSensitive) {
      const gapOk = (ctx.daysSinceFungicide ?? 0) >= 10;
      if (!gapOk) return { status: 'not_needed', reason: 'Flowering: spray only after a 10-day fungicide gap with rain forecast.' };
    }
    const targeted = rec.target.filter((t) => t !== 'apple-scab');
    if (targeted.length && s.observedTargets?.some((t) => targeted.includes(t)))
      return { status: 'due', reason: `Observed: ${s.observedTargets.filter((t) => targeted.includes(t)).join(', ')}.` };
    if (rain == null) return { status: 'conditional', reason: 'Spray if rain is forecast.' };
    return rain >= 2
      ? { status: 'due', reason: `${rain.toFixed(0)} mm rain forecast in 48 h — spray before rain.` }
      : { status: 'not_needed', reason: 'No significant rain forecast.' };
  }
  if (s.observedTargets?.some((t) => rec.target.includes(t))) return { status: 'due', reason: 'Target pest observed in scouting.' };
  return { status: 'conditional', reason: rec.notes ?? 'Need-based: scout before spraying.' };
}

/** Build the actionable plan for one stage of one block. */
export function planStage(bundle: ReferenceBundle, stageId: string, ctx: PlanContext): PlannedRecommendation[] {
  const stage = bundle.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`unknown stage ${stageId}`);
  const chemById = new Map(bundle.chemicals.map((c) => [c.id, c]));
  return bundle.recommendations
    .filter((r) => r.stageId === stageId)
    .map((rec) => {
      const { status, reason } = decideStatus(rec, stage, ctx);
      const options: PlannedOption[] = rec.options
        .map((opt) => {
          const chemical = chemById.get(opt.chemicalId)!;
          const violations = validateSpray(
            { date: ctx.date, chemicalIds: [opt.chemicalId], stageId, ...(ctx.plannedHarvestDate ? { plannedHarvestDate: ctx.plannedHarvestDate } : {}) },
            ctx.history,
            bundle,
          ).filter((v) => v.code !== 'NO_HARVEST_DATE');
          let rank = chemical.resistanceRisk === 'low' ? 0 : chemical.resistanceRisk === 'medium' ? 1 : 2;
          if (ctx.scabResistant && chemical.fracGroup?.includes('3')) rank += 2; // reduce DMI reliance
          rank += violations.filter((v) => v.severity === 'warn').length;
          return { chemical, dose: scaleDose(opt, ctx.tankLitres), violations, eligible: !isBlocked(violations), rank };
        })
        .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.rank - b.rank);
      const first = options.find((o) => o.eligible);
      if (first) first.preferred = true;
      return { recommendation: rec, status, reason, options, supplementary: rec.provenance === 'SUPPLEMENTARY' };
    });
}

/** Days until the next stage window opens (for the dashboard countdown). */
export function nextStage(stages: SprayStage[], date: string, elevationM?: number) {
  const year = +date.slice(0, 4);
  const wins = [...stageWindows(stages, year, elevationM), ...stageWindows(stages, year + 1, elevationM)].filter((w) => w.start > date);
  const w = wins.sort((a, b) => a.start.localeCompare(b.start))[0];
  return w ? { stage: w.stage, start: w.start, inDays: daysBetween(date, w.start) } : undefined;
}

/** Planned harvest date from full-bloom date and variety DAFB. */
export function harvestFromBloom(fullBloom: string, dafbMin?: number): string | undefined {
  return dafbMin == null ? undefined : addDays(fullBloom, dafbMin);
}
