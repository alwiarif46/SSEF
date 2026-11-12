/** Pure helpers for the sync wire format (docs/api.md). No React Native imports. */
import { SYNC_TABLES, SYNC_SCHEMA_VERSION, TABLE_POLICIES } from '@orchard/domain';
import { COLUMN_TYPES } from '../db/schemaDef';

export type Raw = Record<string, unknown>;
export interface TableChanges { created: Raw[]; updated: Raw[]; deleted: string[] }
export type Changes = Record<string, TableChanges>;

export interface PushResponse {
  ok: boolean;
  rejected?: { table: string; id: string; reason: string }[];
  conflicts?: { table: string; id: string; fields: string[] }[];
}

export const APPEND_ONLY_TABLES = Object.entries(TABLE_POLICIES).filter(([, p]) => p === 'append_only').map(([t]) => t);

export function pullUrl(base: string, lastPulledAt?: number | null): string {
  return `${base.replace(/\/$/, '')}/v1/sync?last_pulled_at=${lastPulledAt ?? 0}&schema_version=${SYNC_SCHEMA_VERSION}`;
}

export function pushUrl(base: string, lastPulledAt: number): string {
  return `${base.replace(/\/$/, '')}/v1/sync?last_pulled_at=${lastPulledAt}`;
}

/** Coerce a server row into device raw form: json → string, unknown columns dropped. */
export function normalizeRow(table: string, row: Raw): Raw {
  const cols = COLUMN_TYPES[table] ?? {};
  const out: Raw = { id: String(row.id) };
  for (const [k, t] of Object.entries(cols)) {
    const v = row[k];
    if (v === undefined) continue;
    if (v === null) out[k] = null;
    else if (t === 'json') out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    else if (t === 'number') out[k] = typeof v === 'number' ? v : Number(v);
    else if (t === 'boolean') out[k] = v === true || v === 'true' || v === 1;
    else out[k] = String(v);
  }
  for (const k of ['created_at', 'updated_at']) {
    const v = row[k];
    if (typeof v === 'number') out[k] = v;
    else if (typeof v === 'string') out[k] = Date.parse(v) || 0;
  }
  return out;
}

export function normalizePulled(changes: Record<string, Partial<TableChanges>> | undefined): Changes {
  const out: Changes = {};
  for (const t of SYNC_TABLES) {
    const c = changes?.[t.name];
    out[t.name] = {
      created: (c?.created ?? []).map((r) => normalizeRow(t.name, r)),
      updated: (c?.updated ?? []).map((r) => normalizeRow(t.name, r)),
      deleted: (c?.deleted ?? []).map(String),
    };
  }
  return out;
}

/**
 * Filter local changes before push: pull-only tables are dropped, except updates that touch only
 * the table's clientWritable columns (e.g. alert acknowledgement).
 */
export function preparePush(changes: Changes): Changes {
  const out: Changes = {};
  for (const [table, c] of Object.entries(changes)) {
    const def = SYNC_TABLES.find((t) => t.name === table);
    if (!def) continue;
    if (!def.pullOnly) {
      if (c.created.length || c.updated.length || c.deleted.length) out[table] = c;
      continue;
    }
    const allowed = new Set(def.clientWritable ?? []);
    const updated = c.updated
      .map((r) => {
        const changed = String(r._changed ?? '').split(',').filter((x) => allowed.has(x));
        if (!changed.length) return null;
        const slim: Raw = { id: r.id, _status: r._status, _changed: changed.join(',') };
        for (const f of changed) slim[f] = r[f];
        return slim;
      })
      .filter((r): r is Raw => r !== null);
    if (updated.length) out[table] = { created: [], updated, deleted: [] };
  }
  return out;
}

export function toRejectedIds(res: PushResponse | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of res?.rejected ?? []) (out[r.table] ??= []).push(r.id);
  return out;
}

/** Ids of append-only rows that the server accepted in this push (to mark locked locally). */
export function acceptedAppendOnly(pushed: Changes, res: PushResponse | undefined): Record<string, string[]> {
  const rejected = toRejectedIds(res);
  const out: Record<string, string[]> = {};
  for (const t of APPEND_ONLY_TABLES) {
    const c = pushed[t];
    if (!c) continue;
    const ids = [...c.created, ...c.updated].map((r) => String(r.id)).filter((id) => !(rejected[t] ?? []).includes(id));
    if (ids.length) out[t] = ids;
  }
  return out;
}

export function countChanges(c: Changes): number {
  return Object.values(c).reduce((s, t) => s + t.created.length + t.updated.length + t.deleted.length, 0);
}
