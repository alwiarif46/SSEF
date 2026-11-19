import { randomUUID } from 'node:crypto';
import { BOX_TYPES, GRADES, type Chemical, type ReferenceBundle } from '@orchard/reference';
import { withTenant, type Db, type Tx } from '../../db.js';
import type { Principal } from '../../auth.js';
import { push, type Changes, type PushResult, type WireRow } from '../../sync/sync.js';
import { csvRecords, parseCsv, toCsv } from './csv.js';

/**
 * CSV import of historical records. Rows are validated and name-resolved here, then written
 * through the regular sync `push()` (same role gates, append-only locking, server compliance
 * re-check and inventory draw-down as a device push). Imports are all-or-nothing.
 */

export const IMPORT_KINDS = ['orchards', 'blocks', 'spray_events', 'harvest_records'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const MAX_IMPORT_ROWS = 5000;

interface ColumnSpec { name: string; required?: boolean; help: string }

export const TEMPLATES: Record<ImportKind, { columns: ColumnSpec[]; examples: string[][] }> = {
  orchards: {
    columns: [
      { name: 'name', required: true, help: 'Unique orchard name' },
      { name: 'district', help: 'e.g. Shopian' },
      { name: 'tehsil', help: '' },
      { name: 'village', help: '' },
      { name: 'lat', help: 'Decimal degrees (32–36.5)' },
      { name: 'lng', help: 'Decimal degrees (73–80)' },
      { name: 'elevation_m', help: 'Metres above sea level' },
      { name: 'area_kanal', help: 'Area in kanal' },
      { name: 'khasra_no', help: 'Revenue survey number' },
      { name: 'notes', help: '' },
    ],
    examples: [['Shopian Upper', 'Shopian', 'Zainapora', 'Aglar', '33.7200', '74.8300', '2050', '12', '345/12', '']],
  },
  blocks: {
    columns: [
      { name: 'orchard', required: true, help: 'Existing orchard name' },
      { name: 'name', required: true, help: 'Block name, unique within the orchard' },
      { name: 'system_type', required: true, help: 'traditional | hdp | medium_density' },
      { name: 'rootstock', help: 'Rootstock id or name, e.g. M9 (T337)' },
      { name: 'training_system', help: 'e.g. tall spindle' },
      { name: 'planting_year', help: 'YYYY' },
      { name: 'area_kanal', help: '' },
      { name: 'tree_count', help: '' },
      { name: 'varieties', help: 'variety[:trees]; separated, e.g. Gala Redlum:1400; Golden Delicious:200' },
      { name: 'scab_resistant', help: 'yes | no' },
      { name: 'full_bloom_date', help: 'YYYY-MM-DD' },
      { name: 'expected_harvest_date', help: 'YYYY-MM-DD' },
      { name: 'drip', help: 'yes | no' },
      { name: 'hail_net', help: 'yes | no' },
      { name: 'trellis', help: 'yes | no' },
      { name: 'notes', help: '' },
    ],
    examples: [['Shopian Upper', 'HDP-1', 'hdp', 'M9 (T337)', 'tall spindle', '2021', '4', '1600', 'Gala Redlum:1400; Golden Delicious:200', 'no', '2026-04-18', '2026-08-20', 'yes', 'yes', 'yes', '']],
  },
  spray_events: {
    columns: [
      { name: 'orchard', help: 'Orchard name (needed when block names repeat across orchards)' },
      { name: 'block', required: true, help: 'Existing block name' },
      { name: 'sprayed_on', required: true, help: 'YYYY-MM-DD (or DD/MM/YYYY)' },
      { name: 'stage', help: 'Stage id or name, e.g. Pink Bud' },
      { name: 'product', required: true, help: 'Product name, catalogue id or active ingredient — one product per row' },
      { name: 'dose_per_100l', help: 'Dose per 100 L water' },
      { name: 'unit', help: 'g | ml | kg | l' },
      { name: 'quantity', help: 'Total quantity used (defaults to dose x total litres / 100)' },
      { name: 'total_litres', help: 'Total spray liquid' },
      { name: 'tank_litres', help: 'Tank size' },
      { name: 'operator', help: 'Team member name or phone' },
      { name: 'spray_ref', help: 'Rows sharing a ref are one tank-mix; default groups rows by block + date + stage' },
      { name: 'override_reason', help: 'Reason when the spray broke a warning' },
      { name: 'notes', help: '' },
    ],
    examples: [
      ['Shopian Upper', 'HDP-1', '2026-04-10', 'Pink Bud', 'Captan 50 WP', '300', 'g', '', '400', '200', '', 'pink-1', '', 'Dry morning'],
      ['Shopian Upper', 'HDP-1', '2026-04-10', 'Pink Bud', 'Hexaconazole 5 EC', '50', 'ml', '', '400', '200', '', 'pink-1', '', ''],
    ],
  },
  harvest_records: {
    columns: [
      { name: 'orchard', help: 'Orchard name (needed when block names repeat across orchards)' },
      { name: 'block', required: true, help: 'Existing block name' },
      { name: 'picked_on', required: true, help: 'YYYY-MM-DD (or DD/MM/YYYY)' },
      { name: 'variety', help: 'Variety id or name' },
      { name: 'grade', help: 'A | B | C' },
      { name: 'box_type', help: 'wooden | carton | tray-10 | crate' },
      { name: 'box_count', help: 'Number of boxes' },
      { name: 'kg', help: 'Defaults to boxes x box weight' },
      { name: 'mandi', help: 'Market' },
      { name: 'price_per_box_inr', help: 'Rs per box' },
      { name: 'buyer', help: 'Buyer / commission agent' },
      { name: 'starch_index', help: '1–8' },
      { name: 'tss_brix', help: '°Brix' },
      { name: 'firmness_lb', help: 'lb' },
      { name: 'red_colour_pct', help: '0–100' },
      { name: 'notes', help: '' },
    ],
    examples: [['Shopian Upper', 'HDP-1', '2026-08-22', 'Gala Redlum', 'A', 'wooden', '120', '', 'Shopian (Aglar)', '950', 'M/s Dar & Sons', '3.5', '12.5', '17.2', '80', '']],
  },
};

export const templateCsv = (kind: ImportKind) => toCsv([TEMPLATES[kind].columns.map((c) => c.name), ...TEMPLATES[kind].examples]);

// ── Context & resolution ────────────────────────────────────────────────────────

export interface ImportContext {
  bundle: ReferenceBundle;
  orchards: { id: string; name: string }[];
  blocks: { id: string; name: string; orchard_id: string }[];
  users: { id: string; name: string; phone: string }[];
  /** Existing records, for duplicate warnings. */
  existingSprays: { block_id: string; sprayed_on: string; chemicals: string[] }[];
  existingHarvest: { block_id: string; picked_on: string; box_count: number | null }[];
}

export async function loadContext(tx: Tx, bundle: ReferenceBundle): Promise<ImportContext> {
  const q = async <T>(sql: string) => (await tx.query(sql)).rows as T[];
  return {
    bundle,
    orchards: await q('SELECT id, name FROM public.orchards WHERE deleted_at IS NULL'),
    blocks: await q('SELECT id, name, orchard_id FROM public.blocks WHERE deleted_at IS NULL'),
    users: await q('SELECT id::text AS id, name, phone FROM public.users WHERE active'),
    existingSprays: (await q<{ block_id: string; sprayed_on: string; products: { chemicalId: string }[] | null }>(
      `SELECT block_id, sprayed_on, products FROM public.spray_events WHERE deleted_at IS NULL`,
    )).map((s) => ({ block_id: s.block_id, sprayed_on: s.sprayed_on, chemicals: (s.products ?? []).map((p) => p.chemicalId).sort() })),
    existingHarvest: await q('SELECT block_id, picked_on, box_count FROM public.harvest_records WHERE deleted_at IS NULL'),
  };
}

export const norm = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9%.+]+/g, ' ').trim().replace(/\s+/g, ' ');
const squash = (s: string) => norm(s).replace(/[\s.]/g, '');

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

