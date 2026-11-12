/** Pure value codec between app values and device raw columns (json ↔ string). */
import { COLUMN_TYPES } from './schemaDef';

export type Values = Record<string, unknown>;

export function encodeValue(table: string, col: string, v: unknown): string | number | boolean | null {
  const type = COLUMN_TYPES[table]?.[col];
  if (v === undefined || v === null) return null;
  if (type === 'json') return typeof v === 'string' ? v : JSON.stringify(v);
  if (type === 'number' || col === 'created_at' || col === 'updated_at') {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') return Boolean(v);
  return String(v);
}

export function decodeJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  if (typeof raw !== 'string') return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Encode a values object for a table, dropping unknown columns. */
export function encodeRow(table: string, values: Values): Values {
  const cols = COLUMN_TYPES[table];
  if (!cols) throw new Error(`unknown table ${table}`);
  const out: Values = {};
  for (const [k, v] of Object.entries(values)) {
    if (k in cols || k === 'created_at' || k === 'updated_at') out[k] = encodeValue(table, k, v);
  }
  return out;
}

/** Decode a device raw record into plain values (json columns parsed). */
export function decodeRow<T = Values>(table: string, raw: Values): T & { id: string } {
  const cols = COLUMN_TYPES[table] ?? {};
  const out: Values = { id: raw.id };
  for (const [k, t] of Object.entries(cols)) {
    const v = raw[k];
    out[k] = t === 'json' ? decodeJson(v, null) : v === '' ? null : v;
  }
  out.created_at = raw.created_at;
  out.updated_at = raw.updated_at;
  return out as T & { id: string };
}
