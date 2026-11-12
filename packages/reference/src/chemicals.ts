import type { Chemical } from './types.js';

/**
 * Chemical catalogue. PHI = max(SKUAST-K 2026 residue table, CIBRC apple label) — CIBRC is the
 * legal reference. FRAC/IRAC codes per FRAC Code List / IRAC MoA. See docs/research/sources.md.
 */
type C = Omit<Chemical, 'provenance' | 'cibrcRegistered' | 'appleLabelClaim' | 'status'> &
  Partial<Pick<Chemical, 'provenance' | 'cibrcRegistered' | 'appleLabelClaim' | 'status'>>;

const DOSE_FLAG = 'SKUAST-K dose differs from CIBRC label dose — agronomist review pending.';
const WATCH_2020 = 'Named in the 2020 draft ban list of 27 molecules (not finalised).';

const raw: C[] = [
  // ── Protectant (multi-site) fungicides ────────────────────────────────────
  { id: 'mancozeb-75wp', product: 'Mancozeb 75 WP', activeIngredients: ['mancozeb'], moleculeKeys: ['mancozeb'], formulation: 'WP', category: 'fungicide', fracGroup: 'M03', resistanceRisk: 'low', phiDays: 14, status: 'watch', statusNote: WATCH_2020 },
  { id: 'mancozeb-75wg', product: 'Mancozeb 75 WG', activeIngredients: ['mancozeb'], moleculeKeys: ['mancozeb'], formulation: 'WG', category: 'fungicide', fracGroup: 'M03', resistanceRisk: 'low', phiDays: 40, status: 'watch', statusNote: WATCH_2020 },
  { id: 'captan-50wp', product: 'Captan 50 WP', activeIngredients: ['captan'], moleculeKeys: ['captan'], formulation: 'WP', category: 'fungicide', fracGroup: 'M04', resistanceRisk: 'low', phiDays: 8, status: 'watch', statusNote: WATCH_2020 },
  { id: 'propineb-70wp', product: 'Propineb 70 WP', activeIngredients: ['propineb'], moleculeKeys: ['propineb'], formulation: 'WP', category: 'fungicide', fracGroup: 'M03', resistanceRisk: 'low', phiDays: 30 },
  { id: 'zineb-75wp', product: 'Zineb 75 WP', activeIngredients: ['zineb'], moleculeKeys: ['zineb'], formulation: 'WP', category: 'fungicide', fracGroup: 'M03', resistanceRisk: 'low' },
  { id: 'metiram-70wg', product: 'Metiram 70 WG', activeIngredients: ['metiram'], moleculeKeys: ['metiram'], formulation: 'WG', category: 'fungicide', fracGroup: 'M03', resistanceRisk: 'low', phiDays: 21 },
  { id: 'ziram-80wp', product: 'Ziram 80 WP', activeIngredients: ['ziram'], moleculeKeys: ['ziram'], formulation: 'WP', category: 'fungicide', fracGroup: 'M03', resistanceRisk: 'low', phiDays: 21 },
  { id: 'ziram-27sc', product: 'Ziram 27 SC', activeIngredients: ['ziram'], moleculeKeys: ['ziram'], formulation: 'SC', category: 'fungicide', fracGroup: 'M03', resistanceRisk: 'low', phiDays: 21 },
  { id: 'chlorothalonil-75wp', product: 'Chlorothalonil 75 WP', activeIngredients: ['chlorothalonil'], moleculeKeys: ['chlorothalonil'], formulation: 'WP', category: 'fungicide', fracGroup: 'M05', resistanceRisk: 'low', phiDays: 45 },
  // ── Single-site fungicides ─────────────────────────────────────────────────
  { id: 'dodine-65wp', product: 'Dodine 65 WP', activeIngredients: ['dodine'], moleculeKeys: ['dodine'], formulation: 'WP', category: 'fungicide', fracGroup: 'U12', resistanceRisk: 'medium', phiDays: 22, statusNote: `${DOSE_FLAG} Do not use stickers with dodine (S25).` },
  { id: 'dodine-40sc', product: 'Dodine 40 SC', activeIngredients: ['dodine'], moleculeKeys: ['dodine'], formulation: 'SC', category: 'fungicide', fracGroup: 'U12', resistanceRisk: 'medium', phiDays: 22 },
  { id: 'difenoconazole-25ec', product: 'Difenoconazole 25 EC', activeIngredients: ['difenoconazole'], moleculeKeys: ['difenoconazole'], formulation: 'EC', category: 'fungicide', fracGroup: '3', resistanceRisk: 'high', phiDays: 15, statusNote: `${DOSE_FLAG} Documented DMI resistance (CYP51 Y133F) in Kashmir.` },
  { id: 'flusilazole-40ec', product: 'Flusilazole 40 EC', activeIngredients: ['flusilazole'], moleculeKeys: ['flusilazole'], formulation: 'EC', category: 'fungicide', fracGroup: '3', resistanceRisk: 'high', phiDays: 25, statusNote: 'Documented DMI resistance in Kashmir.' },
  { id: 'penconazole-10ec', product: 'Penconazole 10 EC', activeIngredients: ['penconazole'], moleculeKeys: ['penconazole'], formulation: 'EC', category: 'fungicide', fracGroup: '3', resistanceRisk: 'high', phiDays: 30 },
  { id: 'hexaconazole-5ec', product: 'Hexaconazole 5 EC', activeIngredients: ['hexaconazole'], moleculeKeys: ['hexaconazole'], formulation: 'EC', category: 'fungicide', fracGroup: '3', resistanceRisk: 'high', phiDays: 30 },
  { id: 'myclobutanil-10wp', product: 'Myclobutanil 10 WP', activeIngredients: ['myclobutanil'], moleculeKeys: ['myclobutanil'], formulation: 'WP', category: 'fungicide', fracGroup: '3', resistanceRisk: 'high', phiDays: 21, statusNote: `${DOSE_FLAG} Myclobutanil resistance reported in the region.` },
  { id: 'tebuconazole-389sc', product: 'Tebuconazole 38.9 SC', activeIngredients: ['tebuconazole'], moleculeKeys: ['tebuconazole'], formulation: 'SC', category: 'fungicide', fracGroup: '3', resistanceRisk: 'high', phiDays: 30, statusNote: DOSE_FLAG },
  // ── Mixtures ───────────────────────────────────────────────────────────────
  { id: 'zineb-hexaconazole-72wp', product: 'Zineb 68% + Hexaconazole 4% WP', activeIngredients: ['zineb', 'hexaconazole'], moleculeKeys: ['zineb', 'hexaconazole'], formulation: 'WP', category: 'fungicide', fracGroup: 'M03+3', resistanceRisk: 'medium', phiDays: 30, statusNote: `${DOSE_FLAG} Schedule prints "Hexaconazole 5%"; registered product is 68% + 4%.` },
  { id: 'metiram-pyraclostrobin-60wg', product: 'Metiram 55% + Pyraclostrobin 5% WG', activeIngredients: ['metiram', 'pyraclostrobin'], moleculeKeys: ['metiram', 'pyraclostrobin'], formulation: 'WG', category: 'fungicide', fracGroup: 'M03+11', resistanceRisk: 'medium', phiDays: 12 },
  { id: 'tebuconazole-captan-336sc', product: 'Tebuconazole 6.7% + Captan 26.9% SC', activeIngredients: ['tebuconazole', 'captan'], moleculeKeys: ['tebuconazole', 'captan'], formulation: 'SC', category: 'fungicide', fracGroup: '3+M04', resistanceRisk: 'medium', phiDays: 10 },
  { id: 'chlorothalonil-difenoconazole-44sc', product: 'Chlorothalonil 40% + Difenoconazole 4% SC', activeIngredients: ['chlorothalonil', 'difenoconazole'], moleculeKeys: ['chlorothalonil', 'difenoconazole'], formulation: 'SC', category: 'fungicide', fracGroup: 'M05+3', resistanceRisk: 'medium', phiDays: 24, statusNote: DOSE_FLAG },
  { id: 'mancozeb-carbendazim-75wp', product: 'Mancozeb 63% + Carbendazim 12% WP', activeIngredients: ['mancozeb', 'carbendazim'], moleculeKeys: ['mancozeb', 'carbendazim'], formulation: 'WP', category: 'fungicide', fracGroup: 'M03+1', resistanceRisk: 'medium', phiDays: 20, status: 'watch', statusNote: WATCH_2020 },
  { id: 'fluxapyroxad-difenoconazole-sc', product: 'Fluxapyroxad 75 g/L + Difenoconazole 50 g/L SC', activeIngredients: ['fluxapyroxad', 'difenoconazole'], moleculeKeys: ['fluxapyroxad', 'difenoconazole'], formulation: 'SC', category: 'fungicide', fracGroup: '7+3', resistanceRisk: 'high', phiDays: 33 },
  { id: 'trifloxystrobin-tebuconazole-75wg', product: 'Trifloxystrobin 25% + Tebuconazole 50% WG', activeIngredients: ['trifloxystrobin', 'tebuconazole'], moleculeKeys: ['trifloxystrobin', 'tebuconazole'], formulation: 'WG', category: 'fungicide', fracGroup: '11+3', resistanceRisk: 'high', phiDays: 30 },
  { id: 'fluopyram-tebuconazole-400sc', product: 'Fluopyram 17.7% + Tebuconazole 17.7% SC', activeIngredients: ['fluopyram', 'tebuconazole'], moleculeKeys: ['fluopyram', 'tebuconazole'], formulation: 'SC', category: 'fungicide', fracGroup: '7+3', resistanceRisk: 'high', phiDays: 30 },
  { id: 'trifloxystrobin-difenoconazole-sulphur-sc', product: 'Trifloxystrobin 10% + Difenoconazole 12.25% + Sulphur 3% SC', activeIngredients: ['trifloxystrobin', 'difenoconazole', 'sulphur'], moleculeKeys: ['trifloxystrobin', 'difenoconazole', 'sulphur'], formulation: 'SC', category: 'fungicide', fracGroup: '11+3+M02', resistanceRisk: 'high', phiDays: 7, statusNote: DOSE_FLAG },
  { id: 'fluxapyroxad-pyraclostrobin-500sc', product: 'Fluxapyroxad 250 + Pyraclostrobin 250 g/L SC', activeIngredients: ['fluxapyroxad', 'pyraclostrobin'], moleculeKeys: ['fluxapyroxad', 'pyraclostrobin'], formulation: 'SC', category: 'fungicide', fracGroup: '7+11', resistanceRisk: 'high', phiDays: 41 },
  { id: 'pyraclostrobin-boscalid-38wg', product: 'Pyraclostrobin 12.8% + Boscalid 25.2% WG', activeIngredients: ['pyraclostrobin', 'boscalid'], moleculeKeys: ['pyraclostrobin', 'boscalid'], formulation: 'WG', category: 'fungicide', fracGroup: '7+11', resistanceRisk: 'high', phiDays: 41 },
  // ── Biologicals ────────────────────────────────────────────────────────────
  { id: 'ampelomyces-quisqualis', product: 'Ampelomyces quisqualis (bio-fungicide)', activeIngredients: ['Ampelomyces quisqualis'], moleculeKeys: ['ampelomyces'], formulation: 'WP/L', category: 'fungicide', fracGroup: 'BM02', resistanceRisk: 'low' },
  { id: 'trichoderma', product: 'Trichoderma harzianum / viride', activeIngredients: ['Trichoderma spp.'], moleculeKeys: ['trichoderma'], formulation: 'WP', category: 'fungicide', fracGroup: 'BM02', resistanceRisk: 'low', statusNote: 'Soil application with FYM or drench (root rot).' },
  // ── Oils ───────────────────────────────────────────────────────────────────
  { id: 'hmo', product: 'Horticultural Mineral Oil (dormant)', activeIngredients: ['mineral oil'], moleculeKeys: ['mineral-oil'], formulation: 'EC', category: 'oil', resistanceRisk: 'low', statusNote: 'Approved brands (S26): Orchol, Duratek Agri Spray Oil, HP Spray Oil/HP HMO, MAK, SERVO.' },
  { id: 'summer-oil', product: 'Summer Spray Oil', activeIngredients: ['mineral oil'], moleculeKeys: ['mineral-oil'], formulation: 'EC', category: 'oil', resistanceRisk: 'low', statusNote: 'Avoid above 32 °C and within 2 weeks of sulphur/captan.' },
  // ── Insecticides ───────────────────────────────────────────────────────────
  { id: 'chlorpyriphos-20ec', product: 'Chlorpyriphos 20 EC', activeIngredients: ['chlorpyriphos'], moleculeKeys: ['chlorpyriphos'], formulation: 'EC', category: 'insecticide', iracGroup: '1B', resistanceRisk: 'medium', beeToxicity: 'high', status: 'watch', statusNote: 'Banned on ber, citrus, tobacco only; still labelled on apple. ' + WATCH_2020 },
  { id: 'quinalphos-25ec', product: 'Quinalphos 25 EC', activeIngredients: ['quinalphos'], moleculeKeys: ['quinalphos'], formulation: 'EC', category: 'insecticide', iracGroup: '1B', resistanceRisk: 'medium', beeToxicity: 'high' },
  { id: 'thiacloprid-217sc', product: 'Thiacloprid 21.7 SC', activeIngredients: ['thiacloprid'], moleculeKeys: ['thiacloprid'], formulation: 'SC', category: 'insecticide', iracGroup: '4A', resistanceRisk: 'medium', beeToxicity: 'moderate', phiDays: 30 },
  { id: 'thiamethoxam-25wg', product: 'Thiamethoxam 25 WG', activeIngredients: ['thiamethoxam'], moleculeKeys: ['thiamethoxam'], formulation: 'WG', category: 'insecticide', iracGroup: '4A', resistanceRisk: 'medium', beeToxicity: 'high', provenance: 'SUPPLEMENTARY', statusNote: 'SKUAST-K Aug 2026 advisory (aphids, ≥40% shoots infested); not in the 2026 schedule.' },
  { id: 'neem-oil-1500ppm', product: 'Neem oil (Azadirachtin 1500 ppm)', activeIngredients: ['azadirachtin'], moleculeKeys: ['azadirachtin'], formulation: 'EC', category: 'insecticide', iracGroup: 'UN', resistanceRisk: 'low', beeToxicity: 'low' },
  { id: 'lecanicillium-lecanii', product: 'Lecanicillium lecanii 1.15% WP', activeIngredients: ['Lecanicillium lecanii'], moleculeKeys: ['lecanicillium'], formulation: 'WP', category: 'insecticide', iracGroup: 'UNF', resistanceRisk: 'low', beeToxicity: 'low', statusNote: 'Do not use near sericulture (silkworm rearing).' },
  { id: 'metarhizium-anisopliae', product: 'Metarhizium anisopliae 1% WP', activeIngredients: ['Metarhizium anisopliae'], moleculeKeys: ['metarhizium'], formulation: 'WP', category: 'insecticide', iracGroup: 'UNF', resistanceRisk: 'low', beeToxicity: 'low', statusNote: 'Do not use near sericulture (silkworm rearing).' },
  // ── Acaricides ─────────────────────────────────────────────────────────────
  { id: 'etoxazole-10sc', product: 'Etoxazole 10 SC', activeIngredients: ['etoxazole'], moleculeKeys: ['etoxazole'], formulation: 'SC', category: 'miticide', iracGroup: '10B', resistanceRisk: 'medium', phiDays: 43, statusNote: DOSE_FLAG },
  { id: 'hexythiazox-545ec', product: 'Hexythiazox 5.45 EC', activeIngredients: ['hexythiazox'], moleculeKeys: ['hexythiazox'], formulation: 'EC', category: 'miticide', iracGroup: '10A', resistanceRisk: 'medium', phiDays: 15 },
  { id: 'spiromesifen-229sc', product: 'Spiromesifen 22.9 SC', activeIngredients: ['spiromesifen'], moleculeKeys: ['spiromesifen'], formulation: 'SC', category: 'miticide', iracGroup: '23', resistanceRisk: 'medium', phiDays: 30, statusNote: DOSE_FLAG },
  { id: 'cyenopyrafen-30sc', product: 'Cyenopyrafen 30 SC', activeIngredients: ['cyenopyrafen'], moleculeKeys: ['cyenopyrafen'], formulation: 'SC', category: 'miticide', iracGroup: '25A', resistanceRisk: 'medium', phiDays: 15 },
  { id: 'fenazaquin-10ec', product: 'Fenazaquin 10 EC', activeIngredients: ['fenazaquin'], moleculeKeys: ['fenazaquin'], formulation: 'EC', category: 'miticide', iracGroup: '21A', resistanceRisk: 'medium', phiDays: 30 },
  { id: 'propargite-hexythiazox-ec', product: 'Propargite 42% + Hexythiazox 2% EC', activeIngredients: ['propargite', 'hexythiazox'], moleculeKeys: ['propargite', 'hexythiazox'], formulation: 'EC', category: 'miticide', iracGroup: '12C+10A', resistanceRisk: 'medium', phiDays: 15 },
  // ── Nutrients & growth regulators ──────────────────────────────────────────
  { id: 'boric-acid', product: 'Boron (boric acid / Solubor)', activeIngredients: ['boron'], moleculeKeys: ['boron'], formulation: 'SP', category: 'nutrient', resistanceRisk: 'low' },
  { id: 'calcium-chloride', product: 'Calcium chloride', activeIngredients: ['calcium chloride'], moleculeKeys: ['calcium'], formulation: 'SP', category: 'nutrient', resistanceRisk: 'low' },
  { id: 'potassium-sulphate', product: 'Potassium sulphate (K₂SO₄)', activeIngredients: ['potassium sulphate'], moleculeKeys: ['potassium'], formulation: 'SP', category: 'nutrient', resistanceRisk: 'low' },
  { id: 'urea', product: 'Urea (46% N)', activeIngredients: ['urea'], moleculeKeys: ['urea'], formulation: 'granular', category: 'nutrient', resistanceRisk: 'low' },
  { id: 'zinc-sulphate', product: 'Zinc sulphate', activeIngredients: ['zinc sulphate'], moleculeKeys: ['zinc'], formulation: 'SP', category: 'nutrient', resistanceRisk: 'low' },
  { id: 'naa', product: 'NAA (α-naphthaleneacetic acid)', activeIngredients: ['NAA'], moleculeKeys: ['naa'], formulation: 'SL', category: 'growth_regulator', resistanceRisk: 'low' },
  // ── Banned / withdrawn (kept so history & imports are flagged) ─────────────
  { id: 'malathion-50ec', product: 'Malathion 50 EC', activeIngredients: ['malathion'], moleculeKeys: ['malathion'], formulation: 'EC', category: 'insecticide', iracGroup: '1B', resistanceRisk: 'medium', appleLabelClaim: false, status: 'banned', statusReference: 'CIBRC S.O. 4294(E), 3 Oct 2023 — apple label claim omitted' },
  { id: 'dimethoate-30ec', product: 'Dimethoate 30 EC', activeIngredients: ['dimethoate'], moleculeKeys: ['dimethoate'], formulation: 'EC', category: 'insecticide', iracGroup: '1B', resistanceRisk: 'medium', appleLabelClaim: false, status: 'banned', statusReference: 'S.O. 4294(E), 2023 — label deleted for fruits & vegetables eaten raw' },
  { id: 'dicofol', product: 'Dicofol', activeIngredients: ['dicofol'], moleculeKeys: ['dicofol'], formulation: 'EC', category: 'miticide', iracGroup: 'UN', resistanceRisk: 'medium', cibrcRegistered: false, appleLabelClaim: false, status: 'banned', statusReference: 'S.O. 4294(E), 2023 — registration cancelled' },
  { id: 'dinocap', product: 'Dinocap', activeIngredients: ['dinocap'], moleculeKeys: ['dinocap'], formulation: 'EC', category: 'fungicide', fracGroup: '29', resistanceRisk: 'medium', cibrcRegistered: false, appleLabelClaim: false, status: 'banned', statusReference: 'S.O. 4294(E), 2023 — registration cancelled' },
  { id: 'methomyl', product: 'Methomyl', activeIngredients: ['methomyl'], moleculeKeys: ['methomyl'], formulation: 'SP', category: 'insecticide', iracGroup: '1A', resistanceRisk: 'medium', cibrcRegistered: false, appleLabelClaim: false, status: 'banned', statusReference: 'S.O. 4294(E), 2023 — registration cancelled' },
  { id: 'monocrotophos-36sl', product: 'Monocrotophos 36 SL', activeIngredients: ['monocrotophos'], moleculeKeys: ['monocrotophos'], formulation: 'SL', category: 'insecticide', iracGroup: '1B', resistanceRisk: 'medium', appleLabelClaim: false, status: 'banned', statusReference: 'S.O. 4294(E), 2023 — discontinued' },
];

export const chemicals: Chemical[] = raw.map((c) => ({
  provenance: c.provenance ?? 'SKUAST-K',
  cibrcRegistered: c.cibrcRegistered ?? true,
  appleLabelClaim: c.appleLabelClaim ?? true,
  status: c.status ?? 'registered',
  ...c,
}));