export function resolveChemical(bundle: ReferenceBundle, input: string): Resolved<Chemical> {
  const v = input.trim();
  const byId = bundle.chemicals.find((c) => c.id === v.toLowerCase());
  if (byId) return { ok: true, value: byId };
  const n = squash(v);
  const byName = bundle.chemicals.filter((c) => squash(c.product) === n);
  if (byName.length === 1) return { ok: true, value: byName[0]! };
  // Active ingredient(s): "captan", "tebuconazole + captan".
  const ais = v.split(/\s*(?:\+|&|\band\b)\s*/i).map(squash).filter(Boolean).sort().join('+');
  const byAi = bundle.chemicals.filter((c) => c.activeIngredients.map(squash).sort().join('+') === ais);
  if (byAi.length === 1) return { ok: true, value: byAi[0]! };
  if (byAi.length > 1) return { ok: false, error: `"${v}" matches several products (${byAi.map((c) => c.product).join(', ')}); use the product name` };
  const prefix = bundle.chemicals.filter((c) => squash(c.product).startsWith(n) && n.length >= 4);
  if (prefix.length === 1) return { ok: true, value: prefix[0]! };
  return { ok: false, error: `unknown product "${v}" — only catalogued products can be recorded` };
}

function resolveNamed<T extends { id: string; name: string }>(list: T[], input: string, what: string): Resolved<T> {
  const v = input.trim();
  const byId = list.find((x) => x.id === v);
  if (byId) return { ok: true, value: byId };
  const hits = list.filter((x) => norm(x.name) === norm(v));
  if (hits.length === 1) return { ok: true, value: hits[0]! };
  if (hits.length > 1) return { ok: false, error: `${what} "${v}" is ambiguous` };
  return { ok: false, error: `unknown ${what} "${v}"` };
}

