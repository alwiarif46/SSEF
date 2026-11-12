import type { Chemical, CriticalTemp } from '@orchard/reference';
import { evaluateScab, type ScabOptions } from './scab.js';
import { accumulateDD, CODLING_MOTH_MILESTONES, projectDate } from './degreeDays.js';
import { dailySummaries, normaliseHours, type WeatherHour } from './weather.js';

export type AlertType = 'scab_infection' | 'protect_before_rain' | 'codling_moth_dd' | 'frost' | 'hail' | 'heat_stress' | 'spray_window';

export interface OrchardAlert {
  /** Deterministic key so the worker can upsert without duplicating. */
  dedupeKey: string;
  type: AlertType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  body: string;
  windowStart: string;
  windowEnd: string;
  recommendedAction: string;
  advisory: boolean;
  data?: Record<string, unknown>;
}

export interface AlertContext {
  orchardId: string;
  now: string; // ISO instant
  hours: WeatherHour[]; // observed + forecast
  /** Current phenological stage label for frost critical temps (matches CriticalTemp.stage). */
  phenologyStage?: string;
  criticalTemps?: CriticalTemp[];
  scab?: ScabOptions & { enabled?: boolean };
  codlingMoth?: { biofix?: string; notified?: string[] };
  /** Last protectant fungicide application, used by protect-before-rain. */
  lastFungicide?: { date: string; chemical?: Chemical };
  /** True while foliage/fruit is scab-susceptible (green tip → leaf fall). */
  scabSusceptible?: boolean;
}

const HOUR = 3_600_000;

/** Protectant residual guidance: re-cover after ~7 days of growth or ~25 mm of cumulative rain. */
export const PROTECTANT_RESIDUAL_DAYS = 7;
export const WASHOFF_RAIN_MM = 25;

