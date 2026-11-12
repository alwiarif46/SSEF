/**
 * Pure (RN-free) translation of the shared SYNC_TABLES into WatermelonDB table specs.
 * JSON columns become strings on device; every table also gets created_at / updated_at (epoch ms).
 */
import { SYNC_TABLES, type ColType, type TableDef } from '@orchard/domain';

export type WmType = 'string' | 'number' | 'boolean';

export interface WmColumn {
  name: string;
  type: WmType;
  isOptional?: boolean;
  isIndexed?: boolean;
}

export interface WmTable {
  name: string;
  columns: WmColumn[];
}

export const toWmType = (t: ColType): WmType => (t === 'json' ? 'string' : t);

export function buildTableSpecs(tables: TableDef[] = SYNC_TABLES): WmTable[] {
  return tables.map((t) => ({
    name: t.name,
    columns: [
      ...t.columns.map((c) => ({
        name: c.name,
        type: toWmType(c.type),
        ...(c.optional !== false ? { isOptional: true } : {}),
        ...(c.indexed ? { isIndexed: true } : {}),
      })),
      { name: 'created_at', type: 'number' as const },
      { name: 'updated_at', type: 'number' as const },
    ],
  }));
}

/** Column metadata lookup: table → column → type. */
export const COLUMN_TYPES: Record<string, Record<string, ColType>> = Object.fromEntries(
  SYNC_TABLES.map((t) => [t.name, Object.fromEntries(t.columns.map((c) => [c.name, c.type]))]),
);
