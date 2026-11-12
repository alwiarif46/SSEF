import {
  SYNC_TABLES, TABLE_POLICIES, tableDef, mergeIncoming, roleAtLeast, validateSpray, type ColumnDef, type TableDef, type Row,
} from '@orchard/domain';
import type { ReferenceBundle } from '@orchard/reference';
import type { Tx } from '../db.js';
import type { Principal } from '../auth.js';

/** Re-send window so rows committed slightly out of clock order are never missed. */
export const PULL_OVERLAP_MS = 10_000;

export type WireRow = Record<string, unknown> & { id: string };
export interface TableChanges { created: WireRow[]; updated: WireRow[]; deleted: string[] }
export type Changes = Record<string, TableChanges>;

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};

function toWire(t: TableDef, r: Row): WireRow {
  const out: WireRow = { id: String(r.id) };
  for (const c of t.columns) {
    let v = r[c.name];
    if (v instanceof Date) v = v.toISOString();
    if (c.type === 'json' && v != null) v = JSON.stringify(v);
    out[c.name] = v ?? null;
  }
  return out;
}

export async function pull(tx: Tx, lastPulledAt: number): Promise<{ changes: Changes; timestamp: number }> {
  const now = Number((await tx.query<{ now: number }>('SELECT (extract(epoch from now()) * 1000)::bigint AS now')).rows[0]!.now);
  const since = lastPulledAt > 0 ? new Date(lastPulledAt - PULL_OVERLAP_MS) : null;
  const changes: Changes = {};
  for (const t of SYNC_TABLES) {
    const cols = ['id', ...t.columns.map((c) => c.name), 'deleted_at'].map(ident).join(', ');
    const { rows } = since
      ? await tx.query(`SELECT ${cols} FROM public.${ident(t.name)} WHERE server_updated_at > $1 ORDER BY server_updated_at`, [since])
      : await tx.query(`SELECT ${cols} FROM public.${ident(t.name)} WHERE deleted_at IS NULL ORDER BY server_updated_at`);
    const tc: TableChanges = { created: [], updated: [], deleted: [] };
    for (const r of rows) {
      if (r.deleted_at) tc.deleted.push(String(r.id));
      else if (since) tc.updated.push(toWire(t, r));
      else tc.created.push(toWire(t, r));
    }
    changes[t.name] = tc;
  }
  return { changes, timestamp: now };
}

export interface PushResult {
  ok: boolean;
  rejected: { table: string; id: string; reason: string }[];
  conflicts: { table: string; id: string; fields: string[] }[];
  flags: { table: string; id: string; violations: unknown[] }[];
}

class Reject extends Error {}

function coerce(c: ColumnDef, v: unknown): unknown {
  if (v === undefined || v === null || v === '') {
    if (!c.optional) throw new Reject(`${c.name} is required`);
    return null;
  }
  switch (c.type) {
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) throw new Reject(`${c.name} must be a number`);
      return n;
    }
    case 'boolean':
      return v === true || v === 1 || v === 'true';
    case 'json': {
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch { throw new Reject(`${c.name} must be JSON`); }
      }
      return v;
    }
    default: {
      const s = String(v);
      if (s.length > 10_000) throw new Reject(`${c.name} too long`);
      return s;
    }
  }
}

function sanitize(t: TableDef, raw: WireRow, only?: string[]): Row {
  const out: Row = {};
  for (const c of t.columns) {
    if (only && !only.includes(c.name)) continue;
    if (!(c.name in raw)) {
      if (!c.optional && !only) throw new Reject(`${c.name} is required`);
      continue;
    }
    out[c.name] = coerce(c, raw[c.name]);
  }
  return out;
}

const jsonParam = (t: TableDef, k: string, v: unknown) => (t.columns.find((c) => c.name === k)?.type === 'json' && v != null ? JSON.stringify(v) : v);

async function insertRow(tx: Tx, t: TableDef, id: string, row: Row, p: Principal) {
  const keys = Object.keys(row);
  const cols = ['id', 'tenant_id', 'created_by', ...keys].map(ident).join(', ');
  const vals = keys.map((_, i) => `$${i + 4}`).join(', ');
  await tx.query(`INSERT INTO public.${ident(t.name)} (${cols}) VALUES ($1, $2, $3${keys.length ? ', ' + vals : ''})`, [
    id, p.tenantId, p.userId, ...keys.map((k) => jsonParam(t, k, row[k])),
  ]);
}

