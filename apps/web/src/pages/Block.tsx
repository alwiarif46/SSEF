import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  planStage, validateSpray, isBlocked, scaleDose, sprayVolumeLitres, fertiliserForStage, assessMaturity, hdpFertigationSplit, type PlannedRecommendation, type Violation,
} from '@orchard/domain';
import { MITE_THRESHOLDS, BOX_TYPES, MANDIS, GRADES } from '@orchard/reference';
import { session } from '../api';
import { newId, today, useData, SaveError, type Row } from '../data';
import { Badge, Card, Dialog, Empty, Field, Note, PageHead, Tabs, fmtDate, inr, useToast } from '../ui';
import { SYSTEM_LABEL, chemName, live, pestName, planContext, stageFor, stageName, varietyName } from '../lib';
import { BlockForm } from './Orchards';

type Tab = 'plan' | 'sprays' | 'scouting' | 'phenology' | 'nutrients' | 'harvest';

export function BlockDetail() {
  const { id = '' } = useParams();
  const { tables, ref } = useData();
  const block = live(tables.blocks).find((b) => b.id === id);
  const orchard = live(tables.orchards).find((o) => o.id === block?.orchard_id);
  const [tab, setTab] = useState<Tab>('plan');
  const [edit, setEdit] = useState(false);
  if (!block) return <Empty>Block not found. <Link to="/orchards">Back</Link></Empty>;
  const stage = stageFor(ref, today(), orchard, block);
  const mix = (block.variety_mix as { varietyId: string; trees: number }[]) ?? [];
  return (
    <>
      <PageHead
        title={`${block.name}`}
        sub={<><Link to={`/orchards/${orchard?.id}`}>{orchard?.name}</Link> · {SYSTEM_LABEL[String(block.system_type)]} · {ref.rootstocks.find((r) => r.id === block.rootstock_id)?.name ?? '—'} · {block.tree_count ?? '?'} trees · {mix.map((m) => varietyName(ref, m.varietyId)).join(', ')} · harvest {fmtDate(block.expected_harvest_date)}</>}
        actions={<>{stage && <Badge tone="brand">Now: {stage.name}</Badge>}{session.user()?.role !== 'worker' && <button className="btn" onClick={() => setEdit(true)}>Edit block</button>}</>}
      />
      {!block.expected_harvest_date && <div style={{ marginBottom: 12 }}><Note tone="warn">Set an expected harvest date on this block — pre-harvest interval checks depend on it.</Note></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'plan', label: 'Spray plan' }, { id: 'sprays', label: 'Spray records' }, { id: 'scouting', label: 'Scouting' }, { id: 'phenology', label: 'Phenology' }, { id: 'nutrients', label: 'Nutrients' }, { id: 'harvest', label: 'Harvest' }]} />
      {tab === 'plan' && <PlanTab block={block} orchard={orchard} />}
      {tab === 'sprays' && <SprayRecords block={block} />}
      {tab === 'scouting' && <ScoutingTab block={block} stageId={stage?.id} />}
      {tab === 'phenology' && <PhenologyTab block={block} />}
      {tab === 'nutrients' && <NutrientTab block={block} stageId={stage?.id} />}
      {tab === 'harvest' && <HarvestTab block={block} />}
      {edit && <Dialog title="Edit block" onClose={() => setEdit(false)}><BlockForm orchardId={String(block.orchard_id)} block={block} onDone={() => setEdit(false)} /></Dialog>}
    </>
  );
}

const STATUS: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'info' | ''; label: string }> = {
  due: { tone: 'bad', label: 'Due' }, conditional: { tone: 'warn', label: 'Check first' }, not_needed: { tone: '', label: 'Not needed' }, done: { tone: 'ok', label: 'Done' }, skipped_resistant: { tone: 'ok', label: 'Skipped (resistant)' },
};

function ViolationList({ v }: { v: Violation[] }) {
  if (!v.length) return null;
  return <ul className="v-list">{v.map((x, i) => <li key={i} className={x.severity}>{x.message}</li>)}</ul>;
}

