import type { CriticalTemp, Pest, Rootstock, SafetyItem, Variety } from './types.js';
import { M2 } from './units.js';

export const PESTS: Pest[] = [
  { id: 'apple-scab', name: 'Apple scab', localName: 'Khaar / Scab', kind: 'disease', favourableWeather: 'Leaf wetness (RH ≥ 90% or rain) for the Mills hours at 1–26 °C; optimum ≈ 20 °C. Ascospores Mar–mid May in Kashmir.', provenance: 'SKUAST-K' },
  { id: 'alternaria-leaf-blotch', name: 'Alternaria leaf blotch', kind: 'disease', favourableWeather: '25–30 °C with wet weather; ≈ 5.5 h wetness; RH ≥ 92%. Worse after mite injury and heavy summer rain plus heat. Delicious types susceptible.', provenance: 'SUPPLEMENTARY' },
  { id: 'marssonina-blotch', name: 'Marssonina blotch / premature leaf fall', kind: 'disease', favourableWeather: '20–22 °C, RH > 85% after rain; defoliation follows mean > 20 °C + RH > 70% for 5–6 days. Appears late July–early Aug, peaks Oct.', provenance: 'SUPPLEMENTARY' },
  { id: 'powdery-mildew', name: 'Powdery mildew', kind: 'disease', favourableWeather: '10–25 °C (opt. 19–22 °C), RH > 70%; free water inhibits.', provenance: 'SUPPLEMENTARY' },
  { id: 'sooty-blotch-flyspeck', name: 'Sooty blotch & flyspeck', kind: 'disease', favourableWeather: 'Prolonged humid, rainy summer weather.', provenance: 'SKUAST-K' },
  { id: 'storage-rots', name: 'Storage rots', kind: 'disease', provenance: 'SKUAST-K' },
  { id: 'canker', name: 'Canker (stem/collar)', kind: 'disease', thresholdNote: 'Cultural: scrape, apply Bordeaux/Chaubatia paste.', provenance: 'SKUAST-K' },
  { id: 'fire-blight', name: 'Fire blight (quarantine watch)', kind: 'disease', thresholdNote: 'Not reported in India; report any suspected case. M9 and M26 highly susceptible.', provenance: 'SUPPLEMENTARY' },
  { id: 'european-red-mite', name: 'European red mite', kind: 'mite', scoutingMetric: 'mites per leaf', actionThreshold: 5, thresholdUnit: 'mites/leaf', thresholdNote: 'Stage-dependent: petal fall 4–5, fruitlet > 5, FD-I to III > 10, post-harvest > 20 (late season 15 per Aug 2026 advisory).', favourableWeather: 'Hot, dry spells.', provenance: 'SKUAST-K' },
  { id: 'two-spotted-mite', name: 'Two-spotted spider mite', kind: 'mite', scoutingMetric: 'mites per leaf', actionThreshold: 5, thresholdUnit: 'mites/leaf', thresholdNote: 'Same stage thresholds as European red mite.', favourableWeather: 'Hot, dry spells.', provenance: 'SKUAST-K' },
  { id: 'blossom-thrips', name: 'Apple blossom thrips', kind: 'insect', scoutingMetric: 'thrips per flower', actionThreshold: 2, thresholdUnit: 'thrips/flower', provenance: 'SKUAST-K' },
  { id: 'san-jose-scale', name: 'San Jose scale', kind: 'insect', scoutingMetric: 'crawlers per cm² twig', actionThreshold: 13, thresholdUnit: 'crawlers/cm²', thresholdNote: 'Kashmir DD model (base 10.5 °C): spring males 285 DD, gen-1 crawlers 534 DD (late May), gen-2 > 1357 DD.', provenance: 'SKUAST-K' },
  { id: 'woolly-apple-aphid', name: 'Woolly apple aphid', kind: 'insect', scoutingMetric: 'colonies on terminal shoots', actionThreshold: 1, thresholdUnit: 'colonies on terminals', favourableWeather: 'Nymph movement > 10.3 °C air; peaks mid-June and Oct–Nov.', provenance: 'SKUAST-K' },
  { id: 'aphids', name: 'Green apple aphid', kind: 'insect', scoutingMetric: '% succulent shoots infested', actionThreshold: 40, thresholdUnit: '% shoots', provenance: 'SKUAST-K' },
  { id: 'leaf-roller', name: 'Leaf roller', kind: 'insect', provenance: 'SKUAST-K' },
  { id: 'fruit-borer', name: 'Fruit borer / codling moth', kind: 'insect', scoutingMetric: 'moths per trap per week', actionThreshold: 5, thresholdUnit: 'moths/trap/week', thresholdNote: 'Codling moth is regulated in Ladakh; detected in Nadihal belt (Baramulla). Use local trap biofix.', provenance: 'SUPPLEMENTARY' },
  { id: 'fruit-fly', name: 'Fruit fly', kind: 'insect', provenance: 'SKUAST-K' },
  { id: 'leaf-blotch-miner', name: 'Apple leaf blotch miner', kind: 'insect', provenance: 'SKUAST-K' },
  { id: 'root-borer', name: 'Apple root borer (Dorysthenes hugelii)', kind: 'insect', thresholdNote: 'Adults emerge with pre-monsoon rain late June–early July; grubs within 90 cm of trunk.', provenance: 'SUPPLEMENTARY' },
  { id: 'stem-borer', name: 'Stem borer', kind: 'insect', thresholdNote: 'Clean holes, plug with chlorpyriphos-soaked cotton, seal with mud.', provenance: 'SKUAST-K' },
  { id: 'boron-deficiency', name: 'Boron deficiency', kind: 'disorder', thresholdNote: 'Corky core, cracking, blossom blast, rosette.', provenance: 'SKUAST-K' },
  { id: 'bitter-pit', name: 'Bitter pit (calcium)', kind: 'disorder', provenance: 'SKUAST-K' },
  { id: 'poor-colour', name: 'Poor fruit colour', kind: 'disorder', provenance: 'SKUAST-K' },
  { id: 'fruit-thinning', name: 'Crop load (thinning)', kind: 'disorder', provenance: 'SKUAST-K' },
  { id: 'pre-harvest-drop', name: 'Pre-harvest fruit drop', kind: 'disorder', provenance: 'SKUAST-K' },
];

