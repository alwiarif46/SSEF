/**
 * Kashmir land & produce units. J&K revenue usage: 1 kanal = 20 marla; 8 kanal ≈ 1 acre.
 * 1 kanal (J&K) = 505.857 m²; 1 marla = 25.29 m².
 */
export const M2_PER_KANAL = 505.857;
export const M2_PER_MARLA = M2_PER_KANAL / 20;
export const M2_PER_ACRE = 4046.856;
export const M2_PER_HECTARE = 10_000;

export const kanalToM2 = (k: number) => k * M2_PER_KANAL;
export const m2ToKanal = (m2: number) => m2 / M2_PER_KANAL;
export const kanalToHectare = (k: number) => kanalToM2(k) / M2_PER_HECTARE;
export const hectareToKanal = (ha: number) => m2ToKanal(ha * M2_PER_HECTARE);
export const kanalToAcre = (k: number) => kanalToM2(k) / M2_PER_ACRE;
export const marlaToKanal = (m: number) => m / 20;

export const cToF = (c: number) => (c * 9) / 5 + 32;
export const fToC = (f: number) => ((f - 32) * 5) / 9;

/** Trees per kanal for a plant × row spacing in metres. */
export function treesPerKanal(plantSpacingM: number, rowSpacingM: number): number {
  if (plantSpacingM <= 0 || rowSpacingM <= 0) throw new RangeError('spacing must be positive');
  return Math.floor(M2_PER_KANAL / (plantSpacingM * rowSpacingM));
}

export const round = (n: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};
