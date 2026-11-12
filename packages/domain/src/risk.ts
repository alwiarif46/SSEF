import { dailySummaries, isWet, normaliseHours, type WeatherHour } from './weather.js';
import { singleSineDD } from './degreeDays.js';

/** Supplementary weather-risk indices (0–100) for Kashmir summer diseases. Advisory only. */
export interface RiskIndex {
  key: 'alternaria' | 'marssonina' | 'powdery_mildew' | 'mite_flare';
  label: string;
  score: number;
  level: 'low' | 'moderate' | 'high';
  drivers: string;
}

const level = (s: number): RiskIndex['level'] => (s >= 65 ? 'high' : s >= 35 ? 'moderate' : 'low');
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Evaluate the last 7 days of hourly weather. */
export function diseaseRisks(raw: WeatherHour[]): RiskIndex[] {
  const hours = normaliseHours(raw).slice(-24 * 7);
  if (!hours.length) return [];
  const days = dailySummaries(hours);
  // Alternaria: wet hours at 20–32 °C (opt 25–30), RH ≥ 92%.
  const altHours = hours.filter((h) => h.tempC >= 20 && h.tempC <= 32 && (h.rh >= 92 || h.precipMm >= 0.2)).length;
  const altOpt = hours.filter((h) => h.tempC >= 25 && h.tempC <= 30 && (h.rh >= 92 || h.precipMm >= 0.2)).length;
  const alternaria = clamp(altHours * 2.5 + altOpt * 2);
  // Marssonina: days with mean > 20 °C and RH > 70%, plus rain days with 18–24 °C.
  const marsDays = days.filter((d) => d.meanC > 20 && d.meanRh > 70).length;
  const marsRain = days.filter((d) => d.precipMm >= 1 && d.meanC >= 16 && d.meanC <= 24).length;
  const marssonina = clamp(marsDays * 12 + marsRain * 10);
  // Powdery mildew: dry-leaf hours at 10–25 °C, RH > 70%.
  const pmHours = hours.filter((h) => h.tempC >= 10 && h.tempC <= 25 && h.rh > 70 && !isWet(h, { rhThreshold: 101 })).length;
  const powdery = clamp(pmHours / 1.2);
  // Mite flare-up: hot dry days, accumulating DD > 12 °C.
  const hotDry = days.filter((d) => d.maxC >= 30 && d.precipMm < 1).length;
  const dd = days.reduce((s, d) => s + singleSineDD(d.minC, d.maxC, 12, 35), 0);
  const mites = clamp(hotDry * 10 + dd * 0.6);
  return [
    { key: 'alternaria', label: 'Alternaria leaf blotch', score: alternaria, level: level(alternaria), drivers: `${altHours} warm-wet hours (${altOpt} at 25–30 °C)` },
    { key: 'marssonina', label: 'Marssonina blotch / premature leaf fall', score: marssonina, level: level(marssonina), drivers: `${marsDays} warm-humid days, ${marsRain} rain days at 16–24 °C` },
    { key: 'powdery_mildew', label: 'Powdery mildew', score: powdery, level: level(powdery), drivers: `${pmHours} humid dry-leaf hours at 10–25 °C` },
    { key: 'mite_flare', label: 'Mite flare-up', score: mites, level: level(mites), drivers: `${hotDry} hot dry days, ${dd.toFixed(0)} DD>12 °C` },
  ];
}
