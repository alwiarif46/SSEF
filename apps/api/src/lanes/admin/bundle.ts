import { z } from 'zod';
import { validateBundle, type Chemical, type ReferenceBundle, type SprayStage, type StageRecommendation } from '@orchard/reference';
import { regulatoryImpact } from '@orchard/domain';
import { bundleEtag } from '../../migrate.js';

export { bundleEtag };

/**
 * Reference bundle checks shared by the admin API and scripts/publish-reference.mjs.
 *
 * Two layers:
 *  1. Structural (zod): the JSON has the shape validateBundle and the clients rely on. Unknown
 *     extra fields are kept (passthrough) so newer bundle fields survive a round-trip.
 *  2. Integrity (validateBundle from @orchard/reference): ids resolve, no banned product is
 *     recommended, doses are positive, stage orders are unique.
 */

const id = z.string().min(1).max(120);
const provenance = z.enum(['SKUAST-K', 'JK-HORTICULTURE', 'CIBRC', 'SUPPLEMENTARY']);
const category = z.enum(['fungicide', 'insecticide', 'miticide', 'oil', 'nutrient', 'bactericide', 'growth_regulator', 'cultural']);
const mmdd = z.string().regex(/^\d{2}-\d{2}$/, 'expected MM-DD');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'expected ISO date');

const version = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/, 'version id: lowercase letters, digits, . _ - (3–64 chars)'),
  season: z.number().int().min(2020).max(2100),
  source: z.string().min(1),
  sourceUrl: z.string().optional(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate,
  status: z.enum(['draft', 'under_review', 'published', 'superseded']),
  verifiedBy: z.string().optional(),
  verifiedAt: z.string().optional(),
  disclaimer: z.string().min(1),
}).passthrough();

const stage = z.object({
  id, order: z.number().int(), name: z.string().min(1), windowStart: mmdd, windowEnd: mmdd,
  phenology: z.string(), timingGuidance: z.string(), culturalPractices: z.array(z.string()),
  minIntervalDays: z.number().optional(), maxIntervalDays: z.number().optional(), pollinatorSensitive: z.boolean().optional(),
  provenance: provenance.optional(),
}).passthrough();

const option = z.object({ chemicalId: id, dosePer100L: z.number(), doseUnit: z.enum(['g', 'ml', 'kg', 'l']), notes: z.string().optional() }).passthrough();

const recommendation = z.object({
  id, stageId: id, target: z.array(id), category, options: z.array(option), needBased: z.boolean(),
  systemType: z.enum(['traditional', 'hdp', 'both']), skipForScabResistant: z.boolean().optional(), notes: z.string().optional(),
  provenance: provenance.optional(),
}).passthrough();

const chemical = z.object({
  id, product: z.string().min(1), activeIngredients: z.array(z.string()), moleculeKeys: z.array(z.string()), formulation: z.string(),
  category, fracGroup: z.string().optional(), iracGroup: z.string().optional(), resistanceRisk: z.enum(['low', 'medium', 'high']),
  cibrcRegistered: z.boolean().optional(), appleLabelClaim: z.boolean(), status: z.enum(['registered', 'banned', 'restricted', 'watch']),
  phiDays: z.number().optional(), provenance: provenance.optional(),
}).passthrough();

const pest = z.object({ id, name: z.string().min(1), kind: z.enum(['disease', 'insect', 'mite', 'disorder']) }).passthrough();
const looseRecord = z.object({ id }).passthrough();

export const referenceBundleSchema = z.object({
  version,
  stages: z.array(stage).min(1),
  recommendations: z.array(recommendation),
  chemicals: z.array(chemical).min(1),
  pests: z.array(pest),
  varieties: z.array(looseRecord),
  rootstocks: z.array(looseRecord),
  safety: z.array(looseRecord),
  criticalTemps: z.array(z.object({ stage: z.string(), kill10C: z.number(), kill90C: z.number() }).passthrough()),
  defactoPhiDays: z.number().int().min(0).max(365),
}).passthrough();

export type BundleCheck =
  | { ok: true; bundle: ReferenceBundle; errors: [] }
  | { ok: false; bundle: ReferenceBundle | null; errors: string[] };

