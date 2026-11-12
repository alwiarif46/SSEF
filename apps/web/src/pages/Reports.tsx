import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api';
import { Card, Empty, Note, PageHead, Stat, inr, useToast } from '../ui';

interface Season {
  season: number;
  blocks: { id: string; name: string; orchard: string; area_kanal: number | null; sprays: number; boxes: number; revenue_inr: number }[];
  expenses: { category: string; total: number }[];
  totals: { revenueInr: number; costInr: number; marginInr: number; boxes: number };
}

export function Reports() {
  const toast = useToast();
  const [season, setSeason] = useState(new Date().getFullYear());
  const [data, setData] = useState<Season | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Season>(`/v1/reports/season?season=${season}`).then((d) => { setData(d); setErr(null); }).catch((e) => setErr((e as Error).message)); }, [season]);
  const maxRev = Math.max(1, ...(data?.blocks.map((b) => b.revenue_inr) ?? [1]));
  return (
    <>
      <PageHead title="Reports" sub="Season economics and the spray traceability log."
        actions={<>
          <select value={season} onChange={(e) => setSeason(Number(e.target.value))} aria-label="Season" style={{ width: 110 }}>{[0, 1, 2, 3].map((i) => new Date().getFullYear() - i).map((y) => <option key={y}>{y}</option>)}</select>
          <button className="btn primary" onClick={() => downloadFile(`/v1/reports/spray-log.csv?season=${season}`, `spray-log-${season}.csv`).catch((e) => toast((e as Error).message))}>⬇ Spray log (CSV)</button>
        </>} />
      {err && <Note tone="bad">{err}</Note>}
      {data && (
        <div className="stack">
          <div className="grid g4">
            <Stat label="Boxes sold" value={data.totals.boxes.toLocaleString('en-IN')} />
            <Stat label="Revenue" value={inr(data.totals.revenueInr)} />
            <Stat label="Recorded costs" value={inr(data.totals.costInr)} />
            <Stat label="Margin" value={inr(data.totals.marginInr)} />
          </div>
          <div className="grid g2">
            <Card title="By block">
              {data.blocks.length ? (
                <div className="tbl-wrap"><table><thead><tr><th>Block</th><th className="num">Sprays</th><th className="num">Boxes</th><th>Revenue</th></tr></thead><tbody>
                  {data.blocks.map((b) => (
                    <tr key={b.id}><td><b>{b.name}</b><div className="faint">{b.orchard}</div></td><td className="num">{b.sprays}</td><td className="num">{b.boxes}</td>
                      <td><div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8, alignItems: 'center' }}><div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4 }}><div style={{ width: `${(b.revenue_inr / maxRev) * 100}%`, height: '100%', background: 'var(--series-1)', borderRadius: 4 }} /></div><span className="mono" style={{ textAlign: 'right' }}>{inr(b.revenue_inr)}</span></div></td></tr>
                  ))}
                </tbody></table></div>
              ) : <Empty>No blocks.</Empty>}
            </Card>
            <Card title="Costs by category">
              {data.expenses.length ? <table><tbody>{data.expenses.sort((a, b) => b.total - a.total).map((e) => <tr key={e.category}><td>{e.category}</td><td className="num">{inr(e.total)}</td></tr>)}</tbody></table> : <Empty>No expenses recorded for {season}.</Empty>}
            </Card>
          </div>
          <Card title="Traceability log">
            <p className="muted" style={{ margin: 0 }}>The CSV lists every product applied: date, block, stage, active ingredients, FRAC/IRAC group, dose per 100 L, quantity, tank volume, batch and CIBRC registration number (from inventory), operator, compliance flags, override reasons and corrections — suitable for buyers, exporters and audits.</p>
          </Card>
        </div>
      )}
    </>
  );
}