export function generateAlerts(ctx: AlertContext): OrchardAlert[] {
  const out: OrchardAlert[] = [];
  const hours = normaliseHours(ctx.hours);
  const nowMs = Date.parse(ctx.now);
  const forecast48 = hours.filter((h) => Date.parse(h.time) > nowMs && Date.parse(h.time) <= nowMs + 48 * HOUR);

  // 1. Scab infection periods (observed or forecast). Advisory until calibrated.
  if (ctx.scab?.enabled !== false && ctx.scabSusceptible !== false) {
    const recent = hours.filter((h) => Date.parse(h.time) >= nowMs - 7 * 24 * HOUR);
    for (const inf of evaluateScab(recent, ctx.scab)) {
      const day = inf.start.slice(0, 13);
      out.push({
        dedupeKey: `${ctx.orchardId}:scab:${day}`,
        type: 'scab_infection',
        severity: inf.severity === 'severe' ? 'critical' : inf.severity === 'moderate' ? 'high' : 'medium',
        title: `${inf.forecast ? 'Forecast' : 'Likely'} ${inf.severity} ${inf.type} scab infection`,
        body: `${inf.wetHours} h leaf wetness at mean ${inf.meanTempC} °C (needs ${inf.requiredHours} h). Symptoms expected around ${inf.symptomsExpected}.`,
        windowStart: inf.start,
        windowEnd: inf.end,
        recommendedAction: inf.forecast
          ? 'Apply a protectant fungicide from the current stage before the wet period starts.'
          : `If unprotected, a post-infection fungicide may still act: ${inf.curativeDeadlines.map((d) => `${d.class} until ${d.until.slice(0, 16).replace('T', ' ')} UTC`).join('; ')}. Rotate FRAC groups.`,
        advisory: inf.advisory,
        data: { ...inf },
      });
    }
  }

  // 2. Protect before rain.
  const rain48 = forecast48.reduce((s, h) => s + h.precipMm, 0);
  if (ctx.scabSusceptible && rain48 >= 2) {
    const last = ctx.lastFungicide?.date;
    const sinceMs = last ? Date.parse(last) : 0;
    const rainSince = hours.filter((h) => Date.parse(h.time) >= sinceMs && Date.parse(h.time) <= nowMs).reduce((s, h) => s + h.precipMm, 0);
    const daysSince = last ? (nowMs - sinceMs) / (24 * HOUR) : Infinity;
    const residual = ctx.lastFungicide?.chemical?.resistanceRisk === 'low' ? PROTECTANT_RESIDUAL_DAYS : PROTECTANT_RESIDUAL_DAYS + 3;
    if (daysSince > residual || rainSince >= WASHOFF_RAIN_MM) {
      const firstRain = forecast48.find((h) => h.precipMm >= 0.2);
      out.push({
        dedupeKey: `${ctx.orchardId}:rain:${(firstRain?.time ?? ctx.now).slice(0, 10)}`,
        type: 'protect_before_rain',
        severity: rain48 >= 10 ? 'high' : 'medium',
        title: 'Protect before rain',
        body: `${rain48.toFixed(1)} mm rain forecast in 48 h; last fungicide ${last ? `${Math.floor(daysSince)} days ago with ${rainSince.toFixed(0)} mm since` : 'not recorded'}.`,
        windowStart: ctx.now,
        windowEnd: firstRain?.time ?? new Date(nowMs + 48 * HOUR).toISOString(),
        recommendedAction: 'Spray the due stage protectant and allow it to dry (≥ 2–4 h) before rain.',
        advisory: false,
        data: { rain48, rainSince, daysSince },
      });
    }
  }

  // 3. Frost by phenological stage critical temperature.
  if (ctx.phenologyStage && ctx.criticalTemps) {
    const ct = ctx.criticalTemps.find((c) => c.stage === ctx.phenologyStage);
    if (ct) {
      const cold = forecast48.filter((h) => h.tempC <= ct.kill10C + 1);
      if (cold.length) {
        const min = Math.min(...cold.map((h) => h.tempC));
        const worst = cold.find((h) => h.tempC === min)!;
        out.push({
          dedupeKey: `${ctx.orchardId}:frost:${worst.time.slice(0, 10)}`,
          type: 'frost',
          severity: min <= ct.kill90C ? 'critical' : min <= ct.kill10C ? 'high' : 'medium',
          title: `Frost risk at ${ctx.phenologyStage}`,
          body: `Forecast low ${min.toFixed(1)} °C. Critical: 10% kill ${ct.kill10C} °C, 90% kill ${ct.kill90C} °C.`,
          windowStart: cold[0]!.time,
          windowEnd: cold.at(-1)!.time,
          recommendedAction: 'Irrigate the orchard floor the evening before, keep the floor mown and bare, use smudging/wind where available; avoid sprays that stress blossoms.',
          advisory: false,
          data: { min, ...ct },
        });
      }
    }
  }

  // 4. Hail (WMO 96/99) or violent convective rain.
  const hail = forecast48.filter((h) => h.weatherCode === 96 || h.weatherCode === 99);
  if (hail.length)
    out.push({
      dedupeKey: `${ctx.orchardId}:hail:${hail[0]!.time.slice(0, 10)}`,
      type: 'hail',
      severity: 'high',
      title: 'Hailstorm risk',
      body: `Thunderstorm with hail forecast from ${hail[0]!.time.slice(0, 16).replace('T', ' ')} UTC.`,
      windowStart: hail[0]!.time,
      windowEnd: hail.at(-1)!.time,
      recommendedAction: 'Close/deploy anti-hail nets. After hail, apply a protective fungicide within 24 h to protect wounds (scab, canker).',
      advisory: false,
    });

  // 5. Codling moth degree-day milestones (Ladakh/Kargil, wherever biofix is set).
  if (ctx.codlingMoth?.biofix) {
    const days = dailySummaries(hours.filter((h) => !h.isForecast && Date.parse(h.time) <= nowMs));
    const res = accumulateDD(days, ctx.codlingMoth.biofix);
    const cum = res.at(-1)?.cumulative ?? 0;
    const notified = new Set(ctx.codlingMoth.notified ?? []);
    for (const m of CODLING_MOTH_MILESTONES) {
      if (notified.has(m.key)) continue;
      const proj = projectDate(res, m.dd);
      if (cum >= m.dd || (proj && proj.days <= 5)) {
        out.push({
          dedupeKey: `${ctx.orchardId}:cm:${ctx.codlingMoth.biofix}:${m.key}`,
          type: 'codling_moth_dd',
          severity: m.action ? 'high' : 'low',
          title: cum >= m.dd ? `Codling moth: ${m.label}` : `Codling moth: ${m.label} in ~${proj!.days} days`,
          body: `${Math.round(cum)} °F-days since biofix ${ctx.codlingMoth.biofix} (target ${m.dd}).`,
          windowStart: ctx.now,
          windowEnd: proj?.date ? `${proj.date}T23:59:59.000Z` : ctx.now,
          recommendedAction: m.action ?? 'Keep monitoring pheromone traps.',
          advisory: true,
          data: { cumulative: cum, milestone: m.key },
        });
        break; // one milestone alert at a time
      }
    }
  }

  // 6. Spray window: next 12 h dry, wind < 15 km/h, temp 10–30 °C.
  const next12 = forecast48.filter((h) => Date.parse(h.time) <= nowMs + 12 * HOUR);
  if (next12.length >= 6 && rain48 >= 2) {
    const ok = next12.filter((h) => h.precipMm < 0.1 && (h.windKph ?? 0) < 15 && h.tempC >= 10 && h.tempC <= 30);
    if (ok.length >= 4)
      out.push({
        dedupeKey: `${ctx.orchardId}:window:${ok[0]!.time.slice(0, 13)}`,
        type: 'spray_window',
        severity: 'low',
        title: 'Good spray window before rain',
        body: `${ok.length} suitable hours from ${ok[0]!.time.slice(11, 16)} UTC (dry, calm, 10–30 °C).`,
        windowStart: ok[0]!.time,
        windowEnd: ok.at(-1)!.time,
        recommendedAction: 'Spray in this window so deposits dry before rain.',
        advisory: false,
      });
  }

  // 7. Heat stress / sunburn (> 35 °C) — supplementary.
  const hot = forecast48.filter((h) => h.tempC >= 35);
  if (hot.length)
    out.push({
      dedupeKey: `${ctx.orchardId}:heat:${hot[0]!.time.slice(0, 10)}`,
      type: 'heat_stress',
      severity: 'medium',
      title: 'Heat stress / sunburn risk',
      body: `Up to ${Math.max(...hot.map((h) => h.tempC)).toFixed(0)} °C forecast.`,
      windowStart: hot[0]!.time,
      windowEnd: hot.at(-1)!.time,
      recommendedAction: 'Irrigate; avoid oil and sulphur sprays above 32 °C; spray only early morning or evening.',
      advisory: true,
    });

  return out;
}
