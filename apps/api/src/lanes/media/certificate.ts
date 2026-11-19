import PDFDocument from 'pdfkit';
import type { Chemical, ReferenceBundle } from '@orchard/reference';
import type { Tx } from '../../db.js';

/**
 * Spray certificate: a per-block, per-season residue-compliance document for buyers, exporters
 * and audits. The model is computed from recorded (locked) facts; the PDF is a rendering of it.
 */

/** Sprays this close to harvest are blocked outright by the planner (domain `validateSpray`). */
export const HARD_STOP_DAYS = 21;
/** Codes that make the produce non-compliant regardless of timing. */
const REGULATORY_CODES = new Set(['BANNED', 'NOT_REGISTERED', 'NO_LABEL_CLAIM', 'UNKNOWN_CHEMICAL']);

export interface BatchRef { batchNo?: string | null; registrationNo?: string | null }
export interface ProductLine { chemicalId: string; dosePer100L?: number | null; unit?: string | null; quantity?: number | null; batches?: BatchRef[] | null }
export interface ViolationRec { code: string; severity: string; message?: string; chemicalId?: string }

export interface SprayRecord {
  id: string;
  sprayed_on: string;
  stage_id: string | null;
  products: ProductLine[] | null;
  tank_litres: number | null;
  total_litres: number | null;
  operator: string | null;
  violations: ViolationRec[] | null;
  override_reason: string | null;
  corrects_id: string | null;
  notes: string | null;
}

export interface CertificateInput {
  season: number;
  generatedAt: Date;
  tenantName: string;
  orchard: { name: string; district: string | null; tehsil: string | null; village: string | null; khasra_no: string | null; lat: number | null; lng: number | null; elevation_m: number | null; area_kanal: number | null };
  block: { id: string; name: string; system_type: string; rootstock_id: string | null; training_system: string | null; planting_year: number | null; area_kanal: number | null; tree_count: number | null; variety_mix: { varietyId: string; trees?: number }[] | null; scab_resistant: boolean | null; full_bloom_date: string | null; expected_harvest_date: string | null };
  sprays: SprayRecord[];
  /** Effective (non-superseded, non-deleted) harvest pick dates in the season. */
  pickDates: string[];
}

export type PhiVerdict = 'PASS' | 'WARN' | 'FAIL' | 'PENDING' | 'NOT_APPLICABLE';

export interface CertLine {
  chemicalId: string;
  product: string;
  activeIngredients: string;
  groups: string;
  dose: string;
  quantity: string;
  batch: string;
  registrationNo: string;
}

export interface CertSpray {
  id: string;
  date: string;
  stage: string;
  operator: string;
  tankLitres: number | null;
  totalLitres: number | null;
  lines: CertLine[];
  flags: string[];
  overrideReason: string | null;
  superseded: boolean;
  supersededBy: string | null;
  corrects: string | null;
}

export interface PhiRow {
  chemicalId: string;
  product: string;
  category: string;
  /** The application that decides the verdict (closest to the harvest it precedes), else the latest. */
  lastApplied: string;
  harvestRef: string | null;
  daysBeforeHarvest: number | null;
  labelPhiDays: number | null;
  requiredDays: number;
  verdict: PhiVerdict;
  note: string;
}

export interface CertificateModel {
  season: number;
  generatedAt: string;
  tenantName: string;
  orchard: CertificateInput['orchard'];
  block: CertificateInput['block'] & { rootstock: string | null; systemLabel: string };
  varieties: { name: string; trees: number | null }[];
  schedule: { id: string; source: string; status: string };
  disclaimer: string;
  sprays: CertSpray[];
  harvest: { date: string | null; basis: 'recorded' | 'expected' | 'unknown'; picks: number };
  lastSprayDate: string | null;
  daysBeforeHarvest: number | null;
  phi: PhiRow[];
  overall: { verdict: 'COMPLIANT' | 'COMPLIANT_WITH_WARNINGS' | 'NON_COMPLIANT' | 'PENDING'; reasons: string[] };
}