function resolveBlock(ctx: ImportContext, orchard: string, block: string): Resolved<{ id: string; name: string; orchard_id: string }> {
  let blocks = ctx.blocks;
  if (orchard) {
    const o = resolveNamed(ctx.orchards, orchard, 'orchard');
    if (!o.ok) return o;
    blocks = blocks.filter((b) => b.orchard_id === o.value.id);
  }
  const r = resolveNamed(blocks, block, 'block');
  if (!r.ok && /ambiguous/.test(r.error)) return { ok: false, error: `${r.error}; add the orchard column` };
  return r;
}

// ── Field parsing ───────────────────────────────────────────────────────────────

class RowErrors {
  errors: string[] = [];
  warnings: string[] = [];
  req(rec: Record<string, string>, k: string): string {
    const v = rec[k] ?? '';
    if (!v) this.errors.push(`${k} is required`);
    return v;
  }
  num(rec: Record<string, string>, k: string, o: { min?: number; max?: number; int?: boolean } = {}): number | null {
    const raw = (rec[k] ?? '').replace(/,/g, '');
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || (o.int && !Number.isInteger(n))) {
      this.errors.push(`${k} must be ${o.int ? 'a whole number' : 'a number'} (got "${rec[k]}")`);
      return null;
    }
    if ((o.min != null && n < o.min) || (o.max != null && n > o.max)) {
      this.errors.push(`${k} must be between ${o.min ?? '-∞'} and ${o.max ?? '∞'}`);
      return null;
    }
    return n;
  }
  date(rec: Record<string, string>, k: string): string | null {
    const raw = rec[k] ?? '';
    if (!raw) return null;
    const iso = parseDate(raw);
    if (!iso) this.errors.push(`${k} must be a date YYYY-MM-DD or DD/MM/YYYY (got "${raw}")`);
    return iso;
  }
  bool(rec: Record<string, string>, k: string): boolean | null {
    const raw = (rec[k] ?? '').toLowerCase();
    if (!raw) return null;
    if (['y', 'yes', 'true', '1'].includes(raw)) return true;
    if (['n', 'no', 'false', '0'].includes(raw)) return false;
    this.errors.push(`${k} must be yes or no`);
    return null;
  }
  text(rec: Record<string, string>, k: string, max = 500): string | null {
    const v = rec[k] ?? '';
    if (v.length > max) {
      this.errors.push(`${k} is longer than ${max} characters`);
      return null;
    }
    return v || null;
  }
  take<T>(r: Resolved<T>): T | null {
    if (r.ok) return r.value;
    this.errors.push(r.error);
    return null;
  }
}