async function updateRow(tx: Tx, t: TableDef, id: string, row: Row) {
  const keys = Object.keys(row).filter((k) => t.columns.some((c) => c.name === k));
  if (!keys.length) return;
  const set = keys.map((k, i) => `${ident(k)} = $${i + 2}`).join(', ');
  await tx.query(`UPDATE public.${ident(t.name)} SET ${set} WHERE id = $1`, [id, ...keys.map((k) => jsonParam(t, k, row[k]))]);
}

// ── Inventory deduction (traceability: which batch was sprayed) ───────────────
const MASS: Record<string, number> = { g: 1, kg: 1000 };
const VOL: Record<string, number> = { ml: 1, l: 1000, L: 1000 };
function convert(q: number, from: string, to: string): number | null {
  if (MASS[from] && MASS[to]) return (q * MASS[from]!) / MASS[to]!;
  if (VOL[from] && VOL[to]) return (q * VOL[from]!) / VOL[to]!;
  return from === to ? q : null;
}

interface ProductLine { chemicalId: string; quantity?: number; unit?: string; batches?: unknown[] }

async function deductInventory(tx: Tx, products: ProductLine[]) {
  for (const p of products) {
    if (!p.chemicalId || !(Number(p.quantity) > 0) || !p.unit) continue;
    let need = Number(p.quantity);
    const used: { inventoryId: string; batchNo: string | null; registrationNo: string | null; used: number; unit: string }[] = [];
    const { rows } = await tx.query(
      `SELECT id, batch_no, registration_no, quantity, unit FROM public.chemical_inventory
       WHERE chemical_id = $1 AND deleted_at IS NULL AND quantity > 0 ORDER BY expiry_date NULLS LAST, purchased_on NULLS LAST FOR UPDATE`,
      [p.chemicalId],
    );
    for (const inv of rows) {
      if (need <= 0) break;
      const avail = convert(Number(inv.quantity), inv.unit, p.unit);
      if (avail == null || avail <= 0) continue;
      const take = Math.min(avail, need);
      const remaining = convert(avail - take, p.unit, inv.unit)!;
      await tx.query('UPDATE public.chemical_inventory SET quantity = $2 WHERE id = $1', [inv.id, Math.max(0, Math.round(remaining * 1000) / 1000)]);
      used.push({ inventoryId: inv.id, batchNo: inv.batch_no, registrationNo: inv.registration_no, used: Math.round(take * 1000) / 1000, unit: p.unit });
      need -= take;
    }
    if (used.length) p.batches = used;
  }
}

/** Server-side compliance re-check for recorded sprays (facts are recorded; violations are flagged). */
async function recheckSpray(tx: Tx, row: Row, bundle: ReferenceBundle | undefined) {
  if (!bundle) return [];
  const products = (row.products as ProductLine[] | null) ?? [];
  const { rows: hist } = await tx.query(
    `SELECT sprayed_on, products FROM public.spray_events WHERE block_id = $1 AND deleted_at IS NULL AND sprayed_on < $2`,
    [row.block_id, row.sprayed_on],
  );
  const { rows: blk } = await tx.query('SELECT expected_harvest_date FROM public.blocks WHERE id = $1', [row.block_id]);
  return validateSpray(
    {
      date: String(row.sprayed_on),
      chemicalIds: products.map((p) => p.chemicalId),
      ...(row.stage_id ? { stageId: String(row.stage_id) } : {}),
      ...(blk[0]?.expected_harvest_date ? { plannedHarvestDate: blk[0].expected_harvest_date } : {}),
    },
    hist.map((h) => ({ date: h.sprayed_on, chemicalIds: ((h.products as ProductLine[]) ?? []).map((p) => p.chemicalId) })),
    bundle,
  );
}