/** Stage-specific mite thresholds (mites/leaf) from SKUAST-K. */
export const MITE_THRESHOLDS: Record<string, number> = {
  's06-petal-fall': 4,
  's07-fruitlet': 5,
  's08-fd1': 10,
  's09-fd2': 10,
  's10-fd3': 10,
  's11-fd4': 15,
  's12-pre-harvest': 15,
  's14-post-harvest': 20,
};

export const VARIETIES: Variety[] = [
  { id: 'red-delicious', name: 'Red Delicious', group: 'traditional', scabResistant: false, hdpSuitable: false, pollinizerRole: 'main', chillingHours: '1200–1400', harvestWindow: '08-25..10-05', dafbMin: 129, dafbMax: 139, maturity: { firmnessLbMin: 16, firmnessLbMax: 18, tssBrixMin: 12, starchIndexMin: 2.5, starchIndexMax: 3.5 }, notes: 'Main commercial variety; Alternaria-susceptible.', provenance: 'JK-HORTICULTURE' },
  { id: 'royal-delicious', name: 'Royal Delicious', group: 'traditional', scabResistant: false, hdpSuitable: false, pollinizerRole: 'main', harvestWindow: '08-25..10-05', dafbMin: 120, dafbMax: 130, maturity: { firmnessLbMin: 16, firmnessLbMax: 18, tssBrixMin: 13 }, provenance: 'SUPPLEMENTARY' },
  { id: 'kullu-delicious', name: 'Kullu Delicious', group: 'traditional', scabResistant: false, hdpSuitable: false, pollinizerRole: 'main', harvestWindow: '08-25..10-05', dafbMin: 125, dafbMax: 135, provenance: 'SUPPLEMENTARY' },
  { id: 'american-trel', name: 'American Trel (Apirouge)', group: 'traditional', scabResistant: false, hdpSuitable: false, pollinizerRole: 'main', harvestWindow: '08-25..09-30', notes: 'Firm, long keeper; tolerant to Alternaria.', provenance: 'SUPPLEMENTARY' },
  { id: 'golden-delicious', name: 'Golden Delicious', group: 'pollinizer', scabResistant: false, hdpSuitable: true, pollinizerRole: 'both', chillingHours: '≈1000', harvestWindow: '09-20..10-25', dafbMin: 142, dafbMax: 154, maturity: { tssBrixMin: 12, firmnessLbMin: 16 }, notes: 'Main pollinizer in Kashmir.', provenance: 'JK-HORTICULTURE' },
  { id: 'maharaji', name: 'Maharaji (White Dotted Red)', group: 'traditional', scabResistant: false, hdpSuitable: false, pollinizerRole: 'main', harvestWindow: '10-15..11-05', dafbMin: 157, dafbMax: 163, notes: 'Late; keeps well; Alternaria-tolerant.', provenance: 'SUPPLEMENTARY' },
  { id: 'ambri', name: 'Ambri', group: 'traditional', scabResistant: false, hdpSuitable: false, pollinizerRole: 'main', harvestWindow: '09-25..11-10', maturity: { tssBrixMin: 14 }, notes: 'Native Kashmiri; TSS up to 16%; stores ≈ 6 months; Alternaria-tolerant.', provenance: 'SUPPLEMENTARY' },
  { id: 'hazratbali', name: 'Hazratbali (Benoni)', group: 'traditional', scabResistant: false, hdpSuitable: false, pollinizerRole: 'main', harvestWindow: '07-10..07-31', notes: 'Earliest; short shelf life.', provenance: 'SUPPLEMENTARY' },
  { id: 'granny-smith', name: 'Granny Smith', group: 'pollinizer', scabResistant: false, hdpSuitable: true, pollinizerRole: 'both', chillingHours: '400–600', harvestWindow: '10-15..11-15', dafbMin: 175, dafbMax: 185, provenance: 'SUPPLEMENTARY' },
  { id: 'gala-redlum', name: 'Gala Redlum', group: 'hdp_exotic', scabResistant: false, hdpSuitable: true, pollinizerRole: 'main', chillingHours: '800–1000', harvestWindow: '08-01..08-25', dafbMin: 125, dafbMax: 135, maturity: { firmnessLbMin: 16.8, firmnessLbMax: 20.7, starchIndexMin: 3, starchIndexMax: 3.7 }, notes: 'Best table quality at 130 DAFB (SKUAST-K, Wani et al. 2023).', provenance: 'SKUAST-K' },
  { id: 'red-velox', name: 'Red Velox', group: 'hdp_exotic', scabResistant: false, hdpSuitable: true, pollinizerRole: 'main', harvestWindow: '08-20..09-15', dafbMin: 145, dafbMax: 155, notes: 'Best table quality at 150 DAFB.', provenance: 'SKUAST-K' },
  { id: 'super-chief', name: 'Super Chief', group: 'hdp_exotic', scabResistant: false, hdpSuitable: true, pollinizerRole: 'main', harvestWindow: '08-20..09-15', dafbMin: 145, dafbMax: 155, notes: 'Spur type; best table quality at 150 DAFB.', provenance: 'SKUAST-K' },
  { id: 'scarlet-spur-2', name: 'Scarlet Spur-II', group: 'hdp_exotic', scabResistant: false, hdpSuitable: true, pollinizerRole: 'main', harvestWindow: '08-20..09-15', provenance: 'SUPPLEMENTARY' },
  { id: 'jeromine', name: 'Jeromine', group: 'hdp_exotic', scabResistant: false, hdpSuitable: true, pollinizerRole: 'main', harvestWindow: '08-20..09-15', provenance: 'SUPPLEMENTARY' },
  { id: 'king-roat', name: 'King Roat', group: 'hdp_exotic', scabResistant: false, hdpSuitable: true, pollinizerRole: 'main', harvestWindow: '08-20..09-15', provenance: 'SUPPLEMENTARY' },
  { id: 'red-fuji', name: 'Red Fuji / Coe Red Fuji', group: 'hdp_exotic', scabResistant: false, hdpSuitable: true, pollinizerRole: 'both', chillingHours: '800–1000', harvestWindow: '10-10..11-05', provenance: 'JK-HORTICULTURE' },
  { id: 'silver-spur', name: 'Silver Spur', group: 'hdp_exotic', scabResistant: false, hdpSuitable: true, pollinizerRole: 'main', provenance: 'JK-HORTICULTURE' },
  { id: 'shireen', name: 'Shireen', group: 'skuast_release', scabResistant: true, resistanceGene: 'Rvi6 (Vf)', hdpSuitable: false, pollinizerRole: 'main', maturity: { tssBrixMin: 13 }, notes: 'Resists Kashmir scab races (0),(1),(2),(1,2). Low-spray programme eligible.', provenance: 'SKUAST-K' },
  { id: 'firdous', name: 'Firdous', group: 'skuast_release', scabResistant: true, resistanceGene: 'Rvi6 (Vf)', hdpSuitable: false, pollinizerRole: 'main', maturity: { tssBrixMin: 11 }, notes: 'Released 1995; moderately resistant to Alternaria and San Jose scale.', provenance: 'SKUAST-K' },
  { id: 'shalimar-apple-1', name: 'Shalimar Apple-1', group: 'skuast_release', scabResistant: true, resistanceGene: 'Rvi6 (Vf)', hdpSuitable: false, pollinizerRole: 'main', provenance: 'SKUAST-K' },
  { id: 'lal-ambri', name: 'Lal Ambri', group: 'skuast_release', scabResistant: false, hdpSuitable: false, pollinizerRole: 'main', notes: 'Red Delicious × Ambri quality hybrid — NOT documented as Vf scab-resistant; follow the full schedule.', provenance: 'SKUAST-K' },
  { id: 'sunehari', name: 'Sunehari', group: 'skuast_release', scabResistant: false, hdpSuitable: false, pollinizerRole: 'main', notes: 'Ambri × Golden Delicious; not documented as Vf-resistant.', provenance: 'SKUAST-K' },
  { id: 'crab-apple', name: 'Crab apple (pollinizer)', group: 'crab', scabResistant: false, hdpSuitable: true, pollinizerRole: 'pollinizer', provenance: 'JK-HORTICULTURE' },
];

