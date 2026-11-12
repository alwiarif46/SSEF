import { createHash } from 'node:crypto';
import {
  currentStage, dailySummaries, detectBiofix, generateAlerts, istDay, normaliseHours, type OrchardAlert, type WeatherHour,
} from '@orchard/domain';
import { STAGE_TO_FROST, type ReferenceBundle } from '@orchard/reference';
import { createPool, withTenant, withoutTenant, type Db, type Tx } from './db.js';
import { providerFromConfig, type WeatherProvider } from './weather/providers.js';
import { loadBundle } from './reference.js';
import { config } from './config.js';
import { sendPending } from './push.js';

const hid = (prefix: string, ...parts: string[]) => `${prefix}-${createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 30)}`;

export interface CycleResult { orchards: number; hours: number; alerts: number; newAlerts: number; errors: { orchardId: string; error: string }[] }

export async function upsertHours(tx: Tx, tenantId: string, orchardId: string, hours: WeatherHour[], source: string) {
  if (!hours.length) return;
  const cols = ['time', 'temp_c', 'rh', 'precip_mm', 'dew_point_c', 'wind_kph', 'weather_code', 'is_forecast'];
  // Batched insert via json_to_recordset keeps one round-trip per orchard.
  await tx.query(
    `INSERT INTO public.weather_hourly (tenant_id, orchard_id, source, ${cols.join(', ')})
     SELECT $1, $2, $3, r.* FROM json_to_recordset($4::json) AS r(time timestamptz, temp_c real, rh real, precip_mm real, dew_point_c real, wind_kph real, weather_code smallint, is_forecast boolean)
     ON CONFLICT (tenant_id, orchard_id, time) DO UPDATE SET temp_c = EXCLUDED.temp_c, rh = EXCLUDED.rh, precip_mm = EXCLUDED.precip_mm,
       dew_point_c = EXCLUDED.dew_point_c, wind_kph = EXCLUDED.wind_kph, weather_code = EXCLUDED.weather_code, is_forecast = EXCLUDED.is_forecast,
       source = EXCLUDED.source, fetched_at = now()
     WHERE public.weather_hourly.is_forecast OR NOT EXCLUDED.is_forecast`,
    [tenantId, orchardId, source, JSON.stringify(hours.map((h) => ({ time: h.time, temp_c: h.tempC, rh: h.rh, precip_mm: h.precipMm, dew_point_c: h.dewPointC ?? null, wind_kph: h.windKph ?? null, weather_code: h.weatherCode ?? null, is_forecast: !!h.isForecast })))],
  );
}

export async function loadHours(tx: Tx, orchardId: string, from: Date): Promise<WeatherHour[]> {
  const { rows } = await tx.query(
    `SELECT time, temp_c, rh, precip_mm, dew_point_c, wind_kph, weather_code, is_forecast FROM public.weather_hourly WHERE orchard_id = $1 AND time >= $2 ORDER BY time`,
    [orchardId, from],
  );
  return rows.map((r) => ({
    time: new Date(r.time).toISOString(), tempC: r.temp_c, rh: r.rh, precipMm: r.precip_mm,
    ...(r.dew_point_c != null ? { dewPointC: r.dew_point_c } : {}), ...(r.wind_kph != null ? { windKph: r.wind_kph } : {}),
    ...(r.weather_code != null ? { weatherCode: r.weather_code } : {}), isForecast: r.is_forecast,
  }));
}

async function writeDaily(tx: Tx, tenantId: string, orchardId: string, hours: WeatherHour[]) {
  const byDay = new Map<string, WeatherHour[]>();
  for (const h of hours) {
    const d = istDay(h.time);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(h);
  }
  for (const s of dailySummaries(hours)) {
    const hs = byDay.get(s.date) ?? [];
    await tx.query(
      `INSERT INTO public.weather_daily (id, tenant_id, orchard_id, day, min_c, max_c, mean_c, precip_mm, mean_rh, is_forecast, hourly)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id, orchard_id, day) DO UPDATE SET min_c = EXCLUDED.min_c, max_c = EXCLUDED.max_c, mean_c = EXCLUDED.mean_c,
         precip_mm = EXCLUDED.precip_mm, mean_rh = EXCLUDED.mean_rh, is_forecast = EXCLUDED.is_forecast, hourly = EXCLUDED.hourly`,
      [hid('wd', orchardId, s.date), tenantId, orchardId, s.date, s.minC, s.maxC, Math.round(s.meanC * 10) / 10, Math.round(s.precipMm * 10) / 10, Math.round(s.meanRh),
        hs.some((h) => h.isForecast), JSON.stringify(hs.map((h) => [h.time.slice(0, 13), h.tempC, h.rh, h.precipMm, h.weatherCode ?? null]))],
    );
  }
}

