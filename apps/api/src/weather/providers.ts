import type { WeatherHour } from '@orchard/domain';
import { dewPoint } from '@orchard/domain';
import { config } from '../config.js';

export interface WeatherProvider {
  name: string;
  /** Hourly observations for the past `pastDays` and forecast for `forecastDays`, UTC instants. */
  hourly(lat: number, lng: number, pastDays: number, forecastDays: number, now?: Date): Promise<WeatherHour[]>;
}

type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const defaultFetch: FetchFn = (url) => fetch(url, { signal: AbortSignal.timeout(20_000) });

/**
 * Open-Meteo. The hosted free API is NON-COMMERCIAL only: point `OPEN_METEO_URL` at a self-hosted
 * instance or at customer-api.open-meteo.com with `OPEN_METEO_API_KEY`.
 */
export function openMeteo(baseUrl = config.openMeteoBaseUrl, apiKey = config.openMeteoApiKey, f: FetchFn = defaultFetch): WeatherProvider {
  return {
    name: 'open-meteo',
    async hourly(lat, lng, pastDays, forecastDays, now = new Date()) {
      const q = new URLSearchParams({
        latitude: lat.toFixed(4), longitude: lng.toFixed(4),
        hourly: 'temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,wind_speed_10m,weather_code',
        past_days: String(pastDays), forecast_days: String(forecastDays), timezone: 'GMT', timeformat: 'unixtime',
      });
      if (apiKey) q.set('apikey', apiKey);
      const r = await f(`${baseUrl.replace(/\/$/, '')}/v1/forecast?${q}`);
      if (!r.ok) throw new Error(`open-meteo ${r.status}`);
      const j = (await r.json()) as { hourly: Record<string, (number | null)[]> };
      const h = j.hourly;
      const out: WeatherHour[] = [];
      (h.time ?? []).forEach((t, i) => {
        const temp = h.temperature_2m?.[i];
        const rh = h.relative_humidity_2m?.[i];
        if (t == null || temp == null || rh == null) return;
        const time = new Date(t * 1000).toISOString();
        out.push({
          time, tempC: temp, rh, precipMm: h.precipitation?.[i] ?? 0,
          ...(h.dew_point_2m?.[i] != null ? { dewPointC: h.dew_point_2m[i]! } : {}),
          ...(h.wind_speed_10m?.[i] != null ? { windKph: h.wind_speed_10m[i]! } : {}),
          ...(h.weather_code?.[i] != null ? { weatherCode: h.weather_code[i]! } : {}),
          isForecast: t * 1000 > now.getTime(),
        });
      });
      return out;
    },
  };
}

/** Visual Crossing Timeline API (commercial-cleared tiers). */
export function visualCrossing(key = config.visualCrossingKey, f: FetchFn = defaultFetch): WeatherProvider {
  return {
    name: 'visual-crossing',
    async hourly(lat, lng, pastDays, forecastDays, now = new Date()) {
      const d1 = new Date(now.getTime() - pastDays * 86_400_000).toISOString().slice(0, 10);
      const d2 = new Date(now.getTime() + forecastDays * 86_400_000).toISOString().slice(0, 10);
      const q = new URLSearchParams({ unitGroup: 'metric', include: 'hours', contentType: 'json', elements: 'datetimeEpoch,temp,humidity,dew,precip,windspeed,preciptype,severerisk,conditions' });
      if (key) q.set('key', key);
      const r = await f(`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lng}/${d1}/${d2}?${q}`);
      if (!r.ok) throw new Error(`visual-crossing ${r.status}`);
      const j = (await r.json()) as { days: { hours?: Record<string, unknown>[] }[] };
      const out: WeatherHour[] = [];
      for (const d of j.days ?? [])
        for (const h of d.hours ?? []) {
          const t = Number(h.datetimeEpoch) * 1000;
          const temp = Number(h.temp), rh = Number(h.humidity);
          if (!Number.isFinite(temp) || !Number.isFinite(rh)) continue;
          const types = (h.preciptype as string[] | null) ?? [];
          const severe = Number(h.severerisk ?? 0);
          const thunder = String(h.conditions ?? '').toLowerCase().includes('thunder');
          out.push({
            time: new Date(t).toISOString(), tempC: temp, rh, precipMm: Number(h.precip ?? 0),
            ...(h.dew != null ? { dewPointC: Number(h.dew) } : {}),
            ...(h.windspeed != null ? { windKph: Number(h.windspeed) } : {}),
            ...(thunder || types.includes('ice') ? { weatherCode: severe >= 60 || types.includes('ice') ? 96 : 95 } : {}),
            isForecast: t > now.getTime(),
          });
        }
      return out;
    },
  };
}

