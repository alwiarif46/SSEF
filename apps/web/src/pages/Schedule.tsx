import { useMemo, useState } from 'react';
import { GENERAL_INSTRUCTIONS_2026 } from '@orchard/reference';
import { regulatoryImpact } from '@orchard/domain';
import { useData } from '../data';
import { Badge, Card, Field, Note, PageHead } from '../ui';
import { chemName, pestName } from '../lib';

export function Schedule() {
  const { ref, refStatus } = useData();
  const impact = useMemo(() => regulatoryImpact(ref), [ref]);
  return (
    <>
      <PageHead title="Spray schedule" sub={<>{ref.version.source} · <Badge tone={refStatus === 'published' ? 'ok' : 'warn'}>{refStatus.replace('_', ' ')}</Badge></>} />
      <div className="stack">
        <Note tone="info">{ref.version.disclaimer}</Note>
        {impact.length > 0 && <Note tone="bad"><span>⚑</span><span><b>Regulatory changes affect {impact.length} schedule entries.</b> {impact.map((i) => `${i.stage}: ${i.affected.map((a) => a.product).join(', ')}`).join(' · ')}</span></Note>}
        <Card title="General instructions (SKUAST-K)">
          <ol style={{ margin: 0, paddingLeft: 20 }}>{GENERAL_INSTRUCTIONS_2026.map((g) => <li key={g} style={{ margin: '3px 0' }}>{g}</li>)}</ol>
        </Card>
        {ref.stages.map((s) => {
          const recs = ref.recommendations.filter((r) => r.stageId === s.id);
          return (
            <Card key={s.id} title={<div><h2>{s.order}. {s.name}</h2><div className="faint">~{s.windowStart.replace('-', '/')} → {s.windowEnd.replace('-', '/')} at 1,700 m · {s.phenology}</div></div>} actions={s.pollinatorSensitive && <Badge tone="warn">Bloom — no insecticides</Badge>}>
              <div className="stack">
                <div className="muted">{s.timingGuidance}</div>
                {recs.map((r) => (
                  <div key={r.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div className="row"><b style={{ textTransform: 'capitalize' }}>{r.category.replace('_', ' ')}</b>{r.needBased && <Badge>Need-based</Badge>}{r.skipForScabResistant && <Badge tone="ok">Skipped for Rvi6</Badge>}<span className="faint">{r.target.map((t) => pestName(ref, t)).join(', ')}</span></div>
                    {r.notes && <div className="faint">{r.notes}</div>}
                    <div className="row" style={{ marginTop: 6 }}>{r.options.map((o) => <span key={o.chemicalId} className="badge">{chemName(ref, o.chemicalId)} · {o.dosePer100L} {o.doseUnit}/100 L</span>)}</div>
                  </div>
                ))}
                {s.culturalPractices.length > 0 && <div className="faint">Cultural: {s.culturalPractices.join(' · ')}</div>}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

export function Chemicals() {
  const { ref } = useData();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const rows = ref.chemicals.filter((c) => (!cat || c.category === cat) && (!q || `${c.product} ${c.activeIngredients.join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  const cats = [...new Set(ref.chemicals.map((c) => c.category))];
  return (
    <>
      <PageHead title="Chemical catalogue" sub="CIBRC status, apple label claim, resistance groups and pre-harvest intervals (the longer of SKUAST-K and CIBRC label)." />
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <Field label="Search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="captan, difenoconazole…" /></Field>
          <Field label="Category"><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Product</th><th>Category</th><th>Group</th><th>Resistance risk</th><th className="num">PHI</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.product}</b><div className="faint">{c.activeIngredients.join(' + ')}</div></td>
                  <td style={{ textTransform: 'capitalize' }}>{c.category.replace('_', ' ')}</td>
                  <td>{c.fracGroup ? `FRAC ${c.fracGroup}` : c.iracGroup ? `IRAC ${c.iracGroup}` : '—'}</td>
                  <td><Badge tone={c.resistanceRisk === 'high' ? 'bad' : c.resistanceRisk === 'medium' ? 'warn' : 'ok'}>{c.resistanceRisk}</Badge></td>
                  <td className="num">{c.phiDays != null ? `${c.phiDays} d` : '—'}</td>
                  <td><Badge tone={c.status === 'banned' ? 'bad' : c.status === 'registered' ? 'ok' : 'warn'}>{c.status}</Badge>{!c.appleLabelClaim && c.status !== 'banned' && <div className="faint">no apple label</div>}{c.provenance === 'SUPPLEMENTARY' && <div><Badge tone="info">supplementary</Badge></div>}</td>
                  <td className="faint" style={{ maxWidth: 340 }}>{[c.statusReference, c.statusNote].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
