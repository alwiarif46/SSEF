import { useState } from 'react';
import { scaleDose, sprayVolumeLitres, treesPerKanal } from '@orchard/domain';
import { useData } from '../data';
import { Card, Field, PageHead } from '../ui';

export function TankCalc() {
  const { ref } = useData();
  const [chemId, setChemId] = useState('captan-50wp');
  const opts = ref.recommendations.flatMap((r) => r.options).filter((o, i, a) => a.findIndex((x) => x.chemicalId === o.chemicalId) === i);
  const opt = opts.find((o) => o.chemicalId === chemId) ?? opts[0]!;
  const [dose, setDose] = useState<number | ''>('');
  const [tank, setTank] = useState(200);
  const [system, setSystem] = useState<'traditional' | 'hdp' | 'medium_density'>('traditional');
  const [trees, setTrees] = useState(100);
  const [age, setAge] = useState(15);
  const [sp, setSp] = useState({ a: 6, b: 6 });
  const d = { ...opt, dosePer100L: dose === '' ? opt.dosePer100L : Number(dose) };
  const total = sprayVolumeLitres({ trees, system, treeAgeYears: age });
  const perTank = scaleDose(d, Math.max(1, tank));
  const all = scaleDose(d, Math.max(1, total));
  const chem = ref.chemicals.find((c) => c.id === opt.chemicalId);
  return (
    <>
      <PageHead title="Tank calculator" sub="Scale the official per-100-litre dose to your sprayer. The official figure is always shown." />
      <div className="grid g2">
        <Card title="Dose">
          <div className="stack">
            <Field label="Product"><select value={opt.chemicalId} onChange={(e) => { setChemId(e.target.value); setDose(''); }}>{opts.map((o) => <option key={o.chemicalId} value={o.chemicalId}>{ref.chemicals.find((c) => c.id === o.chemicalId)?.product}</option>)}</select></Field>
            <div className="form-grid">
              <Field label={`Official dose (${opt.doseUnit} per 100 L)`}><input type="number" min={0} step="any" value={dose === '' ? opt.dosePer100L : dose} onChange={(e) => setDose(e.target.value === '' ? '' : Number(e.target.value))} /></Field>
              <Field label="Tank size (L)"><input type="number" min={1} value={tank} onChange={(e) => setTank(Number(e.target.value) || 1)} /></Field>
            </div>
            <div className="card" style={{ background: 'var(--surface-2)' }}>
              <div className="faint">Per {tank} L tank</div>
              <div style={{ fontSize: '2rem', fontWeight: 700 }} className="mono">{perTank.display}</div>
              <div className="faint">{chem?.product} · official {d.dosePer100L} {d.doseUnit}/100 L{chem?.phiDays != null ? ` · PHI ${chem.phiDays} days` : ''}</div>
            </div>
          </div>
        </Card>
        <Card title="Spray liquid for the block">
          <div className="stack">
            <div className="form-grid">
              <Field label="System"><select value={system} onChange={(e) => setSystem(e.target.value as typeof system)}><option value="traditional">Traditional</option><option value="medium_density">Medium density</option><option value="hdp">High density (HDP)</option></select></Field>
              <Field label="Trees"><input type="number" min={0} value={trees} onChange={(e) => setTrees(Number(e.target.value))} /></Field>
              <Field label="Tree age (years)"><input type="number" min={1} value={age} onChange={(e) => setAge(Number(e.target.value))} /></Field>
            </div>
            <div className="row" style={{ gap: 24 }}>
              <div className="stat"><div className="v">{total.toLocaleString('en-IN')} L</div><div className="l">spray liquid</div></div>
              <div className="stat"><div className="v">{Math.ceil(total / tank)}</div><div className="l">tank fills</div></div>
              <div className="stat"><div className="v">{all.display}</div><div className="l">product in total</div></div>
            </div>
            <div className="faint">Litres per tree from the Kashmir spray-costing table (traditional 3–15 L, HDP 1–2.5 L by age).</div>
            <h3>Trees per kanal</h3>
            <div className="row">
              <Field label="Plant spacing (m)"><input type="number" step="0.1" min={0.5} value={sp.a} onChange={(e) => setSp({ ...sp, a: Number(e.target.value) })} /></Field>
              <Field label="Row spacing (m)"><input type="number" step="0.1" min={0.5} value={sp.b} onChange={(e) => setSp({ ...sp, b: Number(e.target.value) })} /></Field>
              <div className="stat"><div className="v">{sp.a > 0 && sp.b > 0 ? treesPerKanal(sp.a, sp.b) : '—'}</div><div className="l">trees / kanal</div></div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