/** Structural + integrity validation. `bundle` is null only when the shape itself is wrong. */
export function checkBundle(input: unknown): BundleCheck {
  const parsed = referenceBundleSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 100).map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
    return { ok: false, bundle: null, errors };
  }
  const bundle = parsed.data as unknown as ReferenceBundle;
  const errors = [...validateBundle(bundle), ...extraIntegrity(bundle)];
  return errors.length ? { ok: false, bundle, errors } : { ok: true, bundle, errors: [] };
}

/** Checks validateBundle does not cover but publishing must. */
function extraIntegrity(b: ReferenceBundle): string[] {
  const errs: string[] = [];
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const x of ids) {
      if (seen.has(x)) errs.push(`duplicate ${kind} id ${x}`);
      seen.add(x);
    }
  };
  dup('stage', b.stages.map((s) => s.id));
  dup('chemical', b.chemicals.map((c) => c.id));
  dup('pest', b.pests.map((p) => p.id));
  if (b.version.effectiveFrom > b.version.effectiveTo) errs.push('version: effectiveFrom is after effectiveTo');
  return errs;
}

// ── Diff ─────────────────────────────────────────────────────────────────────

export interface EntityChange { id: string; label: string; fields: string[] }
export interface EntityDiff { added: { id: string; label: string }[]; removed: { id: string; label: string }[]; changed: EntityChange[] }
export interface DoseChange {
  kind: 'added' | 'removed' | 'changed';
  stageId: string;
  stage: string;
  recommendationId: string;
  chemicalId: string;
  product: string;
  before: { dosePer100L: number; doseUnit: string } | null;
  after: { dosePer100L: number; doseUnit: string } | null;
}
export interface StatusChange { chemicalId: string; product: string; before: string; after: string }
export interface BundleDiff {
  against: { versionId: string; season: number; status: string };
  version: string[];
  stages: EntityDiff;
  recommendations: EntityDiff;
  chemicals: EntityDiff;
  chemicalStatus: StatusChange[];
  doseChanges: DoseChange[];
  summary: { added: number; removed: number; changed: number; doseChanges: number };
}

/** Stable JSON (sorted keys) for field-level equality. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));

function changedFields(a: object, b: object): string[] {
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  return [...keys].filter((k) => stable(ra[k]) !== stable(rb[k])).sort();
}

function diffEntities<T extends { id: string }>(before: T[], after: T[], label: (x: T) => string): EntityDiff {
  const b = new Map(before.map((x) => [x.id, x]));
  const a = new Map(after.map((x) => [x.id, x]));
  const out: EntityDiff = { added: [], removed: [], changed: [] };
  for (const [k, x] of a) {
    const old = b.get(k);
    if (!old) out.added.push({ id: k, label: label(x) });
    else {
      const fields = changedFields(old, x);
      if (fields.length) out.changed.push({ id: k, label: label(x), fields });
    }
  }
  for (const [k, x] of b) if (!a.has(k)) out.removed.push({ id: k, label: label(x) });
  return out;
}

/** What changes for growers if `next` replaces `current`. */
export function diffBundles(current: ReferenceBundle, next: ReferenceBundle): BundleDiff {
  const stageName = new Map<string, string>([...current.stages, ...next.stages].map((s: SprayStage) => [s.id, s.name]));
  const product = new Map<string, string>([...current.chemicals, ...next.chemicals].map((c: Chemical) => [c.id, c.product]));
  const recLabel = (r: StageRecommendation) => `${stageName.get(r.stageId) ?? r.stageId}: ${r.target.join(', ') || r.category}`;

  const stages = diffEntities(current.stages, next.stages, (s) => s.name);
  const recommendations = diffEntities(current.recommendations, next.recommendations, recLabel);
  const chemicals = diffEntities(current.chemicals, next.chemicals, (c) => c.product);

  const oldChem = new Map(current.chemicals.map((c) => [c.id, c]));
  const chemicalStatus: StatusChange[] = next.chemicals
    .flatMap((c) => {
      const o = oldChem.get(c.id);
      return o && o.status !== c.status ? [{ chemicalId: c.id, product: c.product, before: o.status, after: c.status }] : [];
    });

  // Dose changes per product per stage, for recommendations present in both bundles.
  const doseChanges: DoseChange[] = [];
  const oldRecs = new Map(current.recommendations.map((r) => [r.id, r]));
  for (const r of next.recommendations) {
    const o = oldRecs.get(r.id);
    if (!o) continue;
    const before = new Map(o.options.map((x) => [x.chemicalId, x]));
    const after = new Map(r.options.map((x) => [x.chemicalId, x]));
    const base = { stageId: r.stageId, stage: stageName.get(r.stageId) ?? r.stageId, recommendationId: r.id };
    for (const [cid, x] of after) {
      const p = before.get(cid);
      const to = { dosePer100L: x.dosePer100L, doseUnit: x.doseUnit };
      if (!p) doseChanges.push({ ...base, kind: 'added', chemicalId: cid, product: product.get(cid) ?? cid, before: null, after: to });
      else if (p.dosePer100L !== x.dosePer100L || p.doseUnit !== x.doseUnit)
        doseChanges.push({ ...base, kind: 'changed', chemicalId: cid, product: product.get(cid) ?? cid, before: { dosePer100L: p.dosePer100L, doseUnit: p.doseUnit }, after: to });
    }
    for (const [cid, p] of before)
      if (!after.has(cid)) doseChanges.push({ ...base, kind: 'removed', chemicalId: cid, product: product.get(cid) ?? cid, before: { dosePer100L: p.dosePer100L, doseUnit: p.doseUnit }, after: null });
  }

  const all = [stages, recommendations, chemicals];
  return {
    against: { versionId: current.version.id, season: current.version.season, status: current.version.status },
    version: changedFields(current.version, next.version).filter((f) => !['status', 'verifiedBy', 'verifiedAt'].includes(f)),
    stages, recommendations, chemicals, chemicalStatus, doseChanges,
    summary: {
      added: all.reduce((s, d) => s + d.added.length, 0),
      removed: all.reduce((s, d) => s + d.removed.length, 0),
      changed: all.reduce((s, d) => s + d.changed.length, 0),
      doseChanges: doseChanges.length,
    },
  };
}

