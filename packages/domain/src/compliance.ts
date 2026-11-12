import type { Chemical, ReferenceBundle } from '@orchard/reference';
import { daysBetween } from './dates.js';

export type Severity = 'block' | 'warn' | 'info';

export interface Violation {
  code:
    | 'PHI_DEFACTO'
    | 'PHI_LABEL'
    | 'PHI_WINDOW_WARN'
    | 'REPEAT_MOLECULE'
    | 'REPEAT_FRAC_GROUP'
    | 'SEASON_GROUP_CAP'
    | 'BANNED'
    | 'NOT_REGISTERED'
    | 'NO_LABEL_CLAIM'
    | 'RESTRICTED'
    | 'WATCH_LIST'
    | 'BLOOM_INSECTICIDE'
    | 'UNKNOWN_CHEMICAL'
    | 'MIX_FUNGICIDE_INSECTICIDE'
    | 'INSECTICIDE_FUNGICIDE_GAP'
    | 'NO_HARVEST_DATE';
  severity: Severity;
  chemicalId?: string;
  message: string;
}

export interface PastSpray {
  date: string; // ISO date
  chemicalIds: string[];
}

export interface ProposedSpray {
  date: string;
  chemicalIds: string[];
  /** Planned/expected harvest start for the block (earliest variety). */
  plannedHarvestDate?: string;
  stageId?: string;
}

/** FRAC/IRAC groups at high resistance risk with a per-season cap (resistance management). */
export const SEASON_GROUP_CAPS: Record<string, number> = {
  'FRAC:3': 4, // DMI – documented difenoconazole/flusilazole resistance in Kashmir
  'FRAC:11': 3, // QoI
  'FRAC:7': 3, // SDHI
  'FRAC:9': 3, // anilinopyrimidines
  'FRAC:1': 2, // MBC – carbendazim, thiophanate-methyl
  'IRAC:4A': 2,
  'IRAC:28': 2,
};

const groupKeys = (c: Chemical) => [
  ...(c.fracGroup ? c.fracGroup.split('+').map((g) => `FRAC:${g.trim()}`) : []),
  ...(c.iracGroup ? c.iracGroup.split('+').map((g) => `IRAC:${g.trim()}`) : []),
];

/** Multi-site/low-risk groups never trigger the consecutive-group warning. */
const LOW_RISK_GROUP = /^FRAC:(M\d+|NC|BM\d+)$|^IRAC:(UN|NC)$/;

export function chemicalIndex(bundle: Pick<ReferenceBundle, 'chemicals'>): Map<string, Chemical> {
  return new Map(bundle.chemicals.map((c) => [c.id, c]));
}

/** Regulatory gate: CIBRC registration + apple label claim + status. */
export function regulatoryViolations(c: Chemical): Violation[] {
  const v: Violation[] = [];
  if (c.status === 'banned')
    v.push({ code: 'BANNED', severity: 'block', chemicalId: c.id, message: `${c.product} is banned${c.statusReference ? ` (${c.statusReference})` : ''}.` });
  if (!c.cibrcRegistered)
    v.push({ code: 'NOT_REGISTERED', severity: 'block', chemicalId: c.id, message: `${c.product} is not CIBRC-registered.` });
  else if (!c.appleLabelClaim && c.category !== 'nutrient' && c.category !== 'cultural')
    v.push({ code: 'NO_LABEL_CLAIM', severity: 'block', chemicalId: c.id, message: `${c.product} has no CIBRC label claim on apple.` });
  if (c.status === 'restricted')
    v.push({ code: 'RESTRICTED', severity: 'warn', chemicalId: c.id, message: `${c.product} is restricted: ${c.statusNote ?? 'check conditions of use'}.` });
  if (c.status === 'watch')
    v.push({ code: 'WATCH_LIST', severity: 'info', chemicalId: c.id, message: `${c.product} is on a regulatory watch list: ${c.statusNote ?? ''}`.trim() });
  return v;
}

