import type { WeatherHour } from '../src/weather.js';
/** Build hourly series starting at an IST local time. */
export function series(startIstIso: string, specs: { hours: number; tempC: number; rh: number; precipMm?: number; weatherCode?: number; isForecast?: boolean }[]): WeatherHour[] {
  let t = Date.parse(startIstIso + '+05:30');
  const out: WeatherHour[] = [];
  for (const s of specs)
    for (let i = 0; i < s.hours; i++) {
      out.push({ time: new Date(t).toISOString(), tempC: s.tempC, rh: s.rh, precipMm: s.precipMm ?? 0, weatherCode: s.weatherCode, isForecast: s.isForecast });
      t += 3_600_000;
    }
  return out;
}
