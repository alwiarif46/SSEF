import type { ProductOption, SprayScheduleVersion, SprayStage, StageRecommendation, Category, SystemType } from './types.js';

export const VERSION_2026: SprayScheduleVersion = {
  id: 'skuastk-2026',
  season: 2026,
  source: 'SKUAST-K Integrated Management Guide for Apple Orchards in Kashmir 2026 (No. AU/DEx/449-BL/01/26)',
  sourceUrl: 'https://hortikashmir.jk.gov.in/Data/SpraySchedule/SpraySchedule-2026-Urdu-English.pdf',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  status: 'under_review',
  disclaimer:
    'This schedule is for guidance. Legal use of any pesticide depends on its CIBRC registration and apple label claim. Always read the product label. Calendar windows are approximate and shift with altitude.',
};

const V = VERSION_2026.id;

/** Calendar windows are inferred for a 1,600–1,900 m valley orchard (schedule gives relative timing only). */
export const STAGES_2026: SprayStage[] = [
  { id: 's01-delayed-dormancy', order: 1, name: 'Delayed Dormancy', windowStart: '02-20', windowEnd: '03-15', phenology: 'Buds swelling, before green tip.', timingGuidance: 'Apply HMO before green tip on a dry day, temperature above 5 °C, no frost expected for 24 h.', culturalPractices: ['Training and pruning', 'Orchard sanitation — remove mummies and fallen leaves', 'Drainage', 'Staking'] },
  { id: 's02-green-tip', order: 2, name: 'Green Tip', windowStart: '03-15', windowEnd: '03-31', phenology: 'Green leaf tissue visible at bud tip (≈ 1–2 mm).', timingGuidance: 'Skip fungicide if the next 7 days stay dry; spray before ≥ 1 full day of rain.', culturalPractices: ['FYM + ⅓ urea + all DAP + ½ MOP (Annexure-1 by age)', 'Trichoderma with FYM / drench in root-rot-prone soil', 'Keep graft union 6 inches above soil'] },
  { id: 's03-tight-cluster', order: 3, name: 'Tight Cluster', windowStart: '03-28', windowEnd: '04-08', phenology: 'Flower buds visible, tightly clustered.', timingGuidance: 'Fungicide only if ≥ 1 full day of rain is forecast.', culturalPractices: [] },
  { id: 's04-pink-bud', order: 4, name: 'Pink Bud', windowStart: '04-05', windowEnd: '04-18', phenology: 'Flower buds show pink colour, petals not open.', timingGuidance: 'Crucial stage for primary scab. In dry weather spray when most flowers are at pink to avoid spraying in early bloom.', culturalPractices: ['Place 3–4 bee hives/ha at 5–10% bloom', 'Boron 1–1.5 g/L (need-based)'] },
  { id: 's05-flowering', order: 5, name: 'Flowering', windowStart: '04-12', windowEnd: '04-28', phenology: 'King bloom open to full bloom.', timingGuidance: 'Spraying not advisable. Only if a 10-day fungicide gap exists AND rain is forecast, use a protectant. Mist spray only; do not wash trees.', minIntervalDays: 10, pollinatorSensitive: true, culturalPractices: ['Pheromone traps 8–10/ha for apple leaf blotch miner'] },
  { id: 's06-petal-fall', order: 6, name: 'Petal Fall (60–70%)', windowStart: '04-25', windowEnd: '05-08', phenology: '60–70% petals fallen.', timingGuidance: 'Spray before rain. Scout HDP leaf undersides; remove scabbed leaves before rain.', culturalPractices: ['Boron 1–1.5 g/L if not applied at pink bud'] },
  { id: 's07-fruitlet', order: 7, name: 'Fruitlet', windowStart: '05-08', windowEnd: '05-25', phenology: 'Fruitlets 10–12 mm.', timingGuidance: '10–14 days after petal fall; spray before rain.', minIntervalDays: 10, maxIntervalDays: 14, culturalPractices: ['Fruit borer sex pheromone traps 8–10/ha (monitoring), 40/ha (mass trapping)', 'Thinning: NAA 5–10 ppm at 10–12 mm fruit size', 'Trunk whitewash: 1 kg lime + 300 g copper sulphate + 250 g glue in 10 L', 'Powdery mildew: remove infected shoots'] },
  { id: 's08-fd1', order: 8, name: 'Fruit Development I', windowStart: '05-22', windowEnd: '06-08', phenology: 'Fruit ≈ 20–25 mm.', timingGuidance: '10–14 days after fruitlet; fungicide if rain is forecast.', minIntervalDays: 10, maxIntervalDays: 14, culturalPractices: ['Second fertiliser dose: ⅓ urea + remaining ½ MOP', 'First CaCl₂ spray 3–4 g/L'] },
  { id: 's09-fd2', order: 9, name: 'Fruit Development II', windowStart: '06-05', windowEnd: '06-25', phenology: 'Fruit ≈ walnut size.', timingGuidance: '12–15 days after FD-I; fungicide if rain is forecast.', minIntervalDays: 12, maxIntervalDays: 15, culturalPractices: ['Second CaCl₂ spray 3–4 g/L'] },
  { id: 's10-fd3', order: 10, name: 'Fruit Development III', windowStart: '06-20', windowEnd: '07-10', phenology: 'Rapid fruit growth.', timingGuidance: '12–15 days after FD-II; spray before rain. After 15 June avoid spraying straight after severe rain in low-altitude areas.', minIntervalDays: 12, maxIntervalDays: 15, culturalPractices: ['Remaining ⅓ urea', 'Third CaCl₂ spray 3–4 g/L', 'First K₂SO₄ spray 4–5 g/L (colour, need-based)', 'Methyl eugenol fruit-fly traps 25–40/ha', 'Keep mites low (Alternaria) and aphids low (sooty mould)'] },
  { id: 's11-fd4', order: 11, name: 'Fruit Development IV', windowStart: '07-08', windowEnd: '07-31', phenology: 'Fruit sizing; Marssonina/Alternaria season.', timingGuidance: 'Treat by observed disease: Alternaria/scab or sooty blotch/flyspeck.', minIntervalDays: 12, maxIntervalDays: 18, culturalPractices: [] },
  { id: 's12-pre-harvest', order: 12, name: 'Pre-harvest', windowStart: '08-01', windowEnd: '09-20', phenology: '15–20 days before harvest (variety dependent).', timingGuidance: 'Storage fungicide 15–20 days before harvest — the app enforces each product PHI and the 3–4 week stop rule.', culturalPractices: ['NAA 10 ppm against pre-harvest drop (need-based)', 'Second K₂SO₄ spray 4–5 g/L', 'CaCl₂ 3–4 g/L for storage life'] },
  { id: 's13-harvest', order: 13, name: 'Harvest', windowStart: '08-15', windowEnd: '10-31', phenology: 'Commercial maturity.', timingGuidance: 'No sprays. Harvest by maturity indices: starch 2.5 (CA storage) / 3.5 (table), red colour > 75%, TSS 12–14 °Brix, firmness 16–18 lb, seed > 75% dark brown, variety DAFB.', culturalPractices: ['2–3 pickings; fruit separates easily from spur'] },
  { id: 's14-post-harvest', order: 14, name: 'Post-harvest', windowStart: '10-15', windowEnd: '11-30', phenology: 'After harvest until leaf fall.', timingGuidance: 'Urea 3–4% when 50% of leaves have yellowed naturally, in orchards with scab or Alternaria.', culturalPractices: ['HDP: tighten trellis wires; close anti-hail nets', 'Trunk banding for fruit-borer areas (Oct–Nov)'] },
  { id: 's15-dormancy', order: 15, name: 'Dormancy', windowStart: '12-01', windowEnd: '02-19', phenology: 'Leafless dormant trees.', timingGuidance: 'No pesticide.', culturalPractices: ['Urea 5% on orchard floor if fall urea missed', 'Paint pruning wounds; scrape canker and dead wood; apply Bordeaux or Chaubatia paste', 'Rogue virus-infected trees; sterilise pruning tools', 'Sheep grazing in traditional orchards', 'Root borer: dig tree basin Dec–Jan to collect grubs'] },
].map((s) => ({ ...s, scheduleVersionId: V, provenance: 'SKUAST-K' as const }));