export function parseDate(s: string): string | null {
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s.trim());
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

const SYSTEM_ALIASES: Record<string, string> = { traditional: 'traditional', seedling: 'traditional', hdp: 'hdp', 'high density': 'hdp', 'high density plantation': 'hdp', medium_density: 'medium_density', 'medium density': 'medium_density', mdp: 'medium_density' };
const UNITS: Record<string, 'g' | 'ml' | 'kg' | 'l'> = { g: 'g', gm: 'g', gram: 'g', grams: 'g', kg: 'kg', ml: 'ml', l: 'l', lt: 'l', ltr: 'l', litre: 'l', liter: 'l', litres: 'l' };

// ── Preparation ─────────────────────────────────────────────────────────────────

export interface RowOutcome { row: number; ok: boolean; errors: string[]; warnings: string[]; preview: Record<string, unknown>; recordId?: string }
interface PreparedRecord { id: string; wire: WireRow; rows: number[] }
export interface Prepared { table: ImportKind; records: PreparedRecord[]; outcomes: RowOutcome[] }

/** Data row number as the user sees it in a spreadsheet (header is row 1). */
const rowNo = (i: number) => i + 2;

export function prepareImport(kind: ImportKind, records: Record<string, string>[], ctx: ImportContext): Prepared {
  switch (kind) {
    case 'orchards': return prepareOrchards(records, ctx);
    case 'blocks': return prepareBlocks(records, ctx);
    case 'spray_events': return prepareSprays(records, ctx);
    case 'harvest_records': return prepareHarvest(records, ctx);
  }
}

function single(kind: ImportKind, records: Record<string, string>[], build: (rec: Record<string, string>, e: RowErrors, i: number) => WireRow | null): Prepared {
  const out: Prepared = { table: kind, records: [], outcomes: [] };
  records.forEach((rec, i) => {
    const e = new RowErrors();
    const wire = build(rec, e, i);
    const ok = !e.errors.length && !!wire;
    out.outcomes.push({ row: rowNo(i), ok, errors: e.errors, warnings: e.warnings, preview: wire ? stripId(wire) : {}, ...(ok ? { recordId: wire!.id } : {}) });
    if (ok) out.records.push({ id: wire!.id, wire: wire!, rows: [rowNo(i)] });
  });
  return out;
}

const stripId = (w: WireRow) => Object.fromEntries(Object.entries(w).filter(([k, v]) => k !== 'id' && v != null && v !== ''));

function prepareOrchards(records: Record<string, string>[], ctx: ImportContext): Prepared {
  const seen = new Map<string, number>();
  return single('orchards', records, (rec, e, i) => {
    const name = e.req(rec, 'name');
    if (name) {
      if (ctx.orchards.some((o) => norm(o.name) === norm(name))) e.errors.push(`orchard "${name}" already exists`);
      const prev = seen.get(norm(name));
      if (prev != null) e.errors.push(`duplicate of row ${prev}`);
      else seen.set(norm(name), rowNo(i));
    }
    const lat = e.num(rec, 'lat', { min: 32, max: 36.5 });
    const lng = e.num(rec, 'lng', { min: 73, max: 80 });
    if ((lat == null) !== (lng == null)) e.errors.push('give both lat and lng, or neither');
    return {
      id: randomUUID(), name: e.text(rec, 'name', 120), district: e.text(rec, 'district', 60), tehsil: e.text(rec, 'tehsil', 60), village: e.text(rec, 'village', 80),
      lat, lng, elevation_m: e.num(rec, 'elevation_m', { min: 0, max: 5000 }), area_kanal: e.num(rec, 'area_kanal', { min: 0, max: 100000 }),
      khasra_no: e.text(rec, 'khasra_no', 60), notes: e.text(rec, 'notes'),
    };
  });
}

