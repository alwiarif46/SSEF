import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SYNC_TABLES, tableDef } from '@orchard/domain';
import { BUNDLE_2026, type ReferenceBundle } from '@orchard/reference';
import { api, pullChanges, pushChanges, type PushResponse, type WireRow } from './api';

/** Decoded row: json columns parsed, everything else as on the wire. */
export type Row = Record<string, any> & { id: string };
export type Tables = Record<string, Row[]>;

const decode = (table: string, r: WireRow): Row => {
  const t = tableDef(table);
  const out: Row = { ...r };
  for (const c of t?.columns ?? [])
    if (c.type === 'json' && typeof out[c.name] === 'string') {
      try { out[c.name] = JSON.parse(out[c.name]); } catch { /* keep raw */ }
    }
  return out;
};

const encode = (table: string, r: Row): WireRow => {
  const t = tableDef(table);
  const out: WireRow = { id: r.id };
  for (const c of t?.columns ?? []) {
    if (!(c.name in r)) continue;
    const v = r[c.name];
    out[c.name] = c.type === 'json' && v != null && typeof v !== 'string' ? JSON.stringify(v) : v === '' ? null : v;
  }
  return out;
};

export class SaveError extends Error {
  constructor(message: string, public result: PushResponse) { super(message); }
}

interface DataCtx {
  tables: Tables;
  loading: boolean;
  lastSync: number;
  error: string | null;
  refresh(): Promise<void>;
  /** Create or update (changed fields only for updates). Throws SaveError on rejection. */
  save(table: string, row: Row, opts?: { isNew?: boolean }): Promise<PushResponse>;
  remove(table: string, id: string): Promise<void>;
  ref: ReferenceBundle;
  refStatus: string;
}

const Ctx = createContext<DataCtx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [tables, setTables] = useState<Tables>(() => Object.fromEntries(SYNC_TABLES.map((t) => [t.name, []])));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState<ReferenceBundle>(BUNDLE_2026);
  const [refStatus, setRefStatus] = useState<string>(BUNDLE_2026.version.status);
  const since = useRef(0);
  const [lastSync, setLastSync] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await pullChanges(since.current);
      setTables((prev) => {
        const next: Tables = { ...prev };
        for (const [name, ch] of Object.entries(r.changes)) {
          const map = new Map((since.current ? prev[name] ?? [] : []).map((x) => [x.id, x]));
          for (const row of [...ch.created, ...ch.updated]) map.set(row.id, decode(name, row));
          for (const id of ch.deleted) map.delete(id);
          next[name] = [...map.values()];
        }
        return next;
      });
      since.current = r.timestamp;
      setLastSync(r.timestamp);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    api<ReferenceBundle>('/v1/reference/current')
      .then((b) => { setRef(b); setRefStatus(b.version.status); })
      .catch(() => { /* keep bundled fallback */ });
    const t = setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const save = useCallback(async (table: string, row: Row, opts: { isNew?: boolean } = {}) => {
    const existing = tables[table]?.find((x) => x.id === row.id);
    const isNew = opts.isNew ?? !existing;
    const wire = encode(table, row);
    if (!isNew) {
      const changed = Object.keys(wire).filter((k) => k !== 'id' && JSON.stringify(row[k]) !== JSON.stringify(existing?.[k]));
      (wire as Record<string, unknown>)._changed = changed.join(',');
    }
    const res = await pushChanges({ [table]: { created: isNew ? [wire] : [], updated: isNew ? [] : [wire], deleted: [] } }, since.current);
    if (res.rejected.length) throw new SaveError(res.rejected.map((r) => r.reason).join('; '), res);
    await refresh();
    return res;
  }, [tables, refresh]);

  const remove = useCallback(async (table: string, id: string) => {
    const res = await pushChanges({ [table]: { created: [], updated: [], deleted: [id] } }, since.current);
    if (res.rejected.length) throw new SaveError(res.rejected.map((r) => r.reason).join('; '), res);
    await refresh();
  }, [refresh]);

  const value = useMemo(() => ({ tables, loading, lastSync, error, refresh, save, remove, ref, refStatus }), [tables, loading, lastSync, error, refresh, save, remove, ref, refStatus]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useData outside DataProvider');
  return c;
}

/** Live (non-deleted) rows of a table, optionally filtered. */
export function useRows(table: string, filter?: (r: Row) => boolean): Row[] {
  const { tables } = useData();
  return useMemo(() => (tables[table] ?? []).filter((r) => (filter ? filter(r) : true)), [tables, table, filter]);
}

export const newId = () => crypto.randomUUID();
export const today = () => {
  const d = new Date(Date.now() + 5.5 * 3_600_000);
  return d.toISOString().slice(0, 10);
};
