/** Plain decoded row shapes (subset of SYNC_TABLES columns the UI uses). */
export interface ProductLine { chemicalId: string; dosePer100L: number; unit: string; quantity: number; recommendationId?: string }
export interface OrchardRow { id: string; name: string; district?: string; village?: string; lat?: number; lng?: number; elevation_m?: number; area_kanal?: number; notes?: string }
export interface VarietyShare { varietyId: string; trees: number }
export interface BlockRow {
  id: string; orchard_id: string; name: string; system_type: 'traditional' | 'hdp' | 'medium_density'; rootstock_id?: string; training_system?: string;
  planting_year?: number; area_kanal?: number; tree_count?: number; variety_mix?: VarietyShare[] | null; scab_resistant?: boolean;
  full_bloom_date?: string; expected_harvest_date?: string; observed_stage_id?: string; drip?: boolean; hail_net?: boolean; trellis?: boolean;
}
export interface SprayEventRow { id: string; block_id: string; stage_id?: string; sprayed_on: string; products: ProductLine[] | null; tank_litres?: number; total_litres?: number; violations?: unknown; override_reason?: string; corrects_id?: string; locked?: boolean; notes?: string }
export interface ScoutRow { id: string; block_id: string; observed_on: string; pest_id: string; metric?: string; value?: number; severity?: number; lat?: number; lng?: number; photos?: string[] | null; notes?: string }
export interface WeatherDailyRow { id: string; orchard_id: string; day: string; min_c?: number; max_c?: number; mean_c?: number; precip_mm?: number; mean_rh?: number; is_forecast?: boolean; hourly?: unknown[] | null }
export interface AlertRow { id: string; orchard_id: string; type: string; severity: string; title: string; body?: string; window_start?: string; window_end?: string; recommended_action?: string; advisory?: boolean; acknowledged?: boolean }
export interface InventoryRow { id: string; chemical_id: string; batch_no?: string; expiry_date?: string; quantity: number; unit: string; dealer?: string; dealer_licence_no?: string; invoice_no?: string; registration_no?: string; purchased_on?: string; cost_inr?: number }
export interface TaskRow { id: string; orchard_id: string; block_id?: string; title: string; kind: string; assignee_user_id?: string; due_on?: string; status: string; completed_at?: string; notes?: string }
export interface HarvestRow { id: string; block_id: string; variety_id?: string; picked_on: string; grade?: string; box_type?: string; box_count?: number; kg?: number; mandi?: string; price_per_box_inr?: number }