/**
 * Hard validation of a proposed spray against: regulatory status, de-facto PHI (no sprays
 * within `defactoPhiDays` of harvest), label PHI, molecule rotation (never the same molecule
 * in two consecutive sprays), FRAC/IRAC consecutive-group warning and per-season group caps.
 */
export function validateSpray(
  proposed: ProposedSpray,
  history: PastSpray[],
  bundle: Pick<ReferenceBundle, 'chemicals' | 'defactoPhiDays' | 'stages'>,
  opts: { seasonStart?: string } = {},
): Violation[] {
  const idx = chemicalIndex(bundle);
  const out: Violation[] = [];
  const chems: Chemical[] = [];
  for (const id of proposed.chemicalIds) {
    const c = idx.get(id);
    if (!c) {
      out.push({ code: 'UNKNOWN_CHEMICAL', severity: 'block', chemicalId: id, message: `Unknown product "${id}" — only catalogued products may be recorded.` });
      continue;
    }
    chems.push(c);
    out.push(...regulatoryViolations(c));
  }

  // Pollinator protection.
  const stage = proposed.stageId ? bundle.stages.find((s) => s.id === proposed.stageId) : undefined;
  if (stage?.pollinatorSensitive)
    for (const c of chems)
      if (c.category === 'insecticide' || c.category === 'miticide')
        out.push({ code: 'BLOOM_INSECTICIDE', severity: 'block', chemicalId: c.id, message: `No insecticide/miticide at ${stage.name} — protect pollinators.` });

  // PHI.
  if (proposed.plannedHarvestDate) {
    const daysToHarvest = daysBetween(proposed.date, proposed.plannedHarvestDate);
    const pesticidal = chems.filter((c) => c.category !== 'nutrient' && c.category !== 'cultural');
    if (pesticidal.length && daysToHarvest < 21)
      out.push({ code: 'PHI_DEFACTO', severity: 'block', message: `Spray is ${daysToHarvest} days before planned harvest; all sprays stop 3–4 weeks before harvest.` });
    else if (pesticidal.length && daysToHarvest < bundle.defactoPhiDays)
      out.push({ code: 'PHI_WINDOW_WARN', severity: 'warn', message: `Spray is ${daysToHarvest} days before harvest — inside the 3–4 week stop window (${bundle.defactoPhiDays} d).` });
    for (const c of pesticidal)
      if (c.phiDays != null && daysToHarvest < c.phiDays)
        out.push({ code: 'PHI_LABEL', severity: 'block', chemicalId: c.id, message: `${c.product} label PHI is ${c.phiDays} days; harvest is in ${daysToHarvest}.` });
  } else if (chems.some((c) => c.category !== 'nutrient')) {
    out.push({ code: 'NO_HARVEST_DATE', severity: 'info', message: 'Set an expected harvest date on the block to enable PHI checks.' });
  }

  // SKUAST-K general instruction 1: do not mix fungicides and insecticides.
  const isFung = (c: Chemical) => c.category === 'fungicide' || c.category === 'bactericide';
  const isInsect = (c: Chemical) => c.category === 'insecticide' || c.category === 'miticide';
  if (chems.some(isFung) && chems.some(isInsect))
    out.push({ code: 'MIX_FUNGICIDE_INSECTICIDE', severity: 'warn', message: 'SKUAST-K: do not mix fungicides and insecticides in one tank — spray them 3–4 days apart.' });

  const sorted = [...history].filter((h) => h.date < proposed.date).sort((a, b) => a.date.localeCompare(b.date));
  const resolve = (h: PastSpray) => h.chemicalIds.map((id) => idx.get(id)).filter((c): c is Chemical => !!c);

  // Instruction 2: 3–4 day gap between insecticide and fungicide sprays.
  for (const h of sorted) {
    const gap = daysBetween(h.date, proposed.date);
    if (gap > 3) continue;
    const prev = resolve(h);
    if ((chems.some(isFung) && prev.some(isInsect)) || (chems.some(isInsect) && prev.some(isFung))) {
      out.push({ code: 'INSECTICIDE_FUNGICIDE_GAP', severity: 'warn', message: `Only ${gap} day(s) since the ${h.date} spray — keep 3–4 days between insecticide and fungicide sprays.` });
      break;
    }
  }

  // Rotation: never repeat a molecule in consecutive sprays of the same class
  // (fungicide sprays compared with the previous fungicide spray; insecticide/miticide likewise).
  for (const c of chems) {
    if (c.category === 'nutrient' || c.category === 'oil' || c.category === 'cultural' || c.category === 'growth_regulator') continue;
    const sameClass = (x: Chemical) => (isFung(c) ? isFung(x) : isInsect(x));
    const prevSpray = [...sorted].reverse().find((h) => resolve(h).some(sameClass));
    if (!prevSpray) continue;
    const prevChems = resolve(prevSpray).filter(sameClass);
    const prevMolecules = new Set(prevChems.flatMap((x) => x.moleculeKeys));
    const repeated = c.moleculeKeys.filter((m) => prevMolecules.has(m));
    if (repeated.length) {
      out.push({ code: 'REPEAT_MOLECULE', severity: 'block', chemicalId: c.id, message: `${repeated.join(', ')} was in the previous ${isFung(c) ? 'fungicide' : 'insecticide/miticide'} spray (${prevSpray.date}); never repeat a molecule in consecutive sprays.` });
      continue;
    }
    const prevGroups = new Set(prevChems.flatMap(groupKeys));
    const g = groupKeys(c).filter((k) => prevGroups.has(k) && !LOW_RISK_GROUP.test(k));
    if (g.length)
      out.push({ code: 'REPEAT_FRAC_GROUP', severity: 'warn', chemicalId: c.id, message: `${c.product} shares mode-of-action group ${g.join(', ')} with the previous spray — rotate groups.` });
  }

  // Season group caps.
  const seasonStart = opts.seasonStart ?? `${proposed.date.slice(0, 4)}-01-01`;
  const seasonCounts = new Map<string, number>();
  for (const h of sorted.filter((h) => h.date >= seasonStart))
    for (const id of h.chemicalIds) {
      const c = idx.get(id);
      if (c) for (const k of new Set(groupKeys(c))) seasonCounts.set(k, (seasonCounts.get(k) ?? 0) + 1);
    }
  for (const c of chems)
    for (const k of new Set(groupKeys(c))) {
      const cap = SEASON_GROUP_CAPS[k];
      if (cap != null && (seasonCounts.get(k) ?? 0) >= cap)
        out.push({ code: 'SEASON_GROUP_CAP', severity: 'warn', chemicalId: c.id, message: `${k.replace(':', ' group ')} already used ${seasonCounts.get(k)}× this season (cap ${cap}).` });
    }

  return out;
}