function prepareBlocks(records: Record<string, string>[], ctx: ImportContext): Prepared {
  const seen = new Map<string, number>();
  const { bundle } = ctx;
  return single('blocks', records, (rec, e, i) => {
    const orchardName = e.req(rec, 'orchard');
    const orchard = orchardName ? e.take(resolveNamed(ctx.orchards, orchardName, 'orchard')) : null;
    const name = e.req(rec, 'name');
    if (orchard && name) {
      if (ctx.blocks.some((b) => b.orchard_id === orchard.id && norm(b.name) === norm(name))) e.errors.push(`block "${name}" already exists in ${orchard.name}`);
      const key = `${orchard.id}|${norm(name)}`;
      const prev = seen.get(key);
      if (prev != null) e.errors.push(`duplicate of row ${prev}`);
      else seen.set(key, rowNo(i));
    }
    const sysRaw = e.req(rec, 'system_type');
    const system = sysRaw ? SYSTEM_ALIASES[norm(sysRaw).replace(/_/g, ' ')] ?? SYSTEM_ALIASES[sysRaw.trim().toLowerCase()] : undefined;
    if (sysRaw && !system) e.errors.push('system_type must be traditional, hdp or medium_density');
    const rootstock = rec.rootstock ? e.take(resolveNamed(bundle.rootstocks, rec.rootstock, 'rootstock')) : null;
    const mix: { varietyId: string; trees: number }[] = [];
    for (const part of (rec.varieties ?? '').split(/[;|]/).map((x) => x.trim()).filter(Boolean)) {
      const m = /^(.*?)(?::\s*([\d,]+))?$/.exec(part)!;
      const v = e.take(resolveNamed(bundle.varieties, m[1]!, 'variety'));
      if (v) mix.push({ varietyId: v.id, trees: m[2] ? Number(m[2].replace(/,/g, '')) : 0 });
    }
    const tree = e.num(rec, 'tree_count', { min: 0, max: 1_000_000, int: true });
    const mixTrees = mix.reduce((s, x) => s + x.trees, 0);
    if (tree != null && mixTrees > tree) e.warnings.push(`variety tree counts (${mixTrees}) exceed tree_count (${tree})`);
    const fb = e.date(rec, 'full_bloom_date');
    const eh = e.date(rec, 'expected_harvest_date');
    if (fb && eh && eh <= fb) e.errors.push('expected_harvest_date must be after full_bloom_date');
    const scab = e.bool(rec, 'scab_resistant');
    return {
      id: randomUUID(), orchard_id: orchard?.id ?? '', name: e.text(rec, 'name', 120), system_type: system ?? '', rootstock_id: rootstock?.id ?? null,
      training_system: e.text(rec, 'training_system', 60), planting_year: e.num(rec, 'planting_year', { min: 1900, max: 2100, int: true }),
      area_kanal: e.num(rec, 'area_kanal', { min: 0, max: 100000 }), tree_count: tree, variety_mix: mix.length ? mix : null,
      scab_resistant: scab ?? (mix.length ? mix.every((m) => bundle.varieties.find((v) => v.id === m.varietyId)?.scabResistant) : null),
      full_bloom_date: fb, expected_harvest_date: eh, drip: e.bool(rec, 'drip'), hail_net: e.bool(rec, 'hail_net'), trellis: e.bool(rec, 'trellis'), notes: e.text(rec, 'notes'),
    };
  });
}

function resolveUser(ctx: ImportContext, v: string): Resolved<{ id: string; name: string }> {
  const digits = v.replace(/\D/g, '');
  if (digits.length >= 10) {
    const u = ctx.users.find((x) => x.phone.replace(/\D/g, '').endsWith(digits.slice(-10)));
    if (u) return { ok: true, value: u };
  }
  return resolveNamed(ctx.users, v, 'operator');
}