const o = (chemicalId: string, dosePer100L: number, doseUnit: ProductOption['doseUnit'], notes?: string): ProductOption => ({ chemicalId, dosePer100L, doseUnit, ...(notes ? { notes } : {}) });

let n = 0;
const rec = (
  stageId: string,
  category: Category,
  target: string[],
  options: ProductOption[],
  extra: { needBased?: boolean; notes?: string; systemType?: SystemType; skipForScabResistant?: boolean } = {},
): StageRecommendation => ({
  id: `${stageId}-r${String(++n).padStart(2, '0')}`,
  stageId,
  category,
  target,
  options,
  needBased: extra.needBased ?? false,
  systemType: extra.systemType ?? 'both',
  ...(extra.skipForScabResistant != null ? { skipForScabResistant: extra.skipForScabResistant } : {}),
  ...(extra.notes ? { notes: extra.notes } : {}),
  provenance: 'SKUAST-K',
});

const PROTECTANTS_5 = [o('mancozeb-75wp', 300, 'g'), o('captan-50wp', 300, 'g'), o('propineb-70wp', 300, 'g'), o('zineb-75wp', 300, 'g'), o('metiram-70wg', 300, 'g')];
const MITICIDE_NOTE = (n: number) => `Need-based: only when mites exceed ${n} per leaf.`;