/** Gather orchard context for the alert engine from tenant data. */
export async function alertContext(tx: Tx, bundle: ReferenceBundle, orchard: { orchard_id: string; elevation_m: number | null }, now: Date) {
  const today = istDay(now);
  const season = today.slice(0, 4);
  const { rows: blocks } = await tx.query(`SELECT id, observed_stage_id FROM public.blocks WHERE orchard_id = $1 AND deleted_at IS NULL`, [orchard.orchard_id]);
  const blockIds = blocks.map((b) => b.id);
  const { rows: phen } = blockIds.length
    ? await tx.query(`SELECT stage_id, observed_on FROM public.phenology_observations WHERE block_id = ANY($1) AND deleted_at IS NULL AND observed_on >= $2 ORDER BY observed_on DESC`, [blockIds, `${season}-01-01`])
    : { rows: [] as { stage_id: string; observed_on: string }[] };
  const observed = phen[0]?.stage_id ?? blocks.find((b) => b.observed_stage_id)?.observed_stage_id;
  const stage = currentStage(bundle.stages, today, { ...(orchard.elevation_m != null ? { elevationM: orchard.elevation_m } : {}), ...(observed ? { observedStageId: observed } : {}) });
  const gt = phen.filter((p) => p.stage_id === 's02-green-tip').at(-1)?.observed_on;

  const fungicideIds = bundle.chemicals.filter((c) => c.category === 'fungicide').map((c) => c.id);
  const { rows: sprays } = blockIds.length
    ? await tx.query(`SELECT sprayed_on, products FROM public.spray_events WHERE block_id = ANY($1) AND deleted_at IS NULL ORDER BY sprayed_on DESC LIMIT 30`, [blockIds])
    : { rows: [] as { sprayed_on: string; products: { chemicalId: string }[] }[] };
  const lastF = sprays.find((s) => (s.products ?? []).some((p: { chemicalId: string }) => fungicideIds.includes(p.chemicalId)));
  const lastFChem = lastF ? bundle.chemicals.find((c) => (lastF.products as { chemicalId: string }[]).some((p) => p.chemicalId === c.id && c.category === 'fungicide')) : undefined;

  const { rows: traps } = await tx.query(`SELECT caught_on, moths, sunset_temp_c FROM public.trap_catches WHERE orchard_id = $1 AND deleted_at IS NULL AND caught_on >= $2 ORDER BY caught_on`, [orchard.orchard_id, `${season}-01-01`]);
  const biofix = detectBiofix(traps.map((t) => ({ date: t.caught_on, moths: Number(t.moths), ...(t.sunset_temp_c != null ? { sunsetTempC: Number(t.sunset_temp_c) } : {}) })));
  const { rows: notifiedRows } = await tx.query(`SELECT data->>'milestone' AS m FROM public.infection_alerts WHERE orchard_id = $1 AND type = 'codling_moth_dd' AND data ? 'milestone' AND dedupe_key LIKE $2`, [orchard.orchard_id, `%:cm:${biofix ?? 'none'}:%`]);

  const order = stage?.order ?? 0;
  return {
    stage,
    ctx: {
      scabSusceptible: order >= 2 && order <= 14,
      ...(stage && STAGE_TO_FROST[stage.id] ? { phenologyStage: STAGE_TO_FROST[stage.id]!, criticalTemps: bundle.criticalTemps } : {}),
      ...(lastF ? { lastFungicide: { date: `${lastF.sprayed_on}T12:00:00.000Z`, ...(lastFChem ? { chemical: lastFChem } : {}) } } : {}),
      ...(biofix ? { codlingMoth: { biofix, notified: notifiedRows.map((r) => r.m) } } : {}),
      scab: gt ? { greenTip: `${gt}T00:00:00.000Z` } : { primarySeason: [`${season}-03-15`, `${season}-05-15`] as [string, string] },
    },
  };
}