const tpk = (a: number, b: number) => Math.floor(M2.KANAL / (a * b));

export const ROOTSTOCKS: Rootstock[] = [
  { id: 'seedling', name: 'Seedling / Crab C', vigor: 'vigorous', spacingM: [6, 6], treesPerKanal: tpk(6, 6), needsSupport: false, resistances: [], cautions: ['Long juvenile period'], provenance: 'JK-HORTICULTURE' },
  { id: 'mm111', name: 'MM111', vigor: 'semi_vigorous', spacingM: [3.5, 4.5], treesPerKanal: tpk(3.5, 4.5), needsSupport: false, resistances: ['woolly apple aphid', 'drought'], cautions: [], provenance: 'SUPPLEMENTARY' },
  { id: 'mm106', name: 'MM106', vigor: 'semi_dwarf', spacingM: [2.5, 3.5], treesPerKanal: tpk(2.5, 3.5), needsSupport: false, resistances: ['woolly apple aphid'], cautions: ['Susceptible to collar rot (Phytophthora) — avoid heavy/waterlogged soils'], provenance: 'JK-HORTICULTURE' },
  { id: 'm7', name: 'M7', vigor: 'semi_dwarf', spacingM: [2.5, 4], treesPerKanal: tpk(2.5, 4), needsSupport: false, resistances: [], cautions: ['Suckers', 'Woolly apple aphid susceptible'], provenance: 'SUPPLEMENTARY' },
  { id: 'm26', name: 'M26', vigor: 'dwarf', spacingM: [1.5, 3.5], treesPerKanal: tpk(1.5, 3.5), needsSupport: true, resistances: [], cautions: ['Very susceptible to fire blight', 'Collar rot susceptible'], provenance: 'SUPPLEMENTARY' },
  { id: 'm9-t337', name: 'M9 (T337)', vigor: 'dwarf', spacingM: [1, 3], treesPerKanal: tpk(1, 3), needsSupport: true, resistances: [], cautions: ['Shallow roots: 4-wire trellis and drip mandatory', 'Suckers; woolly aphid; fire blight susceptible'], provenance: 'JK-HORTICULTURE' },
  { id: 'b9', name: 'Budagovsky 9', vigor: 'dwarf', spacingM: [1, 3], treesPerKanal: tpk(1, 3), needsSupport: true, resistances: ['cold hardiness'], cautions: ['Under trial in J&K'], provenance: 'SUPPLEMENTARY' },
  { id: 'g41', name: 'Geneva G.41 / G.935', vigor: 'dwarf', spacingM: [1, 3], treesPerKanal: tpk(1, 3), needsSupport: true, resistances: ['fire blight', 'collar rot', 'woolly apple aphid'], cautions: ['Experimental in J&K'], provenance: 'SUPPLEMENTARY' },
];