function prepareSprays(records: Record<string, string>[], ctx: ImportContext): Prepared {
  const { bundle } = ctx;
  interface Line { i: number; e: RowErrors; block?: { id: string; name: string }; date: string | null; stageId: string | null; line?: Record<string, unknown>; chem?: Chemical; group: string; rec: Record<string, string> }
  const lines: Line[] = records.map((rec, i) => {
    const e = new RowErrors();
    const blockName = e.req(rec, 'block');
    const block = blockName ? e.take(resolveBlock(ctx, rec.orchard ?? '', blockName)) : null;
    if (!rec.sprayed_on) e.errors.push('sprayed_on is required');
    const date = e.date(rec, 'sprayed_on');
    let stageId: string | null = null;
    if (rec.stage) {
      const s = bundle.stages.find((x) => x.id === rec.stage || norm(x.name) === norm(rec.stage!) || norm(x.name).startsWith(norm(rec.stage!)));
      if (s) stageId = s.id;
      else e.errors.push(`unknown stage "${rec.stage}"`);
    }
    const productIn = e.req(rec, 'product');
    const chem = productIn ? e.take(resolveChemical(bundle, productIn)) : null;
    const dose = e.num(rec, 'dose_per_100l', { min: 0, max: 100000 });
    const unitRaw = (rec.unit ?? '').trim().toLowerCase();
    const unit = unitRaw ? UNITS[unitRaw] : undefined;
    if (unitRaw && !unit) e.errors.push('unit must be g, ml, kg or l');
    if ((dose != null || rec.quantity) && !unit) e.errors.push('unit is required with a dose or quantity');
    let quantity = e.num(rec, 'quantity', { min: 0, max: 1_000_000 });
    const total = e.num(rec, 'total_litres', { min: 0, max: 1_000_000 });
    if (quantity == null && dose != null && total != null) quantity = Math.round(((dose * total) / 100) * 1000) / 1000;
    const today = new Date().toISOString().slice(0, 10);
    if (date && date > today) e.errors.push('sprayed_on is in the future — import records sprays that happened');
    const group = rec.spray_ref ? `ref:${rec.spray_ref}` : `auto:${block?.id}|${date}|${stageId ?? ''}`;
    return {
      i, e, ...(block ? { block } : {}), date, stageId, group, rec, ...(chem ? { chem } : {}),
      ...(chem ? { line: { chemicalId: chem.id, ...(dose != null ? { dosePer100L: dose } : {}), ...(unit ? { unit } : {}), ...(quantity != null ? { quantity } : {}) } } : {}),
    };
  });

  const groups = new Map<string, Line[]>();
  for (const l of lines) groups.set(l.group, [...(groups.get(l.group) ?? []), l]);
  const out: Prepared = { table: 'spray_events', records: [], outcomes: [] };
  const byRow = new Map<number, RowOutcome>();
  const built: { date: string; rec: PreparedRecord }[] = [];
  for (const g of groups.values()) {
    const first = g[0]!;
    const shared = (k: string) => {
      const vals = [...new Set(g.map((l) => (l.rec[k] ?? '').trim()).filter(Boolean))];
      if (vals.length > 1) for (const l of g) l.e.errors.push(`rows of one spray disagree on ${k} (${vals.join(' / ')})`);
      return vals[0] ?? '';
    };
    for (const k of ['block', 'orchard', 'sprayed_on', 'stage', 'total_litres', 'tank_litres', 'operator', 'override_reason']) shared(k);
    const chems = g.map((l) => l.chem?.id).filter((x): x is string => !!x);
    if (new Set(chems).size !== chems.length) for (const l of g) l.e.errors.push('the same product appears twice in one spray');
    const ge = new RowErrors();
    const total = ge.num(first.rec, 'total_litres', { min: 0, max: 1_000_000 });
    const tank = ge.num(first.rec, 'tank_litres', { min: 0, max: 100_000 });
    const op = shared('operator');
    const operator = op ? ge.take(resolveUser(ctx, op)) : null;
    const notes = g.map((l) => l.rec.notes).filter(Boolean).join(' · ') || null;
    const override = shared('override_reason') || null;
    for (const l of g) l.e.errors.push(...ge.errors.filter((x) => !l.e.errors.includes(x)));
    const ok = g.every((l) => !l.e.errors.length) && !!first.block && !!first.date;
    const id = randomUUID();
    const wire: WireRow = {
      id, block_id: first.block?.id ?? '', stage_id: first.stageId, sprayed_on: first.date ?? '', products: g.map((l) => l.line).filter(Boolean),
      tank_litres: tank, total_litres: total, tank_fills: tank && total ? Math.ceil(total / tank) : null, operator_user_id: operator?.id ?? null,
      override_reason: override, notes,
    };
    if (ok && first.block && first.date && ctx.existingSprays.some((s) => s.block_id === first.block!.id && s.sprayed_on === first.date && s.chemicals.join() === [...chems].sort().join()))
      for (const l of g) l.e.warnings.push('a spray with the same block, date and products is already recorded');
    for (const l of g)
      byRow.set(rowNo(l.i), {
        row: rowNo(l.i), ok, errors: l.e.errors, warnings: l.e.warnings,
        preview: { block: first.block?.name, sprayed_on: first.date, stage: first.stageId, product: l.chem?.product, ...(l.line ?? {}), spray: g.length > 1 ? `${g.length}-product tank mix` : undefined },
        ...(ok ? { recordId: id } : {}),
      });
    if (ok) built.push({ date: first.date!, rec: { id, wire, rows: g.map((l) => rowNo(l.i)) } });
  }
  // Chronological order so the server's rotation/PHI re-check sees earlier sprays first.
  built.sort((a, b) => a.date.localeCompare(b.date));
  out.records = built.map((b) => b.rec);
  out.outcomes = [...byRow.values()].sort((a, b) => a.row - b.row);
  return out;
}