export async function upsertAlerts(tx: Tx, tenantId: string, orchardId: string, alerts: OrchardAlert[]) {
  let inserted = 0;
  for (const a of alerts) {
    const id = hid('al', a.dedupeKey);
    const { rows: [r] } = await tx.query(
      `INSERT INTO public.infection_alerts (id, tenant_id, orchard_id, dedupe_key, type, severity, title, body, window_start, window_end, recommended_action, advisory, acknowledged, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13)
       ON CONFLICT (tenant_id, dedupe_key) DO UPDATE SET severity = EXCLUDED.severity, title = EXCLUDED.title, body = EXCLUDED.body,
         window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end, recommended_action = EXCLUDED.recommended_action, data = EXCLUDED.data
       WHERE (public.infection_alerts.severity, public.infection_alerts.body) IS DISTINCT FROM (EXCLUDED.severity, EXCLUDED.body)
       RETURNING (xmax = 0) AS inserted`,
      [id, tenantId, orchardId, a.dedupeKey, a.type, a.severity, a.title, a.body, a.windowStart, a.windowEnd, a.recommendedAction, a.advisory, JSON.stringify(a.data ?? {})],
    );
    if (r?.inserted) {
      inserted++;
      if (a.severity !== 'low')
        await tx.query(`INSERT INTO public.push_outbox (tenant_id, alert_id, title, body, data) VALUES ($1,$2,$3,$4,$5)`, [tenantId, id, a.title, a.body, JSON.stringify({ orchardId, type: a.type })]);
      // Alerts drive tasks: actionable alerts create an open, unassigned task for the manager.
      const actionable =
        a.type === 'protect_before_rain' ||
        (a.type === 'codling_moth_dd' && a.severity === 'high') ||
        (a.type === 'scab_infection' && (a.severity === 'high' || a.severity === 'critical'));
      if (actionable) {
        await tx.query(
          `INSERT INTO public.tasks (id, tenant_id, orchard_id, title, kind, status, alert_id, due_on, notes) VALUES ($1,$2,$3,$4,'spray','open',$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [hid('tk', a.dedupeKey), tenantId, orchardId, a.title, id, a.windowEnd.slice(0, 10), a.recommendedAction],
        );
      }
    }
  }
  return inserted;
}

export async function runCycle(db: Db, provider: WeatherProvider, bundle: ReferenceBundle, now = new Date()): Promise<CycleResult> {
  const res: CycleResult = { orchards: 0, hours: 0, alerts: 0, newAlerts: 0, errors: [] };
  const targets = await withoutTenant(db, async (tx) => (await tx.query('SELECT * FROM app.weather_targets()')).rows);
  for (const o of targets) {
    try {
      const hours = normaliseHours(await provider.hourly(o.lat, o.lng, 2, 5, now));
      await withTenant(db, o.tenant_id, async (tx) => {
        await upsertHours(tx, o.tenant_id, o.orchard_id, hours, provider.name);
        const recent = await loadHours(tx, o.orchard_id, new Date(now.getTime() - 10 * 86_400_000));
        await writeDaily(tx, o.tenant_id, o.orchard_id, recent.filter((h) => Date.parse(h.time) >= now.getTime() - 8 * 86_400_000));
        // Scab PAT needs the season's hours from green tip.
        const season = await loadHours(tx, o.orchard_id, new Date(`${istDay(now).slice(0, 4)}-02-01T00:00:00Z`));
        const { ctx } = await alertContext(tx, bundle, o, now);
        const alerts = generateAlerts({ orchardId: o.orchard_id, now: now.toISOString(), hours: season.length ? season : recent, ...ctx });
        res.alerts += alerts.length;
        res.newAlerts += await upsertAlerts(tx, o.tenant_id, o.orchard_id, alerts);
        res.hours += hours.length;
      });
      res.orchards++;
    } catch (e) {
      res.errors.push({ orchardId: o.orchard_id, error: (e as Error).message });
    }
  }
  return res;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const db = createPool();
  const tick = async () => {
    const bundle = await loadBundle(db);
    const r = await runCycle(db, providerFromConfig(), bundle);
    const p = await sendPending(db);
    console.log(new Date().toISOString(), JSON.stringify({ ...r, pushed: p }));
  };
  await tick();
  if (!process.argv.includes('--once')) setInterval(() => void tick().catch(console.error), config.workerIntervalMin * 60_000);
  else await db.end();
}