export type ImpactEntry = ReturnType<typeof regulatoryImpact>[number];
export const impactOf = (b: ReferenceBundle): ImpactEntry[] => regulatoryImpact(b);

// ── Storage (shared with scripts/publish-reference.mjs) ─────────────────────

export type PublishStatus = 'draft' | 'under_review' | 'published';
export interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }

export interface PreparedBundle { bundle: ReferenceBundle; etag: string; errors: string[] }

/**
 * Stamp status / sign-off onto the bundle and decide whether it may be stored.
 * 'published' and 'under_review' bundles are served to growers, so they need zero errors;
 * 'published' also needs a named verifier. Drafts may be stored with errors (never served).
 */
export function prepareBundle(input: unknown, status: PublishStatus, verifiedBy?: string, now = new Date()): PreparedBundle | { refused: string; errors: string[] } {
  const check = checkBundle(input);
  if (!check.bundle) return { refused: 'bundle does not have the reference bundle shape', errors: check.errors };
  const who = verifiedBy?.trim() || (status === 'published' ? check.bundle.version.verifiedBy?.trim() : undefined);
  if (status === 'published' && !who) return { refused: 'publishing requires verifiedBy (agronomist sign-off)', errors: check.errors };
  if (status !== 'draft' && check.errors.length) return { refused: `bundle has ${check.errors.length} validation error(s)`, errors: check.errors };
  const version = { ...check.bundle.version, status };
  if (who) Object.assign(version, { verifiedBy: who, verifiedAt: verifiedBy?.trim() ? now.toISOString() : version.verifiedAt ?? now.toISOString() });
  const bundle: ReferenceBundle = { ...check.bundle, version };
  return { bundle, etag: bundleEtag(bundle), errors: check.errors };
}

export interface StoredReference { version_id: string; season: number; status: string; etag: string; published_at: string | null; superseded: string[] }

/** Write through app.admin_store_reference (SECURITY DEFINER; orchard_app cannot write reference_bundles). */
export async function storeReference(q: Queryable, p: PreparedBundle): Promise<StoredReference> {
  const { rows } = await q.query('SELECT * FROM app.admin_store_reference($1, $2, $3, $4::jsonb, $5)', [
    p.bundle.version.id, p.bundle.version.season, p.bundle.version.status, JSON.stringify(p.bundle), p.etag,
  ]);
  const r = rows[0];
  if (!r) throw new Error('reference store returned nothing');
  return {
    version_id: String(r.version_id), season: Number(r.season), status: String(r.status), etag: String(r.etag),
    published_at: r.published_at ? new Date(r.published_at as string).toISOString() : null,
    superseded: (r.superseded as string[] | null) ?? [],
  };
}