/** WSU EB0913 critical temperatures (Red Delicious, 30 min). */
export const CRITICAL_TEMPS: CriticalTemp[] = [
  { stage: 'silver-tip', kill10C: -9.4, kill90C: -16.7 },
  { stage: 'green-tip', kill10C: -7.8, kill90C: -12.2 },
  { stage: 'half-inch-green', kill10C: -5.0, kill90C: -9.4 },
  { stage: 'tight-cluster', kill10C: -2.8, kill90C: -6.1 },
  { stage: 'first-pink', kill10C: -2.2, kill90C: -4.4 },
  { stage: 'full-pink', kill10C: -2.2, kill90C: -3.9 },
  { stage: 'first-bloom', kill10C: -2.2, kill90C: -3.9 },
  { stage: 'full-bloom', kill10C: -2.2, kill90C: -3.9 },
  { stage: 'post-bloom', kill10C: -2.2, kill90C: -3.9 },
];

/** Map schedule stages to frost critical-temperature stages. */
export const STAGE_TO_FROST: Record<string, string> = {
  's01-delayed-dormancy': 'silver-tip',
  's02-green-tip': 'green-tip',
  's03-tight-cluster': 'tight-cluster',
  's04-pink-bud': 'full-pink',
  's05-flowering': 'full-bloom',
  's06-petal-fall': 'post-bloom',
  's07-fruitlet': 'post-bloom',
};

