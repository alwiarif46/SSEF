import { useState } from 'react';
import { Link } from 'react-router-dom';
import { session } from '../api';
import { useData } from '../data';
import { Badge, Card, Empty, PageHead, fmtDateTime, severityTone, useToast } from '../ui';
import { live } from '../lib';

const TYPE_LABEL: Record<string, string> = { scab_infection: 'Scab infection', protect_before_rain: 'Protect before rain', codling_moth_dd: 'Codling moth', frost: 'Frost', hail: 'Hail', heat_stress: 'Heat', spray_window: 'Spray window' };

export function Alerts() {
  const { tables, save } = useData();
  const toast = useToast();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const orchards = new Map(live(tables.orchards).map((o) => [o.id, o]));
  const rows = live(tables.infection_alerts).filter((a) => show === 'all' || !a.acknowledged).sort((a, b) => String(b.window_start).localeCompare(String(a.window_start)));
  const ack = async (id: string) => {
    const a = rows.find((x) => x.id === id)!;
    try {
      await save('infection_alerts', { ...a, acknowledged: true, acknowledged_by: session.user()?.id ?? null, acknowledged_at: new Date().toISOString() });
      toast('Alert acknowledged');
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <>
      <PageHead title="Alerts" sub="Computed hourly from orchard weather. Model alerts are advisory until locally calibrated — they never replace the schedule."
        actions={<div className="seg"><button className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>Open</button><button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All</button></div>} />
      {rows.length ? (
        <div className="stack">
          {rows.map((a) => (
            <Card key={a.id}>
              <div className={`alert-item ${a.severity}`} style={{ background: 'transparent', padding: '0 0 0 12px' }}>
                <div className="spread">
                  <div className="row"><b>{a.title}</b><Badge tone={severityTone(String(a.severity))}>{a.severity}</Badge><Badge>{TYPE_LABEL[String(a.type)] ?? a.type}</Badge>{a.advisory && <Badge tone="info">Advisory</Badge>}</div>
                  {!a.acknowledged ? <button className="btn sm" onClick={() => void ack(a.id)}>Acknowledge</button> : <Badge tone="ok">Acknowledged</Badge>}
                </div>
                <div className="faint" style={{ margin: '4px 0' }}><Link to={`/orchards/${a.orchard_id}`}>{orchards.get(String(a.orchard_id))?.name ?? 'Orchard'}</Link> · {fmtDateTime(a.window_start)} → {fmtDateTime(a.window_end)}</div>
                <div>{a.body}</div>
                <div style={{ marginTop: 6 }}><b>Action:</b> {a.recommended_action}</div>
              </div>
            </Card>
          ))}
        </div>
      ) : <Empty>{show === 'open' ? 'No open alerts.' : 'No alerts yet.'}</Empty>}
    </>
  );
}