export const RECOMMENDATIONS_2026: StageRecommendation[] = [
  rec('s01-delayed-dormancy', 'oil', ['san-jose-scale', 'woolly-apple-aphid', 'european-red-mite'], [o('hmo', 2, 'l')], { notes: 'HMO @ 2% (2 L per 100 L) before green tip.' }),

  rec('s02-green-tip', 'fungicide', ['apple-scab'], PROTECTANTS_5, { needBased: true, skipForScabResistant: true, notes: 'Skip if the next 7 days are dry; spray before ≥ 1 day of rain.' }),

  rec('s03-tight-cluster', 'fungicide', ['apple-scab'], [...PROTECTANTS_5, o('mancozeb-75wg', 300, 'g')], { needBased: true, skipForScabResistant: true, notes: 'Only if ≥ 1 full day of rain is forecast.' }),

  rec('s04-pink-bud', 'fungicide', ['apple-scab', 'powdery-mildew'], [
    o('zineb-hexaconazole-72wp', 125, 'g'), o('metiram-pyraclostrobin-60wg', 100, 'g'), o('dodine-65wp', 60, 'g'), o('dodine-40sc', 90, 'ml'),
    o('tebuconazole-captan-336sc', 250, 'ml'), o('tebuconazole-389sc', 40, 'ml'), o('chlorothalonil-difenoconazole-44sc', 180, 'ml'), o('mancozeb-carbendazim-75wp', 250, 'g'),
  ], { notes: 'Crucial primary-scab stage.' }),
  rec('s04-pink-bud', 'insecticide', ['san-jose-scale', 'woolly-apple-aphid'], [o('chlorpyriphos-20ec', 100, 'ml')], { needBased: true, notes: 'Only if the dormant HMO spray was missed.' }),
  rec('s04-pink-bud', 'insecticide', ['blossom-thrips', 'leaf-roller'], [o('thiacloprid-217sc', 40, 'ml')], { needBased: true, notes: 'Blossom thrips ≥ 2 per flower or leaf roller present. Not after 5–10% bloom.' }),
  rec('s04-pink-bud', 'nutrient', ['boron-deficiency'], [o('boric-acid', 125, 'g', '1–1.5 g/L')], { needBased: true }),

  rec('s05-flowering', 'fungicide', ['apple-scab'], [...PROTECTANTS_5, o('mancozeb-75wg', 300, 'g')], { needBased: true, skipForScabResistant: true, notes: 'Only if a 10-day fungicide gap exists AND rain is forecast. No insecticides at bloom.' }),

  rec('s06-petal-fall', 'fungicide', ['apple-scab', 'powdery-mildew'], [
    o('difenoconazole-25ec', 30, 'ml'), o('flusilazole-40ec', 20, 'ml'), o('penconazole-10ec', 50, 'ml'), o('fluxapyroxad-difenoconazole-sc', 30, 'ml'),
    o('trifloxystrobin-tebuconazole-75wg', 40, 'g'), o('fluopyram-tebuconazole-400sc', 50, 'ml'), o('trifloxystrobin-difenoconazole-sulphur-sc', 90, 'ml'),
  ], { notes: 'Spray before rain.' }),
  rec('s06-petal-fall', 'insecticide', ['aphids', 'leaf-roller'], [o('neem-oil-1500ppm', 300, 'ml'), o('chlorpyriphos-20ec', 100, 'ml'), o('quinalphos-25ec', 100, 'ml')], { needBased: true }),
  rec('s06-petal-fall', 'miticide', ['european-red-mite', 'two-spotted-mite'], [o('etoxazole-10sc', 110, 'ml'), o('hexythiazox-545ec', 40, 'ml'), o('spiromesifen-229sc', 40, 'ml'), o('cyenopyrafen-30sc', 30, 'ml')], { needBased: true, notes: MITICIDE_NOTE(4) + ' (4–5 per leaf at petal fall)' }),
  rec('s06-petal-fall', 'nutrient', ['boron-deficiency'], [o('boric-acid', 125, 'g', '1–1.5 g/L')], { needBased: true, notes: 'If not applied at pink bud.' }),

  rec('s07-fruitlet', 'fungicide', ['apple-scab', 'alternaria-leaf-blotch', 'powdery-mildew'], [
    o('zineb-hexaconazole-72wp', 125, 'g'), o('dodine-65wp', 60, 'g'), o('dodine-40sc', 90, 'ml'), o('fluxapyroxad-pyraclostrobin-500sc', 20, 'ml'),
    o('tebuconazole-captan-336sc', 250, 'ml'), o('pyraclostrobin-boscalid-38wg', 30, 'g'), o('tebuconazole-389sc', 40, 'ml'), o('mancozeb-carbendazim-75wp', 250, 'g'),
  ], { notes: 'Spray before rain.' }),
  rec('s07-fruitlet', 'insecticide', ['aphids', 'san-jose-scale', 'fruit-borer'], [o('quinalphos-25ec', 100, 'ml'), o('chlorpyriphos-20ec', 100, 'ml'), o('thiacloprid-217sc', 40, 'ml')], { notes: 'Keep a 3–4 day gap from the fungicide spray.' }),
  rec('s07-fruitlet', 'miticide', ['european-red-mite', 'two-spotted-mite'], [o('hexythiazox-545ec', 40, 'ml'), o('spiromesifen-229sc', 40, 'ml')], { needBased: true, notes: MITICIDE_NOTE(5) }),
  rec('s07-fruitlet', 'fungicide', ['powdery-mildew'], [o('ampelomyces-quisqualis', 500, 'ml')], { needBased: true, notes: 'Bio-agent for powdery mildew; remove infected shoots.' }),
  rec('s07-fruitlet', 'growth_regulator', ['fruit-thinning'], [o('naa', 1, 'g', '5–10 ppm at 10–12 mm fruit size (≈ 0.5–1 g a.i./100 L)')], { needBased: true, notes: 'Chemical thinning — dose as ppm of active ingredient.' }),

  rec('s08-fd1', 'fungicide', ['apple-scab', 'alternaria-leaf-blotch'], [...PROTECTANTS_5.slice(0, 4), o('ziram-80wp', 200, 'g'), o('metiram-70wg', 300, 'g')], { needBased: true, skipForScabResistant: false, notes: 'If rain is forecast.' }),
  rec('s08-fd1', 'insecticide', ['aphids', 'woolly-apple-aphid'], [o('neem-oil-1500ppm', 300, 'ml', 'follow after 4 days with Lecanicillium lecanii 500 g'), o('chlorpyriphos-20ec', 100, 'ml'), o('quinalphos-25ec', 100, 'ml')], { needBased: true }),
  rec('s08-fd1', 'insecticide', ['aphids'], [o('lecanicillium-lecanii', 500, 'g')], { needBased: true, notes: '4 days after neem oil. Not near sericulture.' }),
  rec('s08-fd1', 'miticide', ['european-red-mite', 'two-spotted-mite'], [o('hexythiazox-545ec', 40, 'ml'), o('spiromesifen-229sc', 40, 'ml')], { needBased: true, notes: MITICIDE_NOTE(10) }),
  rec('s08-fd1', 'nutrient', ['bitter-pit'], [o('calcium-chloride', 350, 'g', '3–4 g/L')], { notes: 'First calcium spray.' }),

  rec('s09-fd2', 'fungicide', ['alternaria-leaf-blotch', 'marssonina-blotch', 'apple-scab'], [
    o('difenoconazole-25ec', 30, 'ml'), o('flusilazole-40ec', 20, 'ml'), o('penconazole-10ec', 50, 'ml'), o('trifloxystrobin-tebuconazole-75wg', 40, 'g'),
    o('fluopyram-tebuconazole-400sc', 50, 'ml'), o('fluxapyroxad-pyraclostrobin-500sc', 20, 'ml'), o('fluxapyroxad-difenoconazole-sc', 30, 'ml'),
    o('chlorothalonil-difenoconazole-44sc', 180, 'ml'), o('mancozeb-carbendazim-75wp', 250, 'g'), o('trifloxystrobin-difenoconazole-sulphur-sc', 90, 'ml'),
  ], { needBased: true, notes: 'If rain is forecast.' }),
  rec('s09-fd2', 'insecticide', ['aphids', 'woolly-apple-aphid', 'san-jose-scale'], [o('chlorpyriphos-20ec', 100, 'ml'), o('quinalphos-25ec', 100, 'ml'), o('thiacloprid-217sc', 40, 'ml'), o('summer-oil', 750, 'ml')], { needBased: true }),
  rec('s09-fd2', 'miticide', ['european-red-mite', 'two-spotted-mite'], [o('hexythiazox-545ec', 40, 'ml'), o('fenazaquin-10ec', 40, 'ml'), o('spiromesifen-229sc', 40, 'ml'), o('propargite-hexythiazox-ec', 100, 'ml'), o('etoxazole-10sc', 110, 'ml'), o('summer-oil', 750, 'ml')], { needBased: true, notes: MITICIDE_NOTE(10) }),
  rec('s09-fd2', 'nutrient', ['bitter-pit'], [o('calcium-chloride', 350, 'g', '3–4 g/L')], { notes: 'Second calcium spray.' }),

  rec('s10-fd3', 'fungicide', ['alternaria-leaf-blotch', 'marssonina-blotch', 'sooty-blotch-flyspeck'], [
    o('mancozeb-75wp', 300, 'g'), o('zineb-75wp', 300, 'g'), o('ziram-80wp', 200, 'g'), o('ziram-27sc', 600, 'ml'), o('chlorothalonil-75wp', 150, 'g'), o('mancozeb-75wg', 300, 'g'),
  ], { notes: 'Spray before rain.' }),
  rec('s10-fd3', 'insecticide', ['aphids', 'woolly-apple-aphid'], [o('chlorpyriphos-20ec', 100, 'ml'), o('quinalphos-25ec', 100, 'ml'), o('thiacloprid-217sc', 40, 'ml'), o('neem-oil-1500ppm', 300, 'ml', 'then L. lecanii or M. anisopliae 500 g after 4 days')], { needBased: true }),
  rec('s10-fd3', 'insecticide', ['aphids', 'root-borer'], [o('metarhizium-anisopliae', 500, 'g'), o('lecanicillium-lecanii', 500, 'g')], { needBased: true, notes: '4 days after neem oil. Not near sericulture.' }),
  rec('s10-fd3', 'miticide', ['european-red-mite', 'two-spotted-mite'], [o('fenazaquin-10ec', 40, 'ml'), o('cyenopyrafen-30sc', 30, 'ml'), o('etoxazole-10sc', 110, 'ml')], { needBased: true, notes: MITICIDE_NOTE(10) }),
  rec('s10-fd3', 'nutrient', ['bitter-pit'], [o('calcium-chloride', 350, 'g', '3–4 g/L')], { notes: 'Third calcium spray.' }),
  rec('s10-fd3', 'nutrient', ['poor-colour'], [o('potassium-sulphate', 450, 'g', '4–5 g/L')], { needBased: true, notes: 'First potassium sulphate spray for colour.' }),

  rec('s11-fd4', 'fungicide', ['alternaria-leaf-blotch', 'apple-scab'], [o('zineb-hexaconazole-72wp', 125, 'g'), o('hexaconazole-5ec', 50, 'ml'), o('myclobutanil-10wp', 70, 'g'), o('metiram-pyraclostrobin-60wg', 100, 'g'), o('pyraclostrobin-boscalid-38wg', 30, 'g')], { needBased: true, notes: 'If Alternaria leaf blotch or scab is present.' }),
  rec('s11-fd4', 'fungicide', ['sooty-blotch-flyspeck'], [o('mancozeb-75wp', 300, 'g'), o('ziram-27sc', 600, 'ml'), o('propineb-70wp', 300, 'g'), o('ziram-80wp', 200, 'g'), o('mancozeb-75wg', 300, 'g')], { needBased: true, notes: 'If sooty blotch or flyspeck is present.' }),

  rec('s12-pre-harvest', 'fungicide', ['storage-rots', 'apple-scab'], [o('captan-50wp', 300, 'g'), o('propineb-70wp', 300, 'g'), o('ziram-80wp', 200, 'g'), o('zineb-75wp', 300, 'g')], { notes: 'For long-term storage, 15–20 days before harvest. Products whose PHI exceeds the days remaining are filtered out automatically.' }),
  rec('s12-pre-harvest', 'growth_regulator', ['pre-harvest-drop'], [o('naa', 1, 'g', '10 ppm ≈ 1 g a.i. per 100 L')], { needBased: true }),
  rec('s12-pre-harvest', 'nutrient', ['poor-colour'], [o('potassium-sulphate', 450, 'g', '4–5 g/L')], { needBased: true, notes: 'Second K₂SO₄ spray.' }),
  rec('s12-pre-harvest', 'nutrient', ['bitter-pit'], [o('calcium-chloride', 350, 'g', '3–4 g/L')], { needBased: true, notes: 'For storage life.' }),

  rec('s14-post-harvest', 'nutrient', ['apple-scab', 'alternaria-leaf-blotch'], [o('urea', 3.5, 'kg', '3–4%')], { notes: 'When 50% of leaves have yellowed naturally (reduces overwintering scab inoculum).' }),
  rec('s14-post-harvest', 'insecticide', ['woolly-apple-aphid', 'san-jose-scale'], [o('chlorpyriphos-20ec', 100, 'ml')], { needBased: true }),
  rec('s14-post-harvest', 'miticide', ['european-red-mite'], [o('fenazaquin-10ec', 40, 'ml'), o('etoxazole-10sc', 110, 'ml')], { needBased: true, notes: MITICIDE_NOTE(20) }),
  rec('s14-post-harvest', 'insecticide', ['leaf-blotch-miner'], [o('quinalphos-25ec', 100, 'ml')], { needBased: true, notes: 'Essential where apple blotch leaf miner is a problem.' }),

  rec('s15-dormancy', 'nutrient', ['apple-scab'], [o('urea', 5, 'kg', '5% on orchard floor')], { needBased: true, notes: 'Only if the fall urea spray was missed. Spray the leaf litter, not the trees.' }),
];

/** SKUAST-K general instructions (2026). Several are enforced as validations. */
export const GENERAL_INSTRUCTIONS_2026 = [
  'Do not mix fungicides and insecticides.',
  'Keep a 3–4 day gap between insecticide and fungicide sprays.',
  'If heavy rain falls within 12 hours of a spray, repeat it immediately (when no sticker was used).',
  'Inform nearby beekeepers before spraying.',
  'Do not use the same pesticide in two consecutive sprays.',
  'Spray only in early morning or evening.',
  'No spray at full bloom.',
  'Stop insecticides and fungicides 3–4 weeks before harvest.',
  'Always spray before rain.',
  'After 15 June, avoid spraying straight after severe rain in low-altitude areas.',
];
