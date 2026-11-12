import { useMemo, useRef, useState } from 'react';
import type { WeatherHour } from '@orchard/domain';

/**
 * Weather small multiples: temperature line and rainfall bars share the time axis but each
 * has its own chart (never a dual axis). Crosshair + tooltip on hover.
 */
export function WeatherChart({ hours, now = Date.now() }: { hours: WeatherHour[]; now?: number }) {
  const W = 720, PAD_L = 36, PAD_R = 8;
  const data = useMemo(() => [...hours].sort((a, b) => a.time.localeCompare(b.time)), [hours]);
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  if (data.length < 2) return <div className="empty">No weather yet — the worker fills this in hourly once the orchard has coordinates.</div>;
  const t0 = Date.parse(data[0]!.time), t1 = Date.parse(data.at(-1)!.time);
  const x = (t: string) => PAD_L + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - PAD_L - PAD_R);
  const temps = data.map((d) => d.tempC);
  const tMin = Math.floor(Math.min(...temps) / 5) * 5, tMax = Math.ceil(Math.max(...temps) / 5) * 5 || 5;
  const H1 = 150, H2 = 70;
  const yT = (v: number) => 10 + (1 - (v - tMin) / Math.max(1, tMax - tMin)) * (H1 - 30);
  const pMax = Math.max(2, ...data.map((d) => d.precipMm));
  const yP = (v: number) => (H2 - 18) * (1 - v / pMax) + 4;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(d.time).toFixed(1)},${yT(d.tempC).toFixed(1)}`).join('');
  const istDate = (t: string) => new Date(Date.parse(t) + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const days = data.filter((d, i) => i > 0 && istDate(d.time) !== istDate(data[i - 1]!.time)).filter((d, i, a) => (i === 0 || x(d.time) - x(a[i - 1]!.time) > 44) && x(d.time) < W - 44);
  const barW = Math.max(1.5, (W - PAD_L - PAD_R) / data.length - 1);
  const nowX = now >= t0 && now <= t1 ? PAD_L + ((now - t0) / (t1 - t0)) * (W - PAD_L - PAD_R) : null;
  const h = hover != null ? data[hover] : undefined;

  const onMove = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - PAD_L) / (W - PAD_L - PAD_R)) * (t1 - t0);
    let best = 0;
    for (let i = 0; i < data.length; i++) if (Math.abs(Date.parse(data[i]!.time) - t) < Math.abs(Date.parse(data[best]!.time) - t)) best = i;
    setHover(best);
  };
  const ticks = [tMin, (tMin + tMax) / 2, tMax];

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="legend"><span><i style={{ background: 'var(--series-1)' }} />Temperature °C</span><span><i style={{ background: 'var(--series-3)' }} />Rain mm/h</span><span className="faint">Faded: forecast</span></div>
      <div className="chart" ref={wrap} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Hourly temperature ${Math.min(...temps).toFixed(0)} to ${Math.max(...temps).toFixed(0)} °C and rainfall over ${days.length} days`}>
        <svg viewBox={`0 0 ${W} ${H1}`}>
          {ticks.map((v) => <g key={v}><line x1={PAD_L} x2={W - PAD_R} y1={yT(v)} y2={yT(v)} stroke="var(--grid)" /><text x={PAD_L - 6} y={yT(v) + 4} textAnchor="end">{v}°</text></g>)}
          {days.map((d) => <g key={d.time}><line x1={x(d.time)} x2={x(d.time)} y1={4} y2={H1 - 18} stroke="var(--grid)" /><text x={x(d.time) + 3} y={H1 - 4}>{new Date(d.time).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}</text></g>)}
          {nowX != null && <line x1={nowX} x2={nowX} y1={4} y2={H1 - 18} stroke="var(--text-3)" strokeDasharray="4 3" />}
          <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
          {nowX != null && <rect x={nowX} y={0} width={W - PAD_R - nowX} height={H1 - 18} fill="var(--surface)" opacity={0.35} />}
          {h && <><line x1={x(h.time)} x2={x(h.time)} y1={4} y2={H1 - 18} stroke="var(--text-2)" /><circle cx={x(h.time)} cy={yT(h.tempC)} r={4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} /></>}
        </svg>
        <svg viewBox={`0 0 ${W} ${H2}`}>
          <line x1={PAD_L} x2={W - PAD_R} y1={yP(0)} y2={yP(0)} stroke="var(--grid)" />
          <text x={PAD_L - 6} y={yP(pMax) + 8} textAnchor="end">{pMax.toFixed(0)}</text>
          <text x={PAD_L - 6} y={yP(0)} textAnchor="end">0</text>
          {data.filter((d) => d.precipMm > 0).map((d) => (
            <rect key={d.time} x={x(d.time) - barW / 2} y={yP(d.precipMm)} width={barW} height={Math.max(1, yP(0) - yP(d.precipMm))} rx={1} fill="var(--series-3)" opacity={d.isForecast ? 0.55 : 1} />
          ))}
          {h && <line x1={x(h.time)} x2={x(h.time)} y1={0} y2={yP(0)} stroke="var(--text-2)" />}
        </svg>
        {h && (
          <div className="tip" style={{ left: `${(x(h.time) / W) * 100}%`, top: 0 }}>
            <b>{new Date(h.time).toLocaleString('en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</b>{h.isForecast ? ' · forecast' : ''}<br />
            {h.tempC.toFixed(1)} °C · RH {Math.round(h.rh)}% · {h.precipMm.toFixed(1)} mm
          </div>
        )}
      </div>
    </div>
  );
}

/** Horizontal meter for a 0–100 risk score. */
export function Meter({ value, tone }: { value: number; tone: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--ok)';
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 4, height: 8, overflow: 'hidden' }} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(2, value)}%`, height: '100%', background: color, borderRadius: 4 }} />
    </div>
  );
}
