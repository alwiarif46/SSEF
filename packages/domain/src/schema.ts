/**
 * Shared sync schema: the single source of truth for tenant-owned tables that sync between
 * the WatermelonDB client and Postgres. Column names are identical on both sides (snake_case).
 * `json` columns are JSONB in Postgres and JSON-encoded strings on the device.
 * Every table additionally has: id (client-generated UUID text), tenant_id (server-set),
 * created_at / updated_at (epoch ms on device), server_updated_at, deleted_at.
 */
export type ColType = 'string' | 'number' | 'boolean' | 'json';

export interface ColumnDef {
  name: string;
  type: ColType;
  optional?: boolean;
  indexed?: boolean;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  /** Server owns these rows; clients pull only (weather, alerts except ack fields). */
  pullOnly?: boolean;
  /** Columns a client may change on a pullOnly table. */
  clientWritable?: string[];
  /** Minimum role allowed to create / update / delete via sync. */
  roles: { create: Role; update: Role; delete: Role };
}

export type Role = 'owner' | 'manager' | 'worker';
export const ROLE_RANK: Record<Role, number> = { worker: 1, manager: 2, owner: 3 };
export const roleAtLeast = (r: Role, min: Role) => ROLE_RANK[r] >= ROLE_RANK[min];

const s = (name: string, optional = true, indexed = false): ColumnDef => ({ name, type: 'string', optional, indexed });
const n = (name: string, optional = true): ColumnDef => ({ name, type: 'number', optional });
const b = (name: string, optional = true): ColumnDef => ({ name, type: 'boolean', optional });
const j = (name: string, optional = true): ColumnDef => ({ name, type: 'json', optional });

const MGR = { create: 'manager', update: 'manager', delete: 'owner' } as const;
const FIELD = { create: 'worker', update: 'worker', delete: 'manager' } as const;

export const SYNC_TABLES: TableDef[] = [
  { name: 'orchards', roles: MGR, columns: [s('name', false), s('district'), s('tehsil'), s('village'), n('lat'), n('lng'), n('elevation_m'), n('area_kanal'), s('khasra_no'), s('notes')] },
  { name: 'blocks', roles: MGR, columns: [s('orchard_id', false, true), s('name', false), s('system_type', false), s('rootstock_id'), s('training_system'), n('planting_year'), n('area_kanal'), n('tree_count'), j('variety_mix'), b('scab_resistant'), s('full_bloom_date'), s('expected_harvest_date'), s('observed_stage_id'), b('drip'), b('hail_net'), b('trellis'), s('notes')] },
  { name: 'tree_rows', roles: MGR, columns: [s('block_id', false, true), n('row_no', false), n('trees'), s('variety_id'), n('trellis_wires'), s('notes')] },
  { name: 'spray_events', roles: FIELD, columns: [s('block_id', false, true), s('stage_id'), s('schedule_version_id'), s('sprayed_on', false), j('products', false), n('tank_litres'), n('total_litres'), n('tank_fills'), s('operator_user_id'), s('task_id'), j('weather_snapshot'), j('violations'), s('override_reason'), s('corrects_id'), b('locked'), s('notes')] },
  { name: 'nutrient_applications', roles: FIELD, columns: [s('block_id', false, true), s('applied_on', false), s('product', false), n('rate'), s('unit'), s('method'), s('stage_id'), s('corrects_id'), b('locked'), s('notes')] },
  { name: 'scouting_observations', roles: FIELD, columns: [s('block_id', false, true), s('observed_on', false), s('pest_id', false), s('metric'), n('value'), n('severity'), n('lat'), n('lng'), j('photos'), s('observer_user_id'), s('notes')] },
  { name: 'phenology_observations', roles: FIELD, columns: [s('block_id', false, true), s('observed_on', false), s('stage_id', false), s('corrects_id'), b('locked'), s('notes')] },
  { name: 'trap_catches', roles: FIELD, columns: [s('orchard_id', false, true), s('trap_code', false), s('caught_on', false), n('moths', false), n('sunset_temp_c'), s('corrects_id'), b('locked')] },
  { name: 'chemical_inventory', roles: { create: 'manager', update: 'worker', delete: 'owner' }, columns: [s('chemical_id', false, true), s('batch_no'), s('expiry_date'), n('quantity', false), s('unit', false), s('dealer'), s('dealer_licence_no'), s('invoice_no'), s('registration_no'), s('purchased_on'), n('cost_inr'), j('photos')] },
  { name: 'tasks', roles: { create: 'manager', update: 'worker', delete: 'manager' }, columns: [s('orchard_id', false, true), s('block_id'), s('title', false), s('kind', false), s('assignee_user_id', true, true), s('due_on'), s('status', false), s('alert_id'), j('plan'), s('completed_at'), s('completed_by'), s('notes')] },
  { name: 'harvest_records', roles: FIELD, columns: [s('block_id', false, true), s('variety_id'), s('picked_on', false), n('starch_index'), n('tss_brix'), n('firmness_lb'), n('red_colour_pct'), s('grade'), s('box_type'), n('box_count'), n('kg'), s('mandi'), n('price_per_box_inr'), s('buyer'), s('corrects_id'), b('locked'), s('notes')] },
  { name: 'expenses', roles: { create: 'manager', update: 'manager', delete: 'owner' }, columns: [s('orchard_id', false, true), s('spent_on', false), s('category', false), n('amount_inr', false), s('notes')] },
  { name: 'infection_alerts', pullOnly: true, clientWritable: ['acknowledged', 'acknowledged_by', 'acknowledged_at'], roles: { create: 'owner', update: 'worker', delete: 'owner' }, columns: [s('orchard_id', false, true), s('dedupe_key', false), s('type', false), s('severity', false), s('title', false), s('body'), s('window_start'), s('window_end'), s('recommended_action'), b('advisory'), b('acknowledged'), s('acknowledged_by'), s('acknowledged_at'), j('data')] },
  { name: 'weather_daily', pullOnly: true, roles: { create: 'owner', update: 'owner', delete: 'owner' }, columns: [s('orchard_id', false, true), s('day', false), n('min_c'), n('max_c'), n('mean_c'), n('precip_mm'), n('mean_rh'), b('is_forecast'), j('hourly')] },
];

export const SYNC_TABLE_NAMES = SYNC_TABLES.map((t) => t.name);
export const tableDef = (name: string) => SYNC_TABLES.find((t) => t.name === name);

/** Bump when SYNC_TABLES changes; the client sends it with every pull. */
export const SYNC_SCHEMA_VERSION = 1;
