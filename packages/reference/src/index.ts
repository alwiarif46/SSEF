export * from './types.js';
export * from './chemicals.js';
export * from './schedule2026.js';
export * from './library.js';
export * from './units.js';

import type { ReferenceBundle } from './types.js';
import { chemicals } from './chemicals.js';
import { VERSION_2026, STAGES_2026, RECOMMENDATIONS_2026 } from './schedule2026.js';
import { PESTS, VARIETIES, ROOTSTOCKS, SAFETY, CRITICAL_TEMPS } from './library.js';

/** The bundled default reference set. The server can publish newer seasons without an app release. */
export const BUNDLE_2026: ReferenceBundle = {
  version: VERSION_2026,
  stages: STAGES_2026,
  recommendations: RECOMMENDATIONS_2026,
  chemicals,
  pests: PESTS,
  varieties: VARIETIES,
  rootstocks: ROOTSTOCKS,
  safety: SAFETY,
  criticalTemps: CRITICAL_TEMPS,
  defactoPhiDays: 28,
};

/** Integrity check: every referenced id resolves. Returns a list of problems (empty = OK). */
export function validateBundle(b: ReferenceBundle): string[] {
  const errs: string[] = [];
  const chem = new Set(b.chemicals.map((c) => c.id));
  const stages = new Set(b.stages.map((s) => s.id));
  const pests = new Set(b.pests.map((p) => p.id));
  const ids = new Set<string>();
  for (const r of b.recommendations) {
    if (ids.has(r.id)) errs.push(`duplicate recommendation id ${r.id}`);
    ids.add(r.id);
    if (!stages.has(r.stageId)) errs.push(`${r.id}: unknown stage ${r.stageId}`);
    for (const t of r.target) if (!pests.has(t)) errs.push(`${r.id}: unknown target ${t}`);
    if (!r.options.length) errs.push(`${r.id}: no product options`);
    for (const o of r.options) {
      if (!chem.has(o.chemicalId)) errs.push(`${r.id}: unknown chemical ${o.chemicalId}`);
      if (!(o.dosePer100L > 0)) errs.push(`${r.id}: non-positive dose for ${o.chemicalId}`);
      const c = b.chemicals.find((x) => x.id === o.chemicalId);
      if (c && c.status === 'banned') errs.push(`${r.id}: recommends banned ${c.id}`);
    }
  }
  const orders = b.stages.map((s) => s.order);
  if (new Set(orders).size !== orders.length) errs.push('duplicate stage order');
  for (const c of b.chemicals) if (c.moleculeKeys.length === 0) errs.push(`${c.id}: no molecule keys`);
  return errs;
}