/**
 * NASA POWER hourly (free incl. commercial; no forecast) — for historical back-fill and
 * model calibration only. Coarse 0.5° × 0.625° grid.
 */
export async function nasaPowerHistory(lat: number, lng: number, start: string, end: string, f: FetchFn = defaultFetch): Promise<WeatherHour[]> {
  const q = new URLSearchParams({
    parameters: 'T2M,RH2M,T2MDEW,PRECTOTCORR,WS2M', community: 'AG', latitude: String(lat), longitude: String(lng),
    start: start.replaceAll('-', ''), end: end.replaceAll('-', ''), format: 'JSON', 'time-standard': 'UTC',
  });
  const r = await f(`https://power.larc.nasa.gov/api/temporal/hourly/point?${q}`);
  if (!r.ok) throw new Error(`nasa-power ${r.status}`);
  const j = (await r.json()) as { properties: { parameter: Record<string, Record<string, number>> } };
  const P = j.properties.parameter;
  const out: WeatherHour[] = [];
  for (const k of Object.keys(P.T2M ?? {})) {
    const temp = P.T2M![k]!, rh = P.RH2M?.[k];
    if (temp <= -999 || rh == null || rh <= -999) continue;
    const time = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}T${k.slice(8, 10)}:00:00.000Z`;
    const prec = P.PRECTOTCORR?.[k] ?? 0;
    const dew = P.T2MDEW?.[k];
    out.push({ time, tempC: temp, rh, precipMm: prec > 0 ? prec : 0, ...(dew != null && dew > -999 ? { dewPointC: dew } : {}), ...(P.WS2M?.[k] != null ? { windKph: P.WS2M[k]! * 3.6 } : {}) });
  }
  return out;
}

/** Srinagar monthly climatology (°C mean min / mean max, rain days) for the synthetic dev provider. */
const CLIMATE: [number, number, number][] = [
  [-2, 7, 7], [-1, 9, 8], [3, 14, 10], [7, 20, 10], [11, 25, 9], [14, 29, 6],
  [18, 30, 8], [17, 29, 8], [12, 28, 4], [5, 23, 3], [0, 16, 2], [-2, 10, 4],
];

/** Deterministic pseudo-weather for development/demo when no provider key is configured. */
export function synthetic(): WeatherProvider {
  const rand = (n: number) => {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    name: 'synthetic',
    async hourly(lat, lng, pastDays, forecastDays, now = new Date()) {
      const start = Math.floor(now.getTime() / 3_600_000) * 3_600_000 - pastDays * 86_400_000;
      const end = start + (pastDays + forecastDays) * 86_400_000;
      const out: WeatherHour[] = [];
      for (let t = start; t < end; t += 3_600_000) {
        const d = new Date(t);
        const [tmin, tmax, rainDays] = CLIMATE[d.getUTCMonth()]!;
        const day = Math.floor(t / 86_400_000);
        const seed = day + Math.round(lat * 100) + Math.round(lng * 7);
        const rainy = rand(seed) < rainDays / 30;
        const istHour = (d.getUTCHours() + 5.5) % 24;
        const diurnal = (Math.sin(((istHour - 9) / 24) * 2 * Math.PI) + 1) / 2;
        const temp = tmin + (tmax - tmin) * diurnal - (rainy ? 3 : 0) + (rand(seed * 3) - 0.5) * 2;
        const rh = Math.min(100, rainy ? 88 + rand(t) * 12 : 85 - diurnal * 45 + rand(t) * 8);
        const precip = rainy && rand(t / 3_600_000) < 0.6 ? Math.round(rand(t + 1) * 30) / 10 : 0;
        out.push({ time: d.toISOString(), tempC: Math.round(temp * 10) / 10, rh: Math.round(rh), precipMm: precip, dewPointC: Math.round(dewPoint(temp, rh) * 10) / 10, windKph: Math.round(rand(t + 2) * 15), isForecast: t > now.getTime() });
      }
      return out;
    },
  };
}

export function providerFromConfig(): WeatherProvider {
  if (config.weatherProvider === 'open-meteo') return openMeteo();
  if (config.weatherProvider === 'visual-crossing') return visualCrossing();
  return synthetic();
}
