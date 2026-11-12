import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import type { Clause } from '@nozbe/watermelondb/QueryDescription';
import { setGenerator } from '@nozbe/watermelondb/utils/common/randomId';
import { database } from './index';
import { SyncModel } from './models';
import { uuidv4 } from '../lib/uuid';

// Server ids are UUIDs: make Watermelon generate UUIDs too.
setGenerator(() => uuidv4());

export type Row = SyncModel;

export const collection = (table: string) => database.get<SyncModel>(table);

export async function createRow(table: string, values: Record<string, unknown>): Promise<SyncModel> {
  return database.write(async () =>
    collection(table).create((r) => {
      const now = Date.now();
      r.setValues({ ...values, created_at: now, updated_at: now });
    }),
  );
}

export async function updateRow(row: SyncModel, values: Record<string, unknown>): Promise<SyncModel> {
  return database.write(async () => row.update((r) => r.setValues({ ...values, updated_at: Date.now() })));
}

/** Soft delete (synced as `deleted`). */
export async function deleteRow(row: SyncModel): Promise<void> {
  await database.write(async () => row.markAsDeleted());
}

/**
 * Correction for append-only records: never mutate synced history — create a new linked record.
 */
export async function createCorrection(table: string, original: SyncModel, values: Record<string, unknown>) {
  const raw = { ...(original._raw as unknown as Record<string, unknown>) };
  for (const k of ['id', '_status', '_changed', 'locked', 'created_at', 'updated_at']) delete raw[k];
  return createRow(table, { ...raw, ...values, corrects_id: original.id, locked: false });
}

export async function findRow(table: string, id: string): Promise<SyncModel | undefined> {
  try {
    return await collection(table).find(id);
  } catch {
    return undefined;
  }
}

/** Live query hook. */
export function useRows(table: string, clauses: Clause[] = [], deps: unknown[] = []): SyncModel[] {
  const [rows, setRows] = useState<SyncModel[]>([]);
  useEffect(() => {
    const sub = collection(table).query(...clauses).observeWithColumns(['updated_at']).subscribe(setRows);
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, ...deps]);
  return rows;
}

export function useRow(table: string, id?: string): SyncModel | undefined {
  const rows = useRows(table, id ? [Q.where('id', id)] : [Q.where('id', '__none__')], [id]);
  return rows[0];
}

export { Q };

import { decodeRow } from './codec';

/** Live query returning decoded plain rows alongside their models. */
export function useTable<T>(table: string, clauses: Clause[] = [], deps: unknown[] = []): { rows: (T & { id: string })[]; models: SyncModel[] } {
  const models = useRows(table, clauses, deps);
  return { models, rows: models.map((m) => decodeRow<T>(table, m._raw as unknown as Record<string, unknown>)) };
}