export const isBlocked = (v: Violation[]) => v.some((x) => x.severity === 'block');

/**
 * Regulatory impact: when a catalogued molecule becomes banned/restricted/unregistered, every
 * schedule entry that lists it is flagged, with the still-eligible alternatives from the same entry.
 */
export function regulatoryImpact(bundle: Pick<ReferenceBundle, 'chemicals' | 'recommendations' | 'stages'>) {
  const idx = chemicalIndex(bundle);
  const out: { recommendationId: string; stage: string; affected: { chemicalId: string; product: string; status: string; reason: string }[]; alternatives: string[] }[] = [];
  for (const r of bundle.recommendations) {
    const affected = r.options
      .map((o) => idx.get(o.chemicalId))
      .filter((c): c is Chemical => !!c && regulatoryViolations(c).some((v) => v.severity !== 'info'))
      .map((c) => ({ chemicalId: c.id, product: c.product, status: c.status, reason: regulatoryViolations(c).map((v) => v.message).join(' ') }));
    if (!affected.length) continue;
    const alternatives = r.options.map((o) => o.chemicalId).filter((id) => !affected.some((a) => a.chemicalId === id));
    out.push({ recommendationId: r.id, stage: bundle.stages.find((s) => s.id === r.stageId)?.name ?? r.stageId, affected, alternatives });
  }
  return out;
}