export const SAFETY: SafetyItem[] = [
  ['do', 'Buy pesticides only from a licensed dealer and keep the invoice (batch and registration number).'],
  ['do', 'Wear PPE: gloves, mask, goggles, full-sleeve clothing and boots while mixing and spraying.'],
  ['do', 'Spray in early morning or evening; spray with the wind, never against it.'],
  ['do', 'Inform nearby beekeepers before spraying.'],
  ['do', 'Wash hands, face and clothes after spraying; bathe before eating.'],
  ['do', 'Triple-rinse empty containers, puncture and dispose of them safely.'],
  ['do', 'Calibrate the sprayer and use the scaled tank dose shown by the app.'],
  ['dont', 'Do not decant pesticides into unlabelled containers.'],
  ['dont', 'Do not clear clogged nozzles by mouth.'],
  ['dont', 'Do not eat, drink or smoke while spraying.'],
  ['dont', 'Do not spray at full bloom.'],
  ['dont', 'Do not mix fungicides and insecticides in one tank.'],
  ['dont', 'Do not let children or pregnant women handle pesticides.'],
  ['dont', 'Do not spray within 3–4 weeks of harvest.'],
].map(([kind, text], i) => ({ id: `safety-${i + 1}`, kind: kind as 'do' | 'dont', text: text!, provenance: 'SKUAST-K' as const }));

