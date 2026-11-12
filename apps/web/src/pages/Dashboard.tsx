import { Link } from 'react-router-dom';
import { diseaseRisks, wetnessProgress } from '@orchard/domain';
import { useData, today } from '../data';
import { Badge, Card, Empty, Note, PageHead, Stat, fmtDate, severityTone } from '../ui';
import { live, nextStageFor, orchardDaily, orchardHours, stageFor } from '../lib';
import { Meter } from '../charts';
import { session } from '../api';

export function Dashboard() {
  const { tables, ref, loading, refStatus } = useData();
  const orchards = live(tables.orchards);
  const blocks = live(tables.blocks);
  const alerts = live(tables.infection_alerts).filter((a) => !a.acknowledged).sort((a, b) => String(b.window_start).localeCompare(String(a.window_start)));
  const me = session.user();
  const tasks = live(tables.tasks).filter((t) => t.status !== 'done' && t.status !== 'cancelled' && (me?.role !== 'worker' || t.assignee_user_id === me.id || !t.assignee_user_id));
  const date = today();

  if (!loading && !orchards.length)
    return (
      <>
        <PageHead title={`Welcome${me ? `, ${me.name.split(' ')[0]}` : ''}`} sub="Set up your first orchard to get the SKUAST-K spray plan, weather alerts and records." />
        <Card>
          <div className="stack" style={{ alignItems: 'flex-start' }}>
            <ol className="muted" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Add an orchard with its location (latitude/longitude) and elevation — weather and alerts are computed for that exact point.</li>
              <li>Add blocks: traditional or high-density, rootstock, varieties and expected harvest date.</li>
              <li>Open a block to see what the schedule says for the current stage, scaled to your tank.</li>
            </ol>
            {me?.role !== 'worker' && <Link className="btn primary" to="/orchards?new=1">Add orchard</Link>}
          </div>
        </Card>
      </>
    );

  return (
    <>
      <PageHead title="Today" sub={`${fmtDate(date)} · ${ref.version.source.split('(')[0]?.trim()}`} />
      {refStatus !== 'published' && <div style={{ marginBottom: 16 }}><Note tone="info"><span>ⓘ</span><span>Schedule data is <b>{refStatus.replace('_', ' ')}</b> — verify doses against the printed SKUAST-K schedule and product label.</span></Note></div>}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Orchards" value={orchards.length} sub={`${blocks.length} blocks`} />
        <Stat label="Open alerts" value={alerts.length} sub={alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length + ' high priority'} />
        <Stat label="Open tasks" value={tasks.length} sub={tasks.filter((t) => t.due_on && String(t.due_on) < date).length + ' overdue'} />
        <Stat label="Sprays this season" value={live(tables.spray_events).filter((s) => String(s.sprayed_on).startsWith(date.slice(0, 4))).length} />
      </div>

      <div className="grid g2">
        {orchards.map((o) => {
          const stage = stageFor(ref, date, o);
          const next = nextStageFor(ref, date, o);
          const hours = orchardHours(tables, o.id);
          const past = hours.filter((h) => Date.parse(h.time) <= Date.now());
          const risks = diseaseRisks(past);
          const wet = wetnessProgress(past, new Date().toISOString(), { primarySeason: [`${date.slice(0, 4)}-03-15`, `${date.slice(0, 4)}-05-15`] });
          const day = orchardDaily(tables, o.id).find((d) => d.day === date);
          const rain48 = hours.filter((h) => Date.parse(h.time) > Date.now() && Date.parse(h.time) <= Date.now() + 48 * 3_600_000).reduce((s, h) => s + h.precipMm, 0);
          const oAlerts = alerts.filter((a) => a.orchard_id === o.id).slice(0, 3);
          return (
            <Card key={o.id} title={<div><h2><Link to={`/orchards/${o.id}`}>{o.name}</Link></h2><div className="faint">{[o.village, o.district].filter(Boolean).join(', ') || 'No location'}{o.elevation_m ? ` · ${o.elevation_m} m` : ''}</div></div>}
              actions={stage && <Badge tone="brand">{stage.order}. {stage.name}</Badge>}>
              <div className="stack">
                {stage && <div className="muted" style={{ fontSize: '0.9rem' }}>{stage.timingGuidance}</div>}
                {next && <div className="faint">Next: <b>{next.stage.name}</b> in ~{next.inDays} days ({fmtDate(next.start)})</div>}
                <div className="row" style={{ gap: 16 }}>
                  {day ? <span className="mono">🌡 {Math.round(Number(day.min_c)) || 0} to {Math.round(Number(day.max_c)) || 0} °C</span> : <span className="faint">No weather today</span>}
                  {day && <span className="mono">💧 {Number(day.precip_mm).toFixed(1)} mm today</span>}
                  {hours.length > 0 && <span className="mono">Next 48 h: {rain48.toFixed(1)} mm</span>}
                </div>
                {wet && <Note tone={wet.percent >= 100 ? 'bad' : wet.percent >= 60 ? 'warn' : 'info'}><span>🍂</span><span>Leaf wetness {wet.wetHours} h at {wet.meanTempC.toFixed(1)} °C — <b>{wet.percent}%</b> of the {wet.requiredHours} h scab threshold (advisory).</span></Note>}
                {risks.length > 0 && (
                  <div className="stack" style={{ gap: 6 }}>
                    {risks.map((r) => (
                      <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 70px', gap: 8, alignItems: 'center', fontSize: '0.85rem' }} title={r.drivers}>
                        <span>{r.label.split(' / ')[0]}</span>
                        <Meter value={r.score} tone={r.level === 'high' ? 'bad' : r.level === 'moderate' ? 'warn' : 'ok'} />
                        <span className="faint" style={{ textTransform: 'capitalize' }}>{r.level}</span>
                      </div>
                    ))}
                  </div>
                )}
                {oAlerts.length ? oAlerts.map((a) => (
                  <div key={a.id} className={`alert-item ${a.severity}`}>
                    <div className="spread"><b>{a.title}</b><Badge tone={severityTone(String(a.severity))}>{a.severity}</Badge></div>
                    <div className="faint">{a.recommended_action}</div>
                  </div>
                )) : <div className="faint">No open alerts.</div>}
                <div className="row">
                  {live(tables.blocks).filter((b) => b.orchard_id === o.id).map((b) => <Link key={b.id} className="btn sm" to={`/blocks/${b.id}`}>{b.name} →</Link>)}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {tasks.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Open tasks" actions={<Link to="/tasks" className="btn sm">All tasks</Link>}>
            {tasks.slice(0, 6).map((t) => <div key={t.id} className="spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}><span>{t.title}</span><span className="faint">{t.due_on ? `due ${fmtDate(String(t.due_on))}` : ''}</span></div>)}
          </Card>
        </div>
      )}
      {!tasks.length && !alerts.length && orchards.length > 0 && <div style={{ marginTop: 16 }}><Empty>All clear — no open alerts or tasks.</Empty></div>}
    </>
  );
}