function prepareHarvest(records: Record<string, string>[], ctx: ImportContext): Prepared {
  const { bundle } = ctx;
  return single('harvest_records', records, (rec, e) => {
    const blockName = e.req(rec, 'block');
    const block = blockName ? e.take(resolveBlock(ctx, rec.orchard ?? '', blockName)) : null;
    if (!rec.picked_on) e.errors.push('picked_on is required');
    const picked = e.date(rec, 'picked_on');
    if (picked && picked > new Date().toISOString().slice(0, 10)) e.errors.push('picked_on is in the future');
    const variety = rec.variety ? e.take(resolveNamed(bundle.varieties, rec.variety, 'variety')) : null;
    let grade: string | null = null;
    if (rec.grade) {
      grade = (GRADES as readonly string[]).find((g) => g.toLowerCase() === rec.grade!.toLowerCase()) ?? null;
      if (!grade) e.errors.push(`grade must be one of ${GRADES.join(', ')}`);
    }
    let box: (typeof BOX_TYPES)[number] | undefined;
    if (rec.box_type) {
      box = BOX_TYPES.find((b) => b.id === rec.box_type!.toLowerCase() || norm(b.label) === norm(rec.box_type!));
      if (!box) e.errors.push(`box_type must be one of ${BOX_TYPES.map((b) => b.id).join(', ')}`);
    }
    const boxes = e.num(rec, 'box_count', { min: 0, max: 1_000_000 });
    const kg = e.num(rec, 'kg', { min: 0, max: 10_000_000 }) ?? (box && boxes != null ? boxes * box.kg : null);
    if (block && picked && ctx.existingHarvest.some((h) => h.block_id === block.id && h.picked_on === picked && (h.box_count ?? null) === boxes))
      e.warnings.push('a harvest with the same block, date and box count is already recorded');
    return {
      id: randomUUID(), block_id: block?.id ?? '', variety_id: variety?.id ?? null, picked_on: picked ?? '', grade, box_type: box?.id ?? null, box_count: boxes, kg,
      mandi: e.text(rec, 'mandi', 80), price_per_box_inr: e.num(rec, 'price_per_box_inr', { min: 0, max: 100_000 }), buyer: e.text(rec, 'buyer', 120),
      starch_index: e.num(rec, 'starch_index', { min: 1, max: 8 }), tss_brix: e.num(rec, 'tss_brix', { min: 0, max: 40 }), firmness_lb: e.num(rec, 'firmness_lb', { min: 0, max: 40 }),
      red_colour_pct: e.num(rec, 'red_colour_pct', { min: 0, max: 100 }), notes: e.text(rec, 'notes'),
    };
  });
}

// ── Execution ───────────────────────────────────────────────────────────────────