/** Per-tree annual fertiliser (SKUAST-Jammu PoP for J&K; configurable — sources disagree for mature trees). */
export const FERTILISER_BY_AGE: { age: number; fymKg: number; ureaG: number; dapG: number; mopG: number }[] = [
  [1, 5, 35, 20, 50], [2, 10, 70, 45, 100], [3, 15, 105, 65, 150], [4, 20, 140, 85, 200], [5, 25, 175, 110, 250],
  [6, 30, 245, 150, 350], [7, 35, 315, 195, 450], [8, 40, 385, 235, 530], [9, 45, 455, 280, 630], [10, 50, 525, 325, 730],
  [11, 60, 630, 385, 900], [12, 70, 735, 450, 1050], [13, 80, 840, 515, 1190], [14, 90, 940, 580, 1345], [15, 100, 1050, 645, 1500],
].map(([age, fymKg, ureaG, dapG, mopG]) => ({ age: age!, fymKg: fymKg!, ureaG: ureaG!, dapG: dapG!, mopG: mopG! }));

/** Split of the annual dose by stage (SKUAST-K): urea ⅓/⅓/⅓, DAP all at green tip, MOP ½/½. */
export const FERTILISER_SPLITS = [
  { stageId: 's02-green-tip', urea: 1 / 3, dap: 1, mop: 0.5, fym: 1 },
  { stageId: 's08-fd1', urea: 1 / 3, dap: 0, mop: 0.5, fym: 0 },
  { stageId: 's10-fd3', urea: 1 / 3, dap: 0, mop: 0, fym: 0 },
];

/** HDP drip fertigation template (YSPU/HP, 14 weekly splits 15 Mar–end Jun): g per plant per split. */
export const HDP_FERTIGATION = { splits: 14, start: '03-15', end: '06-30', perSplitByYear: [
  { year: 1, n: 2.5, p2o5: 1.25, k2o: 2.5 }, { year: 2, n: 5, p2o5: 2.5, k2o: 5 }, { year: 3, n: 7.5, p2o5: 3.75, k2o: 7.5 },
  { year: 4, n: 10, p2o5: 5, k2o: 10 }, { year: 5, n: 12.5, p2o5: 6.25, k2o: 12.5 },
], provenance: 'SUPPLEMENTARY' as const };

/** Spray liquid per tree (L) by system and age — Kashmir spray-costing bulletin. */
export const SPRAY_VOLUME_L_PER_TREE = {
  traditional: [ { maxAge: 5, l: 3 }, { maxAge: 10, l: 5 }, { maxAge: 20, l: 8 }, { maxAge: Infinity, l: 15 } ],
  hdp: [ { maxAge: 2, l: 1 }, { maxAge: 5, l: 1.5 }, { maxAge: Infinity, l: 2.5 } ],
  medium_density: [ { maxAge: 2, l: 1 }, { maxAge: 5, l: 2 }, { maxAge: Infinity, l: 4 } ],
};

export const MANDIS = ['Sopore', 'Shopian (Aglar)', 'Parimpora (Srinagar)', 'Batengoo (Anantnag)', 'Pulwama', 'Azadpur APMC (Delhi)'];
export const BOX_TYPES = [
  { id: 'wooden', label: 'Wooden box', kg: 17 },
  { id: 'carton', label: 'Cardboard carton', kg: 15 },
  { id: 'tray-10', label: '10 kg tray', kg: 10 },
  { id: 'crate', label: 'Field crate', kg: 17 },
];
export const GRADES = ['A', 'B', 'C'] as const;