const SYSTEM_LABEL: Record<string, string> = { traditional: 'Traditional (seedling rootstock)', hdp: 'High-density (clonal rootstock)', medium_density: 'Medium density' };

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

const isPesticidal = (c: Chemical | undefined) => !c || (c.category !== 'nutrient' && c.category !== 'cultural');

const fmtNum = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? '' : String(Math.round(Number(n) * 1000) / 1000));

/** Ids of rows that a later row corrects (transitively every row that has a correction). */
export function supersededIds(rows: { id: string; corrects_id: string | null }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (r.corrects_id) m.set(r.corrects_id, r.id);
  return m;
}

export function buildCertificate(input: CertificateInput, bundle: ReferenceBundle): CertificateModel {
  const chem = new Map(bundle.chemicals.map((c) => [c.id, c]));
  const stageName = (id: string | null) => (id ? bundle.stages.find((s) => s.id === id)?.name ?? id : '');
  const sorted = [...input.sprays].sort((a, b) => a.sprayed_on.localeCompare(b.sprayed_on) || a.id.localeCompare(b.id));
  const supersededBy = supersededIds(sorted);

  const sprays: CertSpray[] = sorted.map((s) => ({
    id: s.id,
    date: s.sprayed_on,
    stage: stageName(s.stage_id),
    operator: s.operator ?? '',
    tankLitres: s.tank_litres,
    totalLitres: s.total_litres,
    lines: (s.products ?? []).map((p) => {
      const c = chem.get(p.chemicalId);
      const batches = (p.batches ?? []).filter(Boolean);
      return {
        chemicalId: p.chemicalId,
        product: c?.product ?? `${p.chemicalId} (not catalogued)`,
        activeIngredients: c?.activeIngredients.join(' + ') ?? '',
        groups: [c?.fracGroup && `FRAC ${c.fracGroup}`, c?.iracGroup && `IRAC ${c.iracGroup}`].filter(Boolean).join(', '),
        dose: p.dosePer100L != null ? `${fmtNum(p.dosePer100L)} ${p.unit ?? ''}/100 L`.trim() : '',
        quantity: p.quantity != null ? `${fmtNum(p.quantity)} ${p.unit ?? ''}`.trim() : '',
        batch: [...new Set(batches.map((b) => b.batchNo).filter((x): x is string => !!x))].join(', '),
        registrationNo: [...new Set(batches.map((b) => b.registrationNo).filter((x): x is string => !!x))].join(', '),
      };
    }),
    flags: (s.violations ?? []).filter((v) => v.severity !== 'info').map((v) => `${v.severity === 'block' ? '!' : '~'} ${v.code}`),
    overrideReason: s.override_reason,
    superseded: supersededBy.has(s.id),
    supersededBy: supersededBy.get(s.id) ?? null,
    corrects: s.corrects_id,
  }));
  const effective = sorted.filter((s) => !supersededBy.has(s.id));

  // Harvest reference: recorded picks first, then the block's expected date (same season only).
  const picks = [...input.pickDates].sort();
  const expected = input.block.expected_harvest_date && input.block.expected_harvest_date.startsWith(String(input.season)) ? input.block.expected_harvest_date : null;
  const harvest = picks.length
    ? { date: picks[0]!, basis: 'recorded' as const, picks: picks.length }
    : expected
      ? { date: expected, basis: 'expected' as const, picks: 0 }
      : { date: null, basis: 'unknown' as const, picks: 0 };
  const pickRefs = picks.length ? picks : expected ? [expected] : [];
  /** First pick on or after an application (the fruit that application could reach). */
  const nextPick = (d: string) => pickRefs.find((p) => p >= d) ?? null;

  // PHI per product: worst case over every pre-harvest application of that product.
  const byChem = new Map<string, { dates: string[] }>();
  for (const s of effective)
    for (const p of s.products ?? []) {
      const e = byChem.get(p.chemicalId) ?? { dates: [] };
      e.dates.push(s.sprayed_on);
      byChem.set(p.chemicalId, e);
    }
  const rank: Record<PhiVerdict, number> = { NOT_APPLICABLE: 0, PASS: 1, PENDING: 2, WARN: 3, FAIL: 4 };
  const phi: PhiRow[] = [...byChem.entries()].map(([id, e]): PhiRow => {
    const c = chem.get(id);
    const dates = [...e.dates].sort();
    const lastApplied = dates.at(-1)!;
    const pesticidal = isPesticidal(c);
    const label = c?.phiDays ?? null;
    const required = pesticidal ? Math.max(label ?? 0, HARD_STOP_DAYS) : 0;
    if (!pesticidal)
      return { chemicalId: id, product: c?.product ?? id, category: c?.category ?? 'unknown', lastApplied, harvestRef: nextPick(lastApplied), daysBeforeHarvest: null, labelPhiDays: label, requiredDays: 0, verdict: 'NOT_APPLICABLE', note: 'Nutrient / cultural input: no pre-harvest interval.' };
    if (!pickRefs.length)
      return { chemicalId: id, product: c?.product ?? id, category: c?.category ?? 'unknown', lastApplied, harvestRef: null, daysBeforeHarvest: null, labelPhiDays: label, requiredDays: required, verdict: 'PENDING', note: 'No harvest recorded and no expected harvest date set.' };
    let worst: { verdict: PhiVerdict; days: number | null; ref: string | null; date: string } = { verdict: 'NOT_APPLICABLE', days: null, ref: null, date: lastApplied };
    for (const d of dates) {
      const ref = nextPick(d);
      if (!ref) continue; // applied after the last pick: post-harvest, cannot reach this season's fruit
      const days = daysBetween(d, ref);
      const v: PhiVerdict = days < required ? 'FAIL' : days < bundle.defactoPhiDays ? 'WARN' : 'PASS';
      if (rank[v] > rank[worst.verdict] || (v === worst.verdict && (worst.days == null || days < worst.days))) worst = { verdict: v, days, ref, date: d };
    }
    const note =
      worst.verdict === 'FAIL'
        ? `Applied ${worst.days} d before harvest; at least ${required} d required${label != null ? ` (label PHI ${label} d)` : ''}.`
        : worst.verdict === 'WARN'
          ? `Inside the ${bundle.defactoPhiDays}-day pre-harvest stop window recommended by the schedule.`
          : worst.verdict === 'PASS'
            ? `Interval meets label PHI and the ${bundle.defactoPhiDays}-day stop window.`
            : 'All applications were after the last recorded pick (post-harvest).';
    return { chemicalId: id, product: c?.product ?? id, category: c?.category ?? 'unknown', lastApplied: worst.date, harvestRef: worst.ref, daysBeforeHarvest: worst.days, labelPhiDays: label, requiredDays: required, verdict: worst.verdict, note };
  }).sort((a, b) => rank[b.verdict] - rank[a.verdict] || a.product.localeCompare(b.product));

  const preHarvest = harvest.date
    ? effective.filter((s) => s.sprayed_on <= harvest.date! && (s.products ?? []).some((p) => isPesticidal(chem.get(p.chemicalId))))
    : effective.filter((s) => (s.products ?? []).some((p) => isPesticidal(chem.get(p.chemicalId))));
  const lastSprayDate = preHarvest.at(-1)?.sprayed_on ?? null;

  const reasons: string[] = [];
  for (const s of effective)
    for (const v of s.violations ?? [])
      if (REGULATORY_CODES.has(v.code)) reasons.push(`${s.sprayed_on}: ${v.message ?? v.code}`);
  for (const p of phi) if (p.verdict === 'FAIL') reasons.push(`${p.product}: ${p.note}`);
  const warn = phi.filter((p) => p.verdict === 'WARN').map((p) => `${p.product}: ${p.note}`);
  const pending = phi.some((p) => p.verdict === 'PENDING');
  const verdict = reasons.length ? 'NON_COMPLIANT' : pending ? 'PENDING' : warn.length ? 'COMPLIANT_WITH_WARNINGS' : 'COMPLIANT';
  if (pending && !reasons.length) reasons.push('Harvest date unknown: set the expected harvest date or record the harvest to complete PHI checks.');
  if (!reasons.length) reasons.push(...warn);

  const rootstock = input.block.rootstock_id ? bundle.rootstocks.find((r) => r.id === input.block.rootstock_id)?.name ?? input.block.rootstock_id : null;
  return {
    season: input.season,
    generatedAt: input.generatedAt.toISOString(),
    tenantName: input.tenantName,
    orchard: input.orchard,
    block: { ...input.block, rootstock, systemLabel: SYSTEM_LABEL[input.block.system_type] ?? input.block.system_type },
    varieties: (input.block.variety_mix ?? []).map((m) => ({ name: bundle.varieties.find((v) => v.id === m.varietyId)?.name ?? m.varietyId, trees: m.trees ?? null })),
    schedule: { id: bundle.version.id, source: bundle.version.source, status: bundle.version.status },
    disclaimer: bundle.version.disclaimer,
    sprays,
    harvest,
    lastSprayDate,
    daysBeforeHarvest: lastSprayDate && harvest.date ? daysBetween(lastSprayDate, harvest.date) : null,
    phi,
    overall: { verdict, reasons },
  };
}

