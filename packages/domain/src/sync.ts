/**
 * Conflict resolution shared by server and client.
 *  - lww:          scalar last-write-wins by server-received timestamp.
 *  - field_merge:  only fields the device changed are applied; array fields are unioned
 *                  (e.g. one device adds a photo while another edits severity).
 *  - append_only:  once synced (`locked`), the record is immutable; corrections are new
 *                  records linked via `corrects_id`.
 */
export type ConflictPolicy = 'lww' | 'field_merge' | 'append_only';

export const TABLE_POLICIES: Record<string, ConflictPolicy> = {
  orchards: 'lww',
  blocks: 'lww',
  tree_rows: 'lww',
  spray_events: 'append_only',
  harvest_records: 'append_only',
  nutrient_applications: 'append_only',
  scouting_observations: 'field_merge',
  chemical_inventory: 'field_merge',
  inventory_movements: 'append_only',
  tasks: 'field_merge',
  phenology_observations: 'append_only',
  trap_catches: 'append_only',
  expenses: 'field_merge',
  infection_alerts: 'field_merge',
};

/** Columns the client may never write. */
export const SERVER_OWNED = new Set(['id', 'tenant_id', 'created_at', 'server_updated_at', 'locked', 'deleted_at', 'created_by']);

export type Row = Record<string, unknown>;

export interface MergeResult {
  action: 'insert' | 'update' | 'reject' | 'noop';
  row?: Row;
  reason?: string;
  conflicts: string[];
}

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

function unionArrays(a: unknown[], b: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const x of [...a, ...b]) {
    const k = typeof x === 'object' ? JSON.stringify(x) : String(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

/**
 * Merge an incoming device write into the server row.
 * @param server   current server row (undefined → insert)
 * @param incoming row from the device (snake_case columns)
 * @param changed  columns the device changed since its last pull (Watermelon `_changed`)
 * @param serverChangedSinceLastPull whether the server row was modified after the device's lastPulledAt
 */
export function mergeIncoming(
  policy: ConflictPolicy,
  server: Row | undefined,
  incoming: Row,
  changed: string[] | undefined,
  serverChangedSinceLastPull: boolean,
): MergeResult {
  const clean = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !SERVER_OWNED.has(k) && !k.startsWith('_')));
  if (!server) return { action: 'insert', row: clean(incoming), conflicts: [] };

  if (policy === 'append_only') {
    if (server.locked) return { action: 'reject', reason: 'Record is immutable once synced; create a linked correction instead.', conflicts: [] };
    // Unlocked (never confirmed) — treat as LWW.
  }

  const fields = (changed && changed.length ? changed : Object.keys(incoming)).filter((k) => !SERVER_OWNED.has(k) && !k.startsWith('_'));
  const conflicts: string[] = [];
  const patch: Row = {};
  for (const f of fields) {
    const inV = incoming[f];
    const svV = server[f];
    if (JSON.stringify(inV) === JSON.stringify(svV)) continue;
    if (policy === 'field_merge' && isArr(inV) && isArr(svV)) {
      patch[f] = unionArrays(svV, inV);
      continue;
    }
    if (serverChangedSinceLastPull) conflicts.push(f);
    patch[f] = inV; // last write (this push) wins
  }
  if (!Object.keys(patch).length) return { action: 'noop', conflicts };
  return { action: 'update', row: { ...clean(server), ...patch }, conflicts };
}
