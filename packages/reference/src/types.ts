/**
 * Global reference data contracts. Server-owned, season-versioned, read-only to tenants.
 * Every content record carries a provenance so the UI can mark SKUAST-K primary content
 * apart from supplementary content (non-negotiable product rule 1.3).
 */

export type Provenance =
  | 'SKUAST-K' // primary: Sher-e-Kashmir Univ. of Agri. Sciences & Tech., Kashmir schedule
  | 'JK-HORTICULTURE' // primary: J&K Department of Horticulture
  | 'CIBRC' // regulatory: Central Insecticides Board & Registration Committee
  | 'SUPPLEMENTARY'; // anything else (extension literature, research); flagged in UI

export type ScheduleStatus = 'draft' | 'under_review' | 'published' | 'superseded';

export interface SprayScheduleVersion {
  id: string; // e.g. "skuastk-2026"
  season: number; // 2026
  source: string; // human readable edition name
  sourceUrl?: string;
  effectiveFrom: string; // ISO date
  effectiveTo: string; // ISO date
  status: ScheduleStatus;
  /** Set when an agronomist has checked every entry against the printed edition. */
  verifiedBy?: string;
  verifiedAt?: string;
  disclaimer: string;
}

export type Category =
  | 'fungicide'
  | 'insecticide'
  | 'miticide'
  | 'oil'
  | 'nutrient'
  | 'bactericide'
  | 'growth_regulator'
  | 'cultural';

export type SystemType = 'traditional' | 'hdp' | 'both';

export interface SprayStage {
  id: string; // "s01-dormant"
  scheduleVersionId: string;
  order: number; // 1..13
  name: string;
  /** Kashmir valley (1,500–2,000 m) approximate window, MM-DD. Shifts ±10 days by elevation. */
  windowStart: string;
  windowEnd: string;
  phenology: string; // botanical description of the stage to identify it in the field
  timingGuidance: string;
  /** Minimum days since previous spray before this stage is due (interval rule). */
  minIntervalDays?: number;
  maxIntervalDays?: number;
  culturalPractices: string[];
  /** True for stages where no insecticide may be applied (bloom: pollinator protection). */
  pollinatorSensitive?: boolean;
  provenance: Provenance;
}

export interface ProductOption {
  chemicalId: string;
  /** Official dose per 100 L water. Exactly one unit applies. */
  dosePer100L: number;
  doseUnit: 'g' | 'ml' | 'kg' | 'l';
  /** Optional per-tree / per-kanal guidance when the schedule gives one. */
  notes?: string;
}

export interface StageRecommendation {
  id: string;
  stageId: string;
  target: string[]; // pest/disease ids
  category: Category;
  /** Any ONE of these products satisfies the recommendation. */
  options: ProductOption[];
  needBased: boolean;
  systemType: SystemType;
  /** Omit for scab-resistant low-spray programme. */
  skipForScabResistant?: boolean;
  notes?: string;
  provenance: Provenance;
}

export type RegulatoryStatus = 'registered' | 'banned' | 'restricted' | 'watch';

export interface Chemical {
  id: string; // slug "captan-50wp"
  product: string; // display "Captan 50 WP"
  activeIngredients: string[]; // ["captan"]
  /** Molecule key used by the no-repeat rule. Mixtures list each a.i. */
  moleculeKeys: string[];
  formulation: string; // WP, WG, SC, EC, SL, OD …
  category: Category;
  fracGroup?: string; // "M04", "3", "11"
  iracGroup?: string; // "1B", "4A", "28"
  /** Mode-of-action risk class: protectant/multisite is low-risk for resistance. */
  resistanceRisk: 'low' | 'medium' | 'high';
  cibrcRegistered: boolean;
  appleLabelClaim: boolean;
  status: RegulatoryStatus;
  statusNote?: string;
  statusReference?: string; // gazette notification
  /** Label pre-harvest interval, days. App enforces max(label PHI, schedule de-facto PHI). */
  phiDays?: number;
  beeToxicity?: 'high' | 'moderate' | 'low';
  rainFastHours?: number;
  provenance: Provenance;
}

export interface Pest {
  id: string;
  name: string;
  localName?: string;
  kind: 'disease' | 'insect' | 'mite' | 'disorder';
  scoutingMetric?: string; // "mites per leaf"
  /** Economic / action threshold; alert when scouting exceeds. */
  actionThreshold?: number;
  thresholdUnit?: string;
  thresholdNote?: string;
  favourableWeather?: string;
  provenance: Provenance;
}

export interface Variety {
  id: string;
  name: string;
  group: 'traditional' | 'hdp_exotic' | 'skuast_release' | 'pollinizer' | 'crab';
  scabResistant: boolean;
  resistanceGene?: string;
  hdpSuitable: boolean;
  pollinizerRole: 'main' | 'pollinizer' | 'both';
  chillingHours?: string;
  harvestWindow?: string; // "MM-DD..MM-DD"
  /** Days from full bloom to commercial harvest. */
  dafbMin?: number;
  dafbMax?: number;
  maturity?: {
    firmnessLbMin?: number;
    firmnessLbMax?: number;
    tssBrixMin?: number;
    starchIndexMin?: number; // Cornell 1–8 scale
    starchIndexMax?: number;
  };
  notes?: string;
  provenance: Provenance;
}

export interface Rootstock {
  id: string;
  name: string;
  vigor: 'dwarf' | 'semi_dwarf' | 'semi_vigorous' | 'vigorous';
  /** Plant x row spacing in metres. */
  spacingM?: [number, number];
  treesPerKanal?: number;
  needsSupport: boolean;
  resistances: string[];
  cautions: string[];
  provenance: Provenance;
}

export interface SafetyItem {
  id: string;
  kind: 'do' | 'dont';
  text: string;
  provenance: Provenance;
}

export interface CriticalTemp {
  stage: string;
  /** °C causing ~10% / ~90% bud kill (WSU tables). */
  kill10C: number;
  kill90C: number;
}

export interface ReferenceBundle {
  version: SprayScheduleVersion;
  stages: SprayStage[];
  recommendations: StageRecommendation[];
  chemicals: Chemical[];
  pests: Pest[];
  varieties: Variety[];
  rootstocks: Rootstock[];
  safety: SafetyItem[];
  criticalTemps: CriticalTemp[];
  /** Hard rule: no spray within this many days of planned harvest. */
  defactoPhiDays: number;
}
