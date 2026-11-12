import { Model } from '@nozbe/watermelondb';
import { SYNC_TABLES } from '@orchard/domain';
import { decodeJson, encodeValue } from './codec';

/**
 * Generic synced record. Columns are read/written through the raw record so one class serves
 * every table in the shared SYNC_TABLES schema (no per-column decorators to keep in step).
 */
export class SyncModel extends Model {
  str(col: string): string | undefined {
    const v = this._getRaw(col);
    return v == null || v === '' ? undefined : String(v);
  }
  num(col: string): number | undefined {
    const v = this._getRaw(col);
    return typeof v === 'number' ? v : undefined;
  }
  bool(col: string): boolean {
    return this._getRaw(col) === true;
  }
  json<T>(col: string, fallback: T): T {
    return decodeJson<T>(this._getRaw(col), fallback);
  }
  /** Use only inside create()/update() builders. */
  setValues(values: Record<string, unknown>) {
    for (const [k, v] of Object.entries(values)) this._setRaw(k, encodeValue(this.table, k, v));
  }
  get createdAt(): number {
    return (this._getRaw('created_at') as number) ?? 0;
  }
}

/** One concrete Model subclass per synced table. */
export const modelClasses = SYNC_TABLES.map((t) => {
  const C = class extends SyncModel {};
  Object.defineProperty(C, 'name', { value: `M_${t.name}` });
  (C as unknown as { table: string }).table = t.name;
  return C;
});