function PlanTab({ block, orchard }: { block: Row; orchard?: Row }) {
  const { tables, ref } = useData();
  const [date, setDate] = useState(today());
  const auto = stageFor(ref, date, orchard, block);
  const [stageId, setStageId] = useState<string>('');
  const sid = stageId || auto?.id || ref.stages[0]!.id;
  const stage = ref.stages.find((s) => s.id === sid)!;
  const [tank, setTank] = useState(200);
  const age = block.planting_year ? Math.max(1, Number(date.slice(0, 4)) - Number(block.planting_year)) : undefined;
  const totalL = block.tree_count ? sprayVolumeLitres({ trees: Number(block.tree_count), system: block.system_type === 'hdp' ? 'hdp' : block.system_type === 'medium_density' ? 'medium_density' : 'traditional', ...(age ? { treeAgeYears: age } : {}) }) : null;
  const plan = useMemo(() => planStage(ref, sid, planContext(tables, ref, block, date, tank)), [ref, sid, tables, block, date, tank]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [record, setRecord] = useState<PlannedRecommendation[] | null>(null);
  const pick = (recId: string, chemId: string) => setPicks((p) => ({ ...p, [recId]: p[recId] === chemId ? '' : chemId }));
  const chosen = plan.filter((p) => picks[p.recommendation.id]);

  return (
    <div className="stack">
      <Card>
        <div className="form-grid">
          <Field label="Spray date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Stage"><select value={sid} onChange={(e) => setStageId(e.target.value)}>{ref.stages.map((s) => <option key={s.id} value={s.id}>{s.order}. {s.name}{s.id === auto?.id ? ' (current)' : ''}</option>)}</select></Field>
          <Field label="Tank size (litres)"><input type="number" min={1} max={20000} value={tank} onChange={(e) => setTank(Math.max(1, Number(e.target.value) || 1))} /></Field>
          <div className="f"><span>Spray liquid for block</span><div style={{ paddingTop: 8 }}>{totalL ? <><b className="mono">{totalL.toLocaleString('en-IN')} L</b> <span className="faint">≈ {Math.ceil(totalL / tank)} tank fills</span></> : <span className="faint">add tree count</span>}</div></div>
        </div>
      </Card>
      <Card title={<div><h2>{stage.order}. {stage.name}</h2><div className="faint">{stage.phenology}</div></div>} actions={<Badge tone="brand">SKUAST-K</Badge>}>
        <div className="stack">
          <div className="muted">{stage.timingGuidance}</div>
          {stage.pollinatorSensitive && <Note tone="warn">Bloom: no insecticides or miticides — protect pollinators. Inform nearby beekeepers.</Note>}
          {stage.culturalPractices.length > 0 && <div><h3>Cultural practices</h3><ul className="muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{stage.culturalPractices.map((c) => <li key={c}>{c}</li>)}</ul></div>}
          {!plan.length && <div className="faint">No sprays at this stage.</div>}
        </div>
      </Card>
      {plan.map((p) => (
        <Card key={p.recommendation.id} title={<div className="row"><h2 style={{ textTransform: 'capitalize' }}>{p.recommendation.category.replace('_', ' ')}</h2><Badge tone={STATUS[p.status]!.tone}>{STATUS[p.status]!.label}</Badge>{p.recommendation.needBased && <Badge>Need-based</Badge>}{p.supplementary && <Badge tone="info">Supplementary</Badge>}</div>}
          actions={<span className="faint">{p.recommendation.target.map((t) => pestName(ref, t)).join(', ')}</span>}>
          <div className="stack" style={{ gap: 8 }}>
            <div className="muted" style={{ fontSize: '0.9rem' }}>{p.reason}{p.recommendation.notes && p.recommendation.notes !== p.reason ? ` · ${p.recommendation.notes}` : ''}</div>
            <div className="faint">Use any ONE product. Official dose per 100 L, scaled to a {tank} L tank.</div>
            {p.options.map((o) => {
              const on = picks[p.recommendation.id] === o.chemical.id;
              return (
                <label key={o.chemical.id} className={`opt ${o.eligible ? '' : 'blocked'} ${on ? 'pick' : ''}`}>
                  <input type="checkbox" disabled={!o.eligible} checked={on} onChange={() => pick(p.recommendation.id, o.chemical.id)} aria-label={`Select ${o.chemical.product}`} />
                  <div>
                    <div className="row"><b>{o.chemical.product}</b>{o.preferred && <Badge tone="ok">Suggested</Badge>}{!o.eligible && <Badge tone="bad">Blocked</Badge>}
                      {o.chemical.fracGroup && <Badge>FRAC {o.chemical.fracGroup}</Badge>}{o.chemical.iracGroup && <Badge>IRAC {o.chemical.iracGroup}</Badge>}{o.chemical.phiDays != null && <Badge>PHI {o.chemical.phiDays} d</Badge>}{o.chemical.status === 'watch' && <Badge tone="warn">Watch list</Badge>}</div>
                    <ViolationList v={o.violations} />
                  </div>
                  <div className="dose"><b>{o.dose.display}</b><div className="faint">{o.dose.officialPer100L} {o.dose.unit}/100 L</div></div>
                </label>
              );
            })}
          </div>
        </Card>
      ))}
      {chosen.length > 0 && (
        <div style={{ position: 'sticky', bottom: 12 }}>
          <Card><div className="spread"><span><b>{chosen.length}</b> product{chosen.length > 1 ? 's' : ''} selected</span><button className="btn primary" onClick={() => setRecord(chosen)}>Record this spray →</button></div></Card>
        </div>
      )}
      <p className="faint">{ref.version.disclaimer}</p>
      {record && (
        <Dialog title="Record spray" onClose={() => setRecord(null)}>
          <RecordSpray block={block} date={date} stageId={sid} tank={tank} totalL={totalL ?? tank} items={record.map((p) => {
            const o = p.options.find((x) => x.chemical.id === picks[p.recommendation.id])!;
            const opt = p.recommendation.options.find((x) => x.chemicalId === o.chemical.id)!;
            return opt;
          })} onDone={() => { setRecord(null); setPicks({}); }} />
        </Dialog>
      )}
    </div>
  );
}

function RecordSpray({ block, date: d0, stageId, tank, totalL, items, corrects, onDone }: { block: Row; date: string; stageId: string; tank: number; totalL: number; items: { chemicalId: string; dosePer100L: number; doseUnit: 'g' | 'ml' | 'kg' | 'l' }[]; corrects?: Row; onDone: () => void }) {
  const { tables, ref, save } = useData();
  const toast = useToast();
  const [date, setDate] = useState(d0);
  const [litres, setLitres] = useState(totalL);
  const [tankL, setTankL] = useState(tank);
  const [override, setOverride] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const history = live(tables.spray_events).filter((s) => s.block_id === block.id && s.id !== corrects?.id && s.id !== corrects?.corrects_id)
    .map((s) => ({ date: String(s.sprayed_on), chemicalIds: ((s.products as { chemicalId: string }[]) ?? []).map((p) => p.chemicalId) }));
  const v = validateSpray({ date, chemicalIds: items.map((i) => i.chemicalId), stageId, ...(block.expected_harvest_date ? { plannedHarvestDate: String(block.expected_harvest_date) } : {}) }, history, ref);
  const blocked = isBlocked(v);
  const warns = v.filter((x) => x.severity === 'warn');
  const products = items.map((i) => { const s = scaleDose(i, Math.max(1, litres)); return { chemicalId: i.chemicalId, dosePer100L: i.dosePer100L, unit: i.doseUnit, quantity: s.quantity, display: s.display }; });
  const stock = (chemId: string) => live(tables.chemical_inventory).filter((x) => x.chemical_id === chemId).reduce((s, x) => s + Number(x.quantity ?? 0), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (blocked && !corrects) return;
    if (warns.length && !override.trim()) { setErr('Give a reason to proceed despite the warnings.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await save('spray_events', {
        id: newId(), block_id: block.id, stage_id: stageId, schedule_version_id: ref.version.id, sprayed_on: date, products: products.map(({ display: _d, ...p }) => p), tank_litres: tankL, total_litres: litres, tank_fills: Math.ceil(litres / tankL),
        operator_user_id: session.user()?.id ?? null, violations: v, override_reason: override || null, notes: notes || null, corrects_id: corrects?.id ?? null,
      }, { isNew: true });
      toast(res.flags.length ? 'Recorded — server flagged compliance issues' : 'Spray recorded and locked');
      onDone();
    } catch (x) {
      setErr(x instanceof SaveError ? x.message : (x as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <form className="stack" onSubmit={submit}>
      {corrects && <Note tone="info">This creates a correction linked to the {fmtDate(corrects.sprayed_on)} record. The original stays in the audit trail.</Note>}
      <div className="form-grid">
        <Field label="Date sprayed"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Total spray liquid (L)"><input type="number" min={1} value={litres} onChange={(e) => setLitres(Number(e.target.value))} /></Field>
        <Field label="Tank size (L)"><input type="number" min={1} value={tankL} onChange={(e) => setTankL(Number(e.target.value))} /></Field>
      </div>
      <table>
        <thead><tr><th>Product</th><th className="num">Per 100 L</th><th className="num">Total needed</th><th className="num">In stock</th></tr></thead>
        <tbody>{products.map((p) => <tr key={p.chemicalId}><td>{chemName(ref, p.chemicalId)}</td><td className="num">{p.dosePer100L} {p.unit}</td><td className="num"><b>{p.display}</b></td><td className="num">{stock(p.chemicalId) || <span className="faint">none</span>}</td></tr>)}</tbody>
      </table>
      <div className="faint">Per tank fill: {items.map((i) => `${chemName(ref, i.chemicalId)} ${scaleDose(i, Math.max(1, tankL)).display}`).join(' · ')}</div>
      {blocked && <Note tone="bad"><span>⛔</span><span><b>Cannot record as planned.</b><ViolationList v={v.filter((x) => x.severity === 'block')} /></span></Note>}
      {warns.length > 0 && <Note tone="warn"><span>⚠</span><span><ViolationList v={warns} /></span></Note>}
      {warns.length > 0 && <Field label="Reason for proceeding (required)"><input value={override} onChange={(e) => setOverride(e.target.value)} /></Field>}
      <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Weather, sprayer, observations" /></Field>
      {err && <Note tone="bad">{err}</Note>}
      <div className="row"><button className="btn primary" disabled={busy || (blocked && !corrects)}>{busy ? 'Saving…' : 'Save spray record'}</button><span className="faint">Records are locked once saved; mistakes are fixed with a linked correction.</span></div>
    </form>
  );
}

function SprayRecords({ block }: { block: Row }) {
  const { tables, ref } = useData();
  const [corr, setCorr] = useState<Row | null>(null);
  const rows = live(tables.spray_events).filter((s) => s.block_id === block.id).sort((a, b) => String(b.sprayed_on).localeCompare(String(a.sprayed_on)));
  const corrected = new Set(rows.map((r) => r.corrects_id).filter(Boolean));
  if (!rows.length) return <Empty>No sprays recorded for this block yet.</Empty>;
  return (
    <Card>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Date</th><th>Stage</th><th>Products</th><th className="num">Liquid</th><th>Checks</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => {
              const vio = ((s.violations as Violation[]) ?? []).filter((v) => v.severity !== 'info');
              return (
                <tr key={s.id} style={corrected.has(s.id) ? { opacity: 0.55 } : {}}>
                  <td>{fmtDate(s.sprayed_on)}{s.corrects_id && <div><Badge tone="info">correction</Badge></div>}{corrected.has(s.id) && <div><Badge>superseded</Badge></div>}</td>
                  <td>{stageName(ref, s.stage_id)}</td>
                  <td>{((s.products as { chemicalId: string; quantity?: number; unit?: string; batches?: { batchNo?: string }[] }[]) ?? []).map((p) => <div key={p.chemicalId}>{chemName(ref, p.chemicalId)} <span className="faint">{p.quantity != null ? `${p.quantity} ${p.unit}` : ''}{p.batches?.length ? ` · batch ${p.batches.map((b) => b.batchNo).filter(Boolean).join(', ')}` : ''}</span></div>)}</td>
                  <td className="num">{s.total_litres ? `${s.total_litres} L` : '—'}</td>
                  <td>{vio.length ? vio.map((v, i) => <div key={i}><Badge tone={v.severity === 'block' ? 'bad' : 'warn'}>{v.code.replaceAll('_', ' ').toLowerCase()}</Badge></div>) : <Badge tone="ok">OK</Badge>}{s.override_reason && <div className="faint">Reason: {s.override_reason}</div>}</td>
                  <td>{!s.corrects_id && !corrected.has(s.id) && <button className="btn sm" onClick={() => setCorr(s)}>Correct</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {corr && (
        <Dialog title="Correct spray record" onClose={() => setCorr(null)}>
          <RecordSpray block={block} date={String(corr.sprayed_on)} stageId={String(corr.stage_id ?? '')} tank={Number(corr.tank_litres ?? 200)} totalL={Number(corr.total_litres ?? corr.tank_litres ?? 200)} corrects={corr}
            items={((corr.products as { chemicalId: string; dosePer100L: number; unit: 'g' | 'ml' | 'kg' | 'l' }[]) ?? []).map((p) => ({ chemicalId: p.chemicalId, dosePer100L: p.dosePer100L, doseUnit: p.unit }))} onDone={() => setCorr(null)} />
        </Dialog>
      )}
    </Card>
  );
}

const SCOUT_PESTS = ['european-red-mite', 'two-spotted-mite', 'blossom-thrips', 'san-jose-scale', 'woolly-apple-aphid', 'aphids', 'apple-scab', 'alternaria-leaf-blotch', 'marssonina-blotch', 'powdery-mildew', 'sooty-blotch-flyspeck', 'leaf-blotch-miner', 'fruit-borer', 'root-borer', 'stem-borer', 'canker', 'fire-blight'];

function ScoutingTab({ block, stageId }: { block: Row; stageId?: string }) {
  const { tables, ref, save } = useData();
  const toast = useToast();
  const [f, setF] = useState({ observed_on: today(), pest_id: 'european-red-mite', value: '', severity: '', notes: '', lat: '' as string | number, lng: '' as string | number });
  const [err, setErr] = useState<string | null>(null);
  const pest = ref.pests.find((p) => p.id === f.pest_id);
  const thr = /mite/.test(f.pest_id) && stageId ? MITE_THRESHOLDS[stageId] ?? pest?.actionThreshold : pest?.actionThreshold;
  const rows = live(tables.scouting_observations).filter((s) => s.block_id === block.id).sort((a, b) => String(b.observed_on).localeCompare(String(a.observed_on)));
  const gps = () => navigator.geolocation?.getCurrentPosition((p) => setF((x) => ({ ...x, lat: p.coords.latitude, lng: p.coords.longitude })));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save('scouting_observations', { id: newId(), block_id: block.id, observed_on: f.observed_on, pest_id: f.pest_id, metric: pest?.scoutingMetric ?? 'severity', value: f.value === '' ? null : Number(f.value), severity: f.severity === '' ? null : Number(f.severity), lat: f.lat === '' ? null : Number(f.lat), lng: f.lng === '' ? null : Number(f.lng), photos: [], observer_user_id: session.user()?.id ?? null, notes: f.notes || null }, { isNew: true });
      toast('Observation saved');
      setF({ ...f, value: '', severity: '', notes: '' });
    } catch (x) { setErr((x as Error).message); }
  };
  const over = thr != null && f.value !== '' && Number(f.value) > thr;
  return (
    <div className="grid g2">
      <Card title="New observation">
        <form className="stack" onSubmit={submit}>
          {err && <Note tone="bad">{err}</Note>}
          <div className="form-grid">
            <Field label="Date"><input type="date" value={f.observed_on} onChange={(e) => setF({ ...f, observed_on: e.target.value })} /></Field>
            <Field label="Pest / disease"><select value={f.pest_id} onChange={(e) => setF({ ...f, pest_id: e.target.value })}>{SCOUT_PESTS.map((p) => <option key={p} value={p}>{pestName(ref, p)}</option>)}</select></Field>
            <Field label={pest?.scoutingMetric ? `Count (${pest.scoutingMetric})` : 'Count'}><input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
            <Field label="Severity (0–5)"><input type="number" min={0} max={5} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} /></Field>
          </div>
          {thr != null && <Note tone={over ? 'bad' : 'info'}>{over ? <b>Above action threshold</b> : 'Action threshold'}: {thr} {pest?.thresholdUnit ?? ''}{pest?.thresholdNote ? ` — ${pest.thresholdNote}` : ''}</Note>}
          {pest?.favourableWeather && <div className="faint">Favoured by: {pest.favourableWeather}</div>}
          <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <div className="row"><button className="btn primary">Save</button><button type="button" className="btn" onClick={gps}>📍 {f.lat !== '' ? `${Number(f.lat).toFixed(4)}, ${Number(f.lng).toFixed(4)}` : 'Add GPS'}</button></div>
        </form>
      </Card>
      <Card title="History">
        {rows.length ? <div className="tbl-wrap"><table><thead><tr><th>Date</th><th>Pest</th><th className="num">Count</th><th className="num">Sev.</th></tr></thead><tbody>{rows.map((s) => <tr key={s.id}><td>{fmtDate(s.observed_on)}</td><td>{pestName(ref, String(s.pest_id))}{s.notes && <div className="faint">{s.notes}</div>}</td><td className="num">{s.value ?? '—'}</td><td className="num">{s.severity ?? '—'}</td></tr>)}</tbody></table></div> : <Empty>No observations yet.</Empty>}
      </Card>
    </div>
  );
}

function PhenologyTab({ block }: { block: Row }) {
  const { tables, ref, save } = useData();
  const toast = useToast();
  const [stage, setStage] = useState(ref.stages[1]!.id);
  const [date, setDate] = useState(today());
  const [err, setErr] = useState<string | null>(null);
  const rows = live(tables.phenology_observations).filter((p) => p.block_id === block.id).sort((a, b) => String(b.observed_on).localeCompare(String(a.observed_on)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save('phenology_observations', { id: newId(), block_id: block.id, observed_on: date, stage_id: stage }, { isNew: true });
      if (session.user()?.role !== 'worker') await save('blocks', { ...block, observed_stage_id: stage, ...(stage === 's05-flowering' && !block.full_bloom_date ? { full_bloom_date: date } : {}) });
      toast('Stage recorded');
    } catch (x) { setErr((x as Error).message); }
  };
  return (
    <div className="grid g2">
      <Card title="Record observed stage">
        <form className="stack" onSubmit={submit}>
          {err && <Note tone="bad">{err}</Note>}
          <div className="faint">An observed stage overrides the calendar estimate for this block. Recording Green Tip starts the scab ascospore-maturity model; Flowering sets full bloom (for harvest timing).</div>
          <div className="form-grid">
            <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Stage"><select value={stage} onChange={(e) => setStage(e.target.value)}>{ref.stages.map((s) => <option key={s.id} value={s.id}>{s.order}. {s.name}</option>)}</select></Field>
          </div>
          <div className="faint">{ref.stages.find((s) => s.id === stage)?.phenology}</div>
          <div><button className="btn primary">Save</button></div>
        </form>
      </Card>
      <Card title="Observed stages">{rows.length ? rows.map((r) => <div key={r.id} className="spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}><span>{stageName(ref, String(r.stage_id))}</span><span className="faint">{fmtDate(r.observed_on)}</span></div>) : <Empty>None recorded — the calendar estimate is used.</Empty>}</Card>
    </div>
  );
}

function NutrientTab({ block, stageId }: { block: Row; stageId?: string }) {
  const { tables, save } = useData();
  const toast = useToast();
  const age = block.planting_year ? Math.max(1, new Date().getFullYear() - Number(block.planting_year)) : 10;
  const trees = Number(block.tree_count ?? 0);
  const fert = stageId ? fertiliserForStage(stageId, age, trees) : null;
  const fertigation = block.system_type === 'hdp' && block.planting_year ? hdpFertigationSplit(Number(block.planting_year), new Date().getFullYear()) : null;
  const [f, setF] = useState({ applied_on: today(), product: 'Urea', rate: '', unit: 'kg', method: 'soil', notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const rows = live(tables.nutrient_applications).filter((n) => n.block_id === block.id).sort((a, b) => String(b.applied_on).localeCompare(String(a.applied_on)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save('nutrient_applications', { id: newId(), block_id: block.id, stage_id: stageId ?? null, ...f, rate: Number(f.rate), notes: f.notes || null }, { isNew: true });
      toast('Nutrient application saved');
    } catch (x) { setErr((x as Error).message); }
  };
  return (
    <div className="grid g2">
      <div className="stack">
        <Card title="Fertiliser for this stage">
          {fert ? (
            <div className="stack">
              <div className="faint">Tree age ~{age} years · {trees} trees · SKUAST split (urea ⅓ at green tip, FD-I, FD-III; all DAP and ½ MOP at green tip).</div>
              <table><thead><tr><th></th><th className="num">Per tree</th><th className="num">Whole block</th></tr></thead><tbody>
                <tr><td>FYM</td><td className="num">{fert.perTree.fymKg} kg</td><td className="num">{fert.block.fymKg} kg</td></tr>
                <tr><td>Urea</td><td className="num">{fert.perTree.ureaG} g</td><td className="num">{fert.block.ureaKg} kg</td></tr>
                <tr><td>DAP</td><td className="num">{fert.perTree.dapG} g</td><td className="num">{fert.block.dapKg} kg</td></tr>
                <tr><td>MOP</td><td className="num">{fert.perTree.mopG} g</td><td className="num">{fert.block.mopKg} kg</td></tr>
              </tbody></table>
              <div className="faint">{fert.note}</div>
            </div>
          ) : <div className="muted">No soil fertiliser dose at the current stage. Doses fall at Green Tip, Fruit Development I and III.</div>}
        </Card>
        {fertigation && <Card title="HDP fertigation (supplementary)"><div className="muted">Year {fertigation.year}: {fertigation.splits} weekly splits {fertigation.window[0]} → {fertigation.window[1]}, each N {fertigation.n} g · P₂O₅ {fertigation.p2o5} g · K₂O {fertigation.k2o} g per plant.</div></Card>}
      </div>
      <Card title="Record application">
        <form className="stack" onSubmit={submit}>
          {err && <Note tone="bad">{err}</Note>}
          <div className="form-grid">
            <Field label="Date"><input type="date" value={f.applied_on} onChange={(e) => setF({ ...f, applied_on: e.target.value })} /></Field>
            <Field label="Product"><select value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })}>{['Urea', 'DAP', 'MOP', 'FYM', 'NPK', 'Boron', 'Zinc sulphate', 'Calcium chloride', 'Potassium sulphate', 'Other'].map((p) => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Quantity"><input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} required /></Field>
            <Field label="Unit"><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{['kg', 'g', 'g/L', 'L', 'q'].map((u) => <option key={u}>{u}</option>)}</select></Field>
            <Field label="Method"><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{['soil', 'foliar', 'fertigation'].map((m) => <option key={m}>{m}</option>)}</select></Field>
          </div>
          <div><button className="btn primary">Save</button></div>
        </form>
        {rows.length > 0 && <table style={{ marginTop: 12 }}><thead><tr><th>Date</th><th>Product</th><th className="num">Qty</th><th>Method</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{fmtDate(r.applied_on)}</td><td>{r.product}</td><td className="num">{r.rate} {r.unit}</td><td>{r.method}</td></tr>)}</tbody></table>}
      </Card>
    </div>
  );
}

function HarvestTab({ block }: { block: Row }) {
  const { tables, ref, save } = useData();
  const toast = useToast();
  const mix = (block.variety_mix as { varietyId: string }[]) ?? [];
  const [f, setF] = useState({ picked_on: today(), variety_id: mix[0]?.varietyId ?? 'red-delicious', starch_index: '', tss_brix: '', firmness_lb: '', red_colour_pct: '', seed_brown: '', grade: 'A', box_type: 'wooden', box_count: '', mandi: MANDIS[0]!, price_per_box_inr: '', buyer: '' });
  const [purpose, setPurpose] = useState<'table' | 'ca_storage'>('table');
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => (v === '' ? undefined : Number(v));
  const variety = ref.varieties.find((v) => v.id === f.variety_id);
  const verdict = assessMaturity(
    { date: f.picked_on, ...(n(f.firmness_lb) != null ? { firmnessLb: n(f.firmness_lb)! } : {}), ...(n(f.tss_brix) != null ? { tssBrix: n(f.tss_brix)! } : {}), ...(n(f.starch_index) != null ? { starchIndex: n(f.starch_index)! } : {}), ...(n(f.red_colour_pct) != null ? { redColourPct: n(f.red_colour_pct)! } : {}), ...(n(f.seed_brown) != null ? { seedBrownPct: n(f.seed_brown)! } : {}) },
    { ...(variety ? { variety } : {}), ...(block.full_bloom_date ? { fullBloom: String(block.full_bloom_date) } : {}), purpose },
  );
  const rows = live(tables.harvest_records).filter((h) => h.block_id === block.id).sort((a, b) => String(b.picked_on).localeCompare(String(a.picked_on)));
  const box = BOX_TYPES.find((b) => b.id === f.box_type);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const boxes = Number(f.box_count || 0);
      await save('harvest_records', { id: newId(), block_id: block.id, variety_id: f.variety_id, picked_on: f.picked_on, starch_index: n(f.starch_index) ?? null, tss_brix: n(f.tss_brix) ?? null, firmness_lb: n(f.firmness_lb) ?? null, red_colour_pct: n(f.red_colour_pct) ?? null, grade: f.grade, box_type: f.box_type, box_count: boxes, kg: box ? boxes * box.kg : null, mandi: f.mandi, price_per_box_inr: n(f.price_per_box_inr) ?? null, buyer: f.buyer || null }, { isNew: true });
      toast('Harvest recorded');
      setF({ ...f, box_count: '', price_per_box_inr: '' });
    } catch (x) { setErr((x as Error).message); }
  };
  const totalBoxes = rows.reduce((s, r) => s + Number(r.box_count ?? 0), 0);
  const revenue = rows.reduce((s, r) => s + Number(r.box_count ?? 0) * Number(r.price_per_box_inr ?? 0), 0);
  return (
    <div className="grid g2">
      <Card title="Maturity check & harvest entry" actions={<div className="seg"><button type="button" className={purpose === 'table' ? 'on' : ''} onClick={() => setPurpose('table')}>Table</button><button type="button" className={purpose === 'ca_storage' ? 'on' : ''} onClick={() => setPurpose('ca_storage')}>CA storage</button></div>}>
        <form className="stack" onSubmit={submit}>
          {err && <Note tone="bad">{err}</Note>}
          <div className="form-grid">
            <Field label="Date"><input type="date" value={f.picked_on} onChange={set('picked_on')} /></Field>
            <Field label="Variety"><select value={f.variety_id} onChange={set('variety_id')}>{(mix.length ? mix.map((m) => m.varietyId) : ref.varieties.map((v) => v.id)).map((id) => <option key={id} value={id}>{varietyName(ref, id)}</option>)}</select></Field>
            <Field label="Starch index (1–6)"><input inputMode="decimal" value={f.starch_index} onChange={set('starch_index')} /></Field>
            <Field label="TSS °Brix"><input inputMode="decimal" value={f.tss_brix} onChange={set('tss_brix')} /></Field>
            <Field label="Firmness (lb)"><input inputMode="decimal" value={f.firmness_lb} onChange={set('firmness_lb')} /></Field>
            <Field label="Red colour %"><input inputMode="numeric" value={f.red_colour_pct} onChange={set('red_colour_pct')} /></Field>
            <Field label="Seed brown %"><input inputMode="numeric" value={f.seed_brown} onChange={set('seed_brown')} /></Field>
          </div>
          <Note tone={verdict.ready ? 'ok' : 'warn'}><span>{verdict.ready ? '✓' : '…'}</span><span><b>{verdict.advice}</b>{verdict.dafb != null ? ` · ${verdict.dafb} days after full bloom` : ''}<br />{verdict.checks.filter((c) => c.value != null).map((c) => `${c.index} ${c.value} (${c.target}) ${c.pass ? '✓' : '✗'}`).join(' · ')}</span></Note>
          <h3>Picked fruit</h3>
          <div className="form-grid">
            <Field label="Grade"><select value={f.grade} onChange={set('grade')}>{GRADES.map((g) => <option key={g}>{g}</option>)}</select></Field>
            <Field label="Box"><select value={f.box_type} onChange={set('box_type')}>{BOX_TYPES.map((b) => <option key={b.id} value={b.id}>{b.label} (~{b.kg} kg)</option>)}</select></Field>
            <Field label="Boxes"><input inputMode="numeric" value={f.box_count} onChange={set('box_count')} required /></Field>
            <Field label="Mandi"><select value={f.mandi} onChange={set('mandi')}>{MANDIS.map((m) => <option key={m}>{m}</option>)}</select></Field>
            <Field label="Price per box (₹)"><input inputMode="decimal" value={f.price_per_box_inr} onChange={set('price_per_box_inr')} /></Field>
            <Field label="Buyer / commission agent"><input value={f.buyer} onChange={set('buyer')} /></Field>
          </div>
          <div><button className="btn primary">Save harvest</button></div>
        </form>
      </Card>
      <Card title={`Harvest log · ${totalBoxes} boxes · ${inr(revenue)}`}>
        {rows.length ? <div className="tbl-wrap"><table><thead><tr><th>Date</th><th>Variety</th><th>Grade</th><th className="num">Boxes</th><th>Mandi</th><th className="num">₹/box</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{fmtDate(r.picked_on)}</td><td>{varietyName(ref, String(r.variety_id))}</td><td>{r.grade}</td><td className="num">{r.box_count}</td><td>{r.mandi}</td><td className="num">{inr(r.price_per_box_inr)}</td></tr>)}</tbody></table></div> : <Empty>No harvest recorded yet.</Empty>}
      </Card>
    </div>
  );
}
