import { Fragment, useState } from 'react';
import { adminApi, type WorkerHealth } from '../api';
import { Badge, Card, Empty, Note, PageHead, Stat, fmtAgo, fmtDateTime, fmtDuration, useLoad } from '../ui';

const HEALTH_LABEL: Record<WorkerHealth, string> = {
  ok: 'Healthy', degraded: 'Degraded', failing: 'Failing', stale: 'Stalled', running: 'Running', unknown: 'No data',
};

export function HealthDot({ status }: { status: WorkerHealth }) {
  return <span className={`health ${status}`}><i aria-hidden />{HEALTH_LABEL[status]}</span>;
}

export function WorkerRuns() {
  const { data, error, loading, reload } = useLoad(() => adminApi.workerRuns(100));
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const runs = data?.runs ?? [];
  const finished = runs.filter((r) => r.finished_at);
  const withErrors = finished.filter((r) => r.errors.length).length;

  return (
    <>
      <PageHead title="Worker runs" sub="Weather ingestion, infection alerts and push delivery — one row per cycle." actions={<button className="btn" onClick={reload}>⟳ Refresh</button>} />
      {error && <Note tone="bad">{error}</Note>}
      {data && (
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Stat label="Health" value={<HealthDot status={data.health.status} />} sub={data.health.message} />
          <Stat label="Last run" value={fmtAgo(data.health.lastRunAt)} sub={`Interval ${data.intervalMin} min`} />
          <Stat label="Runs with errors" value={`${withErrors} / ${finished.length}`} sub="in the runs shown" />
          <Stat label="New alerts (shown runs)" value={finished.reduce((s, r) => s + (r.new_alerts ?? 0), 0)} />
        </div>
      )}
      <Card>
        {loading && !data ? <Empty>Loading…</Empty> : runs.length === 0 ? <Empty>No worker runs recorded yet. Start the worker with <span className="code">npm run worker -w @orchard/api</span>.</Empty> : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th><th>Duration</th><th>Provider</th>
                  <th className="num">Orchards</th><th className="num">Hours</th><th className="num">Alerts</th><th className="num">New</th><th className="num">Pushed</th><th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const expandable = r.errors.length > 0;
                  return (
                    <Fragment key={r.id}>
                      <tr className={expandable ? 'clickable' : ''} onClick={expandable ? () => toggle(r.id) : undefined} aria-expanded={expandable ? open.has(r.id) : undefined}>
                        <td>{fmtDateTime(r.started_at)}</td>
                        <td>{r.finished_at ? fmtDuration(r.started_at, r.finished_at) : <Badge tone="warn">running</Badge>}</td>
                        <td>{r.provider}</td>
                        <td className="num">{r.orchards ?? '—'}</td>
                        <td className="num">{r.hours ?? '—'}</td>
                        <td className="num">{r.alerts ?? '—'}</td>
                        <td className="num">{r.new_alerts ?? '—'}</td>
                        <td className="num">{r.pushed ?? '—'}</td>
                        <td>{expandable ? <Badge tone={r.orchards ? 'warn' : 'bad'}>{open.has(r.id) ? '▾' : '▸'} {r.errors.length} error{r.errors.length > 1 ? 's' : ''}</Badge> : r.finished_at ? <Badge tone="ok">none</Badge> : '—'}</td>
                      </tr>
                      {expandable && open.has(r.id) && (
                        <tr className="detail">
                          <td colSpan={9}>
                            <table>
                              <thead><tr><th>Orchard</th><th>Error</th></tr></thead>
                              <tbody>
                                {r.errors.map((e, i) => (
                                  <tr key={i}><td className="code">{e.orchardId === '*' ? 'whole cycle' : e.orchardId}</td><td className="code">{e.error}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