export async function push(tx: Tx, p: Principal, changes: Changes, lastPulledAt: number, bundle?: ReferenceBundle): Promise<PushResult> {
  const res: PushResult = { ok: true, rejected: [], conflicts: [], flags: [] };
  const since = new Date(lastPulledAt || 0);
  // Parents before children so composite FKs resolve within one push.
  const order = SYNC_TABLES.map((t) => t.name);
  const tables = Object.keys(changes ?? {}).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const name of tables) {
    const t = tableDef(name);
    const tc = changes[name]!;
    if (!t) {
      for (const r of [...(tc.created ?? []), ...(tc.updated ?? [])]) res.rejected.push({ table: name, id: String(r?.id), reason: 'unknown table' });
      continue;
    }
    const policy = TABLE_POLICIES[name] ?? 'lww';
    const writes = [...(tc.created ?? []).map((r) => ({ r, isCreate: true })), ...(tc.updated ?? []).map((r) => ({ r, isCreate: false }))];
    for (const { r, isCreate } of writes) {
      const id = String(r?.id ?? '');
      await tx.query('SAVEPOINT row_sp');
      try {
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new Reject('invalid id');
        const { rows: [existing] } = await tx.query(`SELECT * FROM public.${ident(name)} WHERE id = $1 FOR UPDATE`, [id]);
        if (t.pullOnly) {
          if (!existing) throw new Reject('server-owned table');
          if (!roleAtLeast(p.role, t.roles.update)) throw new Reject('role not allowed');
          const patch = sanitize(t, r, t.clientWritable ?? []);
          if (Object.keys(patch).length) await updateRow(tx, t, id, patch);
          await tx.query('RELEASE SAVEPOINT row_sp');
          continue;
        }
        const need = existing ? t.roles.update : t.roles.create;
        if (!roleAtLeast(p.role, need)) throw new Reject(`role ${p.role} cannot ${existing ? 'update' : 'create'} ${name}`);
        const changed = typeof r._changed === 'string' && r._changed ? r._changed.split(',') : undefined;
        const incoming = sanitize(t, r, existing && changed ? changed : undefined);
        const serverChanged = !!existing && new Date(existing.server_updated_at) > since;
        const m = mergeIncoming(policy, existing, incoming, existing ? changed : undefined, serverChanged);
        if (m.action === 'reject') throw new Reject(m.reason ?? 'rejected');
        if (m.conflicts.length) res.conflicts.push({ table: name, id, fields: m.conflicts });
        if (m.action === 'insert') {
          const row = { ...m.row! };
          if (policy === 'append_only' && t.columns.some((c) => c.name === 'locked')) row.locked = true;
          if (name === 'spray_events') {
            const products = (row.products as ProductLine[]) ?? [];
            if (!Array.isArray(products) || !products.length) throw new Reject('products required');
            const v = await recheckSpray(tx, row, bundle);
            row.violations = v;
            if (v.some((x) => x.severity === 'block')) res.flags.push({ table: name, id, violations: v });
            await deductInventory(tx, products);
            row.products = products;
          }
          await insertRow(tx, t, id, row, p);
        } else if (m.action === 'update') {
          const patch: Row = {};
          for (const k of Object.keys(incoming)) patch[k] = m.row![k];
          await updateRow(tx, t, id, patch);
        }
        void isCreate;
        await tx.query('RELEASE SAVEPOINT row_sp');
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT row_sp');
        const reason = e instanceof Reject ? e.message : (e as { code?: string; message?: string }).code === '23503' ? 'parent record not found' : (e as Error).message;
        res.rejected.push({ table: name, id, reason });
      }
    }
    for (const id of tc.deleted ?? []) {
      await tx.query('SAVEPOINT row_sp');
      try {
        if (t.pullOnly) throw new Reject('server-owned table');
        if (!roleAtLeast(p.role, t.roles.delete)) throw new Reject(`role ${p.role} cannot delete ${name}`);
        const hasLock = t.columns.some((c) => c.name === 'locked');
        const { rows: [ex] } = await tx.query(`SELECT ${hasLock ? 'locked' : 'false AS locked'} FROM public.${ident(name)} WHERE id = $1`, [id]);
        if (ex?.locked) throw new Reject('locked records cannot be deleted; create a correction');
        await tx.query(`UPDATE public.${ident(name)} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
        await tx.query('RELEASE SAVEPOINT row_sp');
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT row_sp');
        res.rejected.push({ table: name, id, reason: (e as Error).message });
      }
    }
  }
  res.ok = res.rejected.length === 0;
  return res;
}