// ── Data access ─────────────────────────────────────────────────────────────────

export async function loadCertificateInput(tx: Tx, blockId: string, season: number, now: Date): Promise<CertificateInput | null> {
  const { rows: [b] } = await tx.query(
    `SELECT b.id, b.name, b.system_type, b.rootstock_id, b.training_system, b.planting_year, b.area_kanal, b.tree_count, b.variety_mix, b.scab_resistant,
            b.full_bloom_date, b.expected_harvest_date,
            o.name AS o_name, o.district, o.tehsil, o.village, o.khasra_no, o.lat, o.lng, o.elevation_m, o.area_kanal AS o_area
     FROM public.blocks b JOIN public.orchards o ON o.tenant_id = b.tenant_id AND o.id = b.orchard_id
     WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [blockId],
  );
  if (!b) return null;
  const { rows: [t] } = await tx.query('SELECT name FROM public.tenants');
  const { rows: sprays } = await tx.query(
    `SELECT s.id, s.sprayed_on, s.stage_id, s.products, s.tank_litres, s.total_litres, s.violations, s.override_reason, s.corrects_id, s.notes, u.name AS operator
     FROM public.spray_events s LEFT JOIN public.users u ON u.tenant_id = s.tenant_id AND u.id::text = s.operator_user_id
     WHERE s.block_id = $1 AND s.deleted_at IS NULL AND extract(year FROM s.sprayed_on) = $2
     ORDER BY s.sprayed_on, s.created_at`,
    [blockId, season],
  );
  const { rows: picks } = await tx.query(
    `SELECT h.picked_on FROM public.harvest_records h
     WHERE h.block_id = $1 AND h.deleted_at IS NULL AND extract(year FROM h.picked_on) = $2
       AND NOT EXISTS (SELECT 1 FROM public.harvest_records c WHERE c.corrects_id = h.id AND c.deleted_at IS NULL)
     ORDER BY h.picked_on`,
    [blockId, season],
  );
  return {
    season,
    generatedAt: now,
    tenantName: t?.name ?? '',
    orchard: { name: b.o_name, district: b.district, tehsil: b.tehsil, village: b.village, khasra_no: b.khasra_no, lat: b.lat, lng: b.lng, elevation_m: b.elevation_m, area_kanal: b.o_area },
    block: {
      id: b.id, name: b.name, system_type: b.system_type, rootstock_id: b.rootstock_id, training_system: b.training_system, planting_year: b.planting_year,
      area_kanal: b.area_kanal, tree_count: b.tree_count, variety_mix: Array.isArray(b.variety_mix) ? b.variety_mix : null, scab_resistant: b.scab_resistant,
      full_bloom_date: b.full_bloom_date, expected_harvest_date: b.expected_harvest_date,
    },
    sprays: sprays.map((s) => ({
      id: s.id, sprayed_on: s.sprayed_on, stage_id: s.stage_id, products: Array.isArray(s.products) ? s.products : [], tank_litres: s.tank_litres, total_litres: s.total_litres,
      operator: s.operator, violations: Array.isArray(s.violations) ? s.violations : [], override_reason: s.override_reason, corrects_id: s.corrects_id, notes: s.notes,
    })),
    pickDates: [...new Set(picks.map((p) => String(p.picked_on)))],
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────────

const REPLACE: Record<string, string> = { '≥': '>=', '≤': '<=', '₹': 'Rs ', '°': '°', '→': '->', '×': 'x', '≈': '~', '✓': 'OK', '✗': 'X', '⛔': '!', '⚠': '!' };
/** Standard PDF fonts are WinAnsi: map common symbols and drop anything unrepresentable. */
export function pdfSafe(s: unknown): string {
  return String(s ?? '')
    .replace(/[^\x20-\x7e -ÿ–—‘’“”•…]/g, (ch) => REPLACE[ch] ?? '?')
    .replace(/\s+/g, ' ')
    .trim();
}

const VERDICT_COLOR: Record<string, string> = { PASS: '#1b7f3b', COMPLIANT: '#1b7f3b', WARN: '#a86500', COMPLIANT_WITH_WARNINGS: '#a86500', FAIL: '#b3261e', NON_COMPLIANT: '#b3261e', PENDING: '#555555', NOT_APPLICABLE: '#555555' };
const VERDICT_TEXT: Record<string, string> = { COMPLIANT: 'COMPLIANT', COMPLIANT_WITH_WARNINGS: 'COMPLIANT WITH WARNINGS', NON_COMPLIANT: 'NON-COMPLIANT', PENDING: 'PENDING (harvest date unknown)', PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL', NOT_APPLICABLE: 'N/A' };

export const fmtDay = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export function renderCertificatePdf(m: CertificateModel): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 36, bottom: 40, left: 36, right: 36 },
    bufferPages: true,
    info: { Title: pdfSafe(`Spray certificate - ${m.block.name} - ${m.season}`), Author: 'Seb Orchard', Subject: 'Spray record and pre-harvest interval compliance', CreationDate: new Date(m.generatedAt) },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const L = doc.page.margins.left;
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const heading = (t: string) => {
    ensure(40);
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(11).fillColor('#222222').text(pdfSafe(t), L, doc.y, { width: W });
    doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).lineWidth(0.5).strokeColor('#999999').stroke();
    doc.moveDown(0.4);
  };
  const kv = (pairs: [string, unknown][], cols = 3) => {
    const cw = W / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const row = pairs.slice(i, i + cols);
      const h = Math.max(...row.map(([k, v]) => doc.font('Helvetica').fontSize(9).heightOfString(`${k}: ${pdfSafe(v) || '-'}`, { width: cw - 8 })));
      ensure(h + 2);
      const y = doc.y;
      row.forEach(([k, v], j) => {
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#444444').text(`${pdfSafe(k)}: `, L + j * cw, y, { width: cw - 8, continued: true });
        doc.font('Helvetica').fillColor('#111111').text(pdfSafe(v) || '-');
      });
      doc.x = L;
      doc.y = y + h + 2;
    }
  };

  interface Col { title: string; w: number }
  const table = (cols: Col[], rows: { cells: string[]; muted?: boolean; strike?: boolean; color?: (string | undefined)[] }[], fontSize = 7.5) => {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const widths = cols.map((c) => (c.w / total) * W);
    const pad = 3;
    const drawHead = () => {
      doc.font('Helvetica-Bold').fontSize(fontSize);
      const h = Math.max(...cols.map((c, i) => doc.heightOfString(pdfSafe(c.title), { width: widths[i]! - 2 * pad }))) + 2 * pad;
      ensure(h + 14);
      const y = doc.y;
      doc.rect(L, y, W, h).fill('#eeeeee');
      let x = L;
      cols.forEach((c, i) => {
        doc.fillColor('#222222').text(pdfSafe(c.title), x + pad, y + pad, { width: widths[i]! - 2 * pad });
        x += widths[i]!;
      });
      doc.y = y + h;
    };
    drawHead();
    for (const r of rows) {
      doc.font('Helvetica').fontSize(fontSize);
      const h = Math.max(...r.cells.map((c, i) => doc.heightOfString(pdfSafe(c) || ' ', { width: widths[i]! - 2 * pad }))) + 2 * pad;
      if (doc.y + h > bottom()) {
        doc.addPage();
        drawHead();
        doc.font('Helvetica').fontSize(fontSize);
      }
      const y = doc.y;
      let x = L;
      r.cells.forEach((c, i) => {
        doc.fillColor(r.color?.[i] ?? (r.muted ? '#888888' : '#111111')).text(pdfSafe(c), x + pad, y + pad, { width: widths[i]! - 2 * pad, strike: !!r.strike && i > 0 });
        x += widths[i]!;
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.25).strokeColor('#cccccc').stroke();
      doc.x = L;
      doc.y = y + h;
    }
  };

  // Title block.
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text('Spray Record & Pre-Harvest Interval Certificate', L, doc.y, { width: W });
  doc.font('Helvetica').fontSize(9).fillColor('#444444').text(pdfSafe(`${m.tenantName} · Season ${m.season} · Generated ${new Date(m.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`), { width: W });
  doc.moveDown(0.5);
  const v = m.overall.verdict;
  const boxY = doc.y;
  doc.font('Helvetica-Bold').fontSize(12);
  const reasonText = m.overall.reasons.slice(0, 6).map(pdfSafe).join('\n');
  const boxH = 22 + (reasonText ? doc.font('Helvetica').fontSize(8.5).heightOfString(reasonText, { width: W - 16 }) + 4 : 0);
  doc.rect(L, boxY, W, boxH).lineWidth(1).strokeColor(VERDICT_COLOR[v] ?? '#555555').stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(VERDICT_COLOR[v] ?? '#555555').text(`Overall: ${VERDICT_TEXT[v]}`, L + 8, boxY + 6, { width: W - 16 });
  if (reasonText) doc.font('Helvetica').fontSize(8.5).fillColor('#333333').text(reasonText, L + 8, doc.y + 2, { width: W - 16 });
  doc.x = L;
  doc.y = boxY + boxH + 4;

  heading('Orchard');
  const o = m.orchard;
  kv([
    ['Orchard', o.name], ['District', o.district], ['Tehsil / village', [o.tehsil, o.village].filter(Boolean).join(' / ')],
    ['Khasra no.', o.khasra_no], ['Location', o.lat != null && o.lng != null ? `${Number(o.lat).toFixed(5)}, ${Number(o.lng).toFixed(5)}` : ''], ['Elevation', o.elevation_m != null ? `${Math.round(o.elevation_m)} m` : ''],
  ]);
  heading('Block');
  const b = m.block;
  kv([
    ['Block', b.name], ['System', b.systemLabel], ['Rootstock', b.rootstock],
    ['Planting year', b.planting_year], ['Area', b.area_kanal != null ? `${fmtNum(b.area_kanal)} kanal` : ''], ['Trees', b.tree_count],
    ['Varieties', m.varieties.map((x) => (x.trees ? `${x.name} (${x.trees})` : x.name)).join(', ')], ['Full bloom', fmtDay(b.full_bloom_date)], ['Expected harvest', fmtDay(b.expected_harvest_date)],
  ]);
  heading('Harvest interval');
  kv([
    ['Harvest (first pick)', `${fmtDay(m.harvest.date)}${m.harvest.basis === 'expected' ? ' (expected)' : m.harvest.basis === 'recorded' ? ` (recorded, ${m.harvest.picks} pick${m.harvest.picks === 1 ? '' : 's'})` : ''}`],
    ['Last pesticide spray', fmtDay(m.lastSprayDate)],
    ['Days before harvest', m.daysBeforeHarvest != null ? `${m.daysBeforeHarvest} days` : '-'],
  ]);

  heading(`Spray record (${m.sprays.length} event${m.sprays.length === 1 ? '' : 's'})`);
  if (!m.sprays.length) doc.font('Helvetica').fontSize(9).fillColor('#444444').text('No sprays recorded for this block in this season.', L, doc.y, { width: W });
  else
    table(
      [{ title: 'Date', w: 7 }, { title: 'Stage', w: 9 }, { title: 'Product', w: 13 }, { title: 'Active ingredient(s)', w: 12 }, { title: 'FRAC / IRAC', w: 7 }, { title: 'Dose', w: 7.5 }, { title: 'Quantity', w: 6 }, { title: 'Batch', w: 7 }, { title: 'CIBRC reg. no.', w: 8 }, { title: 'Operator', w: 7.5 }, { title: 'Compliance / status', w: 12 }],
      m.sprays.flatMap((s) => {
        const status = [
          s.superseded ? `SUPERSEDED by ${s.supersededBy?.slice(0, 8)}` : '',
          s.corrects ? `Correction of ${s.corrects.slice(0, 8)}` : '',
          ...s.flags,
          s.overrideReason ? `Reason: ${s.overrideReason}` : '',
        ].filter(Boolean).join('; ');
        const lines = s.lines.length ? s.lines : [{ chemicalId: '', product: '(no products)', activeIngredients: '', groups: '', dose: '', quantity: '', batch: '', registrationNo: '' }];
        return lines.map((l, i) => ({
          cells: [i === 0 ? fmtDay(s.date) : '', i === 0 ? s.stage : '', l.product, l.activeIngredients, l.groups, l.dose, l.quantity, l.batch, l.registrationNo, i === 0 ? s.operator : '', i === 0 ? status || 'OK' : ''],
          muted: s.superseded,
          strike: s.superseded,
        }));
      }),
    );

  heading('Pre-harvest interval (PHI) by product');
  if (!m.phi.length) doc.font('Helvetica').fontSize(9).fillColor('#444444').text('No products applied.', L, doc.y, { width: W });
  else
    table(
      [{ title: 'Product', w: 14 }, { title: 'Applied (decisive)', w: 8 }, { title: 'Harvest ref.', w: 8 }, { title: 'Days before harvest', w: 7 }, { title: 'Label PHI', w: 6 }, { title: 'Required', w: 6 }, { title: 'Verdict', w: 6 }, { title: 'Note', w: 25 }],
      m.phi.map((p) => ({
        cells: [p.product, fmtDay(p.lastApplied), fmtDay(p.harvestRef), p.daysBeforeHarvest != null ? String(p.daysBeforeHarvest) : '-', p.labelPhiDays != null ? `${p.labelPhiDays} d` : '-', p.requiredDays ? `${p.requiredDays} d` : '-', VERDICT_TEXT[p.verdict] ?? p.verdict, p.note],
        color: [undefined, undefined, undefined, undefined, undefined, undefined, VERDICT_COLOR[p.verdict], undefined],
      })),
      8,
    );

  heading('Notes');
  doc.font('Helvetica').fontSize(8).fillColor('#333333');
  const notes = [
    `Required interval = the longer of the product's label PHI and the ${HARD_STOP_DAYS}-day hard stop; applications inside the schedule's recommended pre-harvest stop window are reported as WARN.`,
    'Records are append-only: a corrected spray is kept and shown struck through as SUPERSEDED; the linked correction is the record of fact.',
    'Batch and CIBRC registration numbers come from the inventory lots drawn down when the spray was recorded.',
    `Reference schedule: ${m.schedule.source} (${m.schedule.id}, ${m.schedule.status}).`,
  ];
  for (const n of notes) {
    ensure(14);
    doc.text(`• ${pdfSafe(n)}`, L, doc.y, { width: W });
  }
  heading('Disclaimer');
  ensure(30);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#333333').text(pdfSafe(`${m.disclaimer} This certificate is generated from records entered by the orchard operator; it is not a laboratory residue analysis. Verify against the current CIBRC label and SKUAST-K schedule before relying on it for export.`), L, doc.y, { width: W });

  // Footer on every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would otherwise trigger an automatic page break.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 28;
    doc.font('Helvetica').fontSize(7).fillColor('#777777').text(pdfSafe(`Seb Orchard · ${m.orchard.name} / ${m.block.name} · season ${m.season} · generated ${m.generatedAt} · page ${i - range.start + 1} of ${range.count}`), L, y, { width: W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = margin;
  }
  doc.end();
  return done;
}