export interface ImportResult {
  kind: ImportKind;
  dryRun: boolean;
  committed: boolean;
  summary: { rows: number; valid: number; invalid: number; warnings: number; records: number };
  columns: string[];
  unknownColumns: string[];
  rows: RowOutcome[];
}

/** Thrown out of the transaction to roll it back while carrying the computed outcome. */
class Rollback extends Error {
  constructor(public readonly prep: Prepared) {
    super('import rolled back');
  }
}

export class ImportInputError extends Error {
  statusCode = 400;
}

export async function runImport(db: Db, p: Principal, kind: ImportKind, csv: string, dryRun: boolean, bundle: ReferenceBundle): Promise<ImportResult> {
  let parsed: string[][];
  try {
    parsed = parseCsv(csv, { maxRows: MAX_IMPORT_ROWS + 1 });
  } catch (e) {
    throw new ImportInputError(`CSV could not be read: ${(e as Error).message}`);
  }
  const { headers, records } = csvRecords(parsed);
  if (!headers.length) throw new ImportInputError('CSV is empty');
  const spec = TEMPLATES[kind].columns;
  const missing = spec.filter((c) => c.required && !headers.includes(c.name)).map((c) => c.name);
  if (missing.length) throw new ImportInputError(`missing required column(s): ${missing.join(', ')}`);
  if (!records.length) throw new ImportInputError('CSV has a header but no data rows');
  const unknownColumns = headers.filter((h) => h && !spec.some((c) => c.name === h));

  const run = async (tx: Tx) => {
    const ctx = await loadContext(tx, bundle);
    const prep = prepareImport(kind, records, ctx);
    const valid = prep.outcomes.every((o) => o.ok);
    let res: PushResult | null = null;
    // Even a dry run pushes (inside a transaction that is rolled back) so the preview reflects
    // exactly what the server would accept, reject and flag.
    if (prep.records.length && (valid || dryRun)) {
      const changes: Changes = { [kind]: { created: prep.records.map((r) => r.wire), updated: [], deleted: [] } };
      res = await push(tx, p, changes, 0, bundle);
    }
    applyPushResult(prep, res);
    const clean = prep.outcomes.every((o) => o.ok);
    if (dryRun || !clean) throw new Rollback(prep);
    return prep;
  };

  let prep: Prepared;
  let committed = false;
  try {
    prep = await withTenant(db, p.tenantId, run);
    committed = true;
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    prep = e.prep;
  }
  return summarise(kind, dryRun, committed, headers, unknownColumns, prep);
}

function applyPushResult(prep: Prepared, res: PushResult | null) {
  if (!res) return;
  const rowsOf = new Map(prep.records.map((r) => [r.id, r.rows]));
  const outcome = new Map(prep.outcomes.map((o) => [o.row, o]));
  for (const r of res.rejected)
    for (const row of rowsOf.get(r.id) ?? []) {
      const o = outcome.get(row);
      if (o) {
        o.ok = false;
        o.errors.push(`server rejected: ${r.reason}`);
        delete o.recordId;
      }
    }
  for (const f of res.flags)
    for (const row of rowsOf.get(f.id) ?? []) {
      const o = outcome.get(row);
      if (o) for (const v of f.violations as { code: string; message?: string }[]) o.warnings.push(`compliance flag ${v.code}: ${v.message ?? ''}`.trim());
    }
}

function summarise(kind: ImportKind, dryRun: boolean, committed: boolean, columns: string[], unknownColumns: string[], prep: Prepared): ImportResult {
  const valid = prep.outcomes.filter((o) => o.ok).length;
  return {
    kind,
    dryRun,
    committed,
    summary: {
      rows: prep.outcomes.length,
      valid,
      invalid: prep.outcomes.length - valid,
      warnings: prep.outcomes.reduce((s, o) => s + o.warnings.length, 0),
      records: committed ? prep.records.length : prep.records.filter((r) => r.rows.every((n) => prep.outcomes.find((o) => o.row === n)?.ok)).length,
    },
    columns,
    unknownColumns,
    rows: prep.outcomes,
  };
}
