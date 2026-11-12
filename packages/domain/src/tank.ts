import type { ProductOption } from '@orchard/reference';
import { SPRAY_VOLUME_L_PER_TREE } from '@orchard/reference';
import { round } from './units.js';

export interface ScaledDose {
  chemicalId: string;
  /** Official per-100-L figure, always preserved and shown next to the scaled one. */
  officialPer100L: number;
  unit: ProductOption['doseUnit'];
  tankLitres: number;
  quantity: number;
  /** Friendly display, e.g. "300 g" or "1.2 kg". */
  display: string;
}

/** Scales an official per-100-L dose to a tank. Never alters the official figure. */
export function scaleDose(option: ProductOption, tankLitres: number): ScaledDose {
  if (!Number.isFinite(tankLitres) || tankLitres <= 0) throw new RangeError('tank volume must be > 0 L');
  if (tankLitres > 20_000) throw new RangeError('tank volume implausible (> 20,000 L)');
  const quantity = (option.dosePer100L * tankLitres) / 100;
  return {
    chemicalId: option.chemicalId,
    officialPer100L: option.dosePer100L,
    unit: option.doseUnit,
    tankLitres,
    quantity: round(quantity, 3),
    display: formatQuantity(quantity, option.doseUnit),
  };
}

export function formatQuantity(q: number, unit: ProductOption['doseUnit']): string {
  if (unit === 'g' && q >= 1000) return `${round(q / 1000, 2)} kg`;
  if (unit === 'ml' && q >= 1000) return `${round(q / 1000, 2)} L`;
  if (unit === 'kg' && q < 1) return `${round(q * 1000, 0)} g`;
  if (unit === 'l' && q < 1) return `${round(q * 1000, 0)} ml`;
  const u = unit === 'l' ? 'L' : unit;
  return `${round(q, unit === 'g' || unit === 'ml' ? 1 : 2)} ${u}`;
}

/** Spray-liquid requirement from the Kashmir per-tree volume table (traditional / HDP / medium density). */
export function sprayVolumeLitres(params: {
  trees: number;
  system: 'traditional' | 'hdp' | 'medium_density';
  treeAgeYears?: number;
  litresPerTreeOverride?: number;
}): number {
  const { trees, system, treeAgeYears, litresPerTreeOverride } = params;
  if (trees < 0) throw new RangeError('trees must be >= 0');
  const t = SPRAY_VOLUME_L_PER_TREE[system];
  const perTree = litresPerTreeOverride ?? t.find((r) => (treeAgeYears ?? 99) <= r.maxAge)!.l;
  return round(trees * perTree, 1);
}

/** Number of tank fills (ceil) and per-fill dose for a given total spray volume. */
export function tankPlan(totalLitres: number, tankLitres: number, options: ProductOption[]) {
  const fills = Math.max(1, Math.ceil(totalLitres / tankLitres));
  return {
    fills,
    perFill: options.map((o) => scaleDose(o, tankLitres)),
    total: options.map((o) => scaleDose(o, Math.max(totalLitres, 0.001))),
  };
}
