import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { accumulateDD, dailySummaries, detectBiofix, harvestFromBloom, kanalToHectare, treesPerKanal, pollinizerCheck } from '@orchard/domain';
import { api, session } from '../api';
import { newId, today, useData, type Row } from '../data';
import { Badge, Card, Dialog, Empty, Field, Note, PageHead, Tabs, fmtDate, inr, useToast } from '../ui';
import { SYSTEM_LABEL, live, orchardHours, stageFor, stageName, varietyName } from '../lib';
import { WeatherChart } from '../charts';

const DISTRICTS = ['Anantnag', 'Bandipora', 'Baramulla', 'Budgam', 'Ganderbal', 'Kulgam', 'Kupwara', 'Pulwama', 'Shopian', 'Srinagar', 'Kargil', 'Leh'];
const canManage = () => session.user()?.role !== 'worker';

export function OrchardForm({ orchard, onDone }: { orchard?: Row; onDone: (id?: string) => void }) {
  const { save } = useData();
  const toast = useToast();
  const [f, setF] = useState<Row>(orchard ?? { id: newId(), name: '', district: 'Shopian', village: '', lat: '', lng: '', elevation_m: '', area_kanal: '', khasra_no: '', notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
  const locate = () => navigator.geolocation?.getCurrentPosition(
    (p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5), ...(p.coords.altitude ? { elevation_m: Math.round(p.coords.altitude) } : {}) })),
    () => setErr('Could not read your location — enter coordinates manually.'),
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await save('orchards', { ...f, lat: num(f.lat), lng: num(f.lng), elevation_m: num(f.elevation_m), area_kanal: num(f.area_kanal) });
      toast(orchard ? 'Orchard updated' : 'Orchard added');
      onDone(f.id);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      {err && <Note tone="bad">{err}</Note>}
      <div className="form-grid">
        <Field label="Orchard name"><input value={f.name} onChange={set('name')} required /></Field>
        <Field label="District"><select value={f.district ?? ''} onChange={set('district')}>{DISTRICTS.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Village"><input value={f.village ?? ''} onChange={set('village')} /></Field>
        <Field label="Khasra no."><input value={f.khasra_no ?? ''} onChange={set('khasra_no')} /></Field>
        <Field label="Latitude"><input inputMode="decimal" value={f.lat ?? ''} onChange={set('lat')} placeholder="33.72" /></Field>
        <Field label="Longitude"><input inputMode="decimal" value={f.lng ?? ''} onChange={set('lng')} placeholder="74.83" /></Field>
        <Field label="Elevation (m)"><input inputMode="numeric" value={f.elevation_m ?? ''} onChange={set('elevation_m')} placeholder="1900" /></Field>
        <Field label="Area (kanal)"><input inputMode="decimal" value={f.area_kanal ?? ''} onChange={set('area_kanal')} /></Field>
      </div>
      <div className="faint">Exact coordinates matter: weather and scab alerts are computed for this point. Elevation shifts the stage calendar (~3 days per 100 m). {f.area_kanal ? `${f.area_kanal} kanal ≈ ${kanalToHectare(Number(f.area_kanal)).toFixed(2)} ha.` : ''}</div>
      <Field label="Notes"><textarea value={f.notes ?? ''} onChange={set('notes')} /></Field>
      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save orchard'}</button>
        <button type="button" className="btn" onClick={locate}>📍 Use my location</button>
        <button type="button" className="btn ghost" onClick={() => onDone()}>Cancel</button>
      </div>
    </form>
  );
}

export function Orchards() {
  const { tables, ref } = useData();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const orchards = live(tables.orchards).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const adding = params.get('new') === '1';
  return (
    <>
      <PageHead title="Orchards" sub="Every orchard and its blocks." actions={canManage() && <button className="btn primary" onClick={() => setParams({ new: '1' })}>+ Add orchard</button>} />
      {orchards.length ? (
        <Card>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Name</th><th>Location</th><th className="num">Elevation</th><th className="num">Area</th><th className="num">Blocks</th><th>Stage now</th></tr></thead>
              <tbody>
                {orchards.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/orchards/${o.id}`}><b>{o.name}</b></Link></td>
                    <td>{[o.village, o.district].filter(Boolean).join(', ')}{o.lat == null && <> <Badge tone="warn">no coordinates</Badge></>}</td>
                    <td className="num">{o.elevation_m ? `${o.elevation_m} m` : '—'}</td>
                    <td className="num">{o.area_kanal ? `${o.area_kanal} kanal` : '—'}</td>
                    <td className="num">{live(tables.blocks).filter((b) => b.orchard_id === o.id).length}</td>
                    <td>{stageFor(ref, today(), o)?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : <Empty>No orchards yet.</Empty>}
      {adding && <Dialog title="Add orchard" onClose={() => setParams({})}><OrchardForm onDone={(id) => (id ? nav(`/orchards/${id}`) : setParams({}))} /></Dialog>}
    </>
  );
}

const TRAINING = ['Modified central leader', 'Open centre', 'Tall spindle', 'Espalier', 'Super spindle', 'Vertical axis'];

export function BlockForm({ orchardId, block, onDone }: { orchardId: string; block?: Row; onDone: (id?: string) => void }) {
  const { save, ref } = useData();
  const toast = useToast();
  const [f, setF] = useState<Row>(block ?? { id: newId(), orchard_id: orchardId, name: '', system_type: 'traditional', rootstock_id: 'seedling', training_system: TRAINING[0], planting_year: '', area_kanal: '', tree_count: '', variety_mix: [{ varietyId: 'red-delicious', trees: '' }, { varietyId: 'golden-delicious', trees: '' }], scab_resistant: false, full_bloom_date: '', expected_harvest_date: '', drip: false, hail_net: false, trellis: false, notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const chk = (k: string) => (e: { target: { checked: boolean } }) => setF({ ...f, [k]: e.target.checked });
  const mix = (f.variety_mix as { varietyId: string; trees: number | string }[]) ?? [];
  const setMix = (i: number, k: 'varietyId' | 'trees', v: string) => setF({ ...f, variety_mix: mix.map((m, j) => (j === i ? { ...m, [k]: v } : m)) });
  const rs = ref.rootstocks.find((r) => r.id === f.rootstock_id);
  const mainVar = ref.varieties.find((v) => v.id === mix[0]?.varietyId);
  const suggestedHarvest = f.full_bloom_date ? harvestFromBloom(String(f.full_bloom_date), mainVar?.dafbMin) : undefined;
  const resistantMix = mix.length > 0 && mix.filter((m) => ref.varieties.find((v) => v.id === m.varietyId && v.pollinizerRole !== 'pollinizer')).every((m) => ref.varieties.find((v) => v.id === m.varietyId)?.scabResistant);
  const pol = pollinizerCheck(mix.map((m) => ({ varietyId: m.varietyId, trees: Number(m.trees) || 0 })), ref.varieties);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const n = (v: unknown) => (v === '' || v == null ? null : Number(v));
    try {
      await save('blocks', {
        ...f, planting_year: n(f.planting_year), area_kanal: n(f.area_kanal), tree_count: n(f.tree_count),
        variety_mix: mix.filter((m) => m.varietyId).map((m) => ({ varietyId: m.varietyId, trees: Number(m.trees) || 0 })),
        full_bloom_date: f.full_bloom_date || null, expected_harvest_date: f.expected_harvest_date || suggestedHarvest || null,
      });
      toast(block ? 'Block updated' : 'Block added');
      onDone(f.id);
    } catch (x) { setErr((x as Error).message); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      {err && <Note tone="bad">{err}</Note>}
      <div className="form-grid">
        <Field label="Block name"><input value={f.name} onChange={set('name')} required placeholder="North slope / HDP-1" /></Field>
        <Field label="System"><select value={f.system_type} onChange={(e) => setF({ ...f, system_type: e.target.value, ...(e.target.value === 'hdp' ? { rootstock_id: 'm9-t337', training_system: 'Tall spindle', trellis: true, drip: true } : {}) })}>{Object.entries(SYSTEM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Rootstock"><select value={f.rootstock_id ?? ''} onChange={set('rootstock_id')}>{ref.rootstocks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Training system"><select value={f.training_system ?? ''} onChange={set('training_system')}>{TRAINING.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Planting year"><input inputMode="numeric" value={f.planting_year ?? ''} onChange={set('planting_year')} /></Field>
        <Field label="Area (kanal)"><input inputMode="decimal" value={f.area_kanal ?? ''} onChange={set('area_kanal')} /></Field>
        <Field label="Number of trees"><input inputMode="numeric" value={f.tree_count ?? ''} onChange={set('tree_count')} placeholder={rs?.treesPerKanal && f.area_kanal ? String(Math.round(rs.treesPerKanal * Number(f.area_kanal))) : ''} /></Field>
        <Field label="Full bloom date"><input type="date" value={f.full_bloom_date ?? ''} onChange={set('full_bloom_date')} /></Field>
        <Field label="Expected harvest"><input type="date" value={f.expected_harvest_date ?? ''} onChange={set('expected_harvest_date')} placeholder={suggestedHarvest} /></Field>
      </div>
      {rs && <div className="faint">{rs.name}: {rs.vigor.replace('_', ' ')}{rs.spacingM ? `, typical ${rs.spacingM[0]} × ${rs.spacingM[1]} m (≈ ${treesPerKanal(rs.spacingM[0], rs.spacingM[1])} trees/kanal)` : ''}. {rs.cautions.join('; ')}</div>}
      {suggestedHarvest && !f.expected_harvest_date && <div className="faint">Suggested harvest from {mainVar?.name} DAFB: {fmtDate(suggestedHarvest)} (used if left blank). PHI checks depend on this date.</div>}
      <div>
        <h3 style={{ marginBottom: 8 }}>Varieties</h3>
        <div className="stack" style={{ gap: 8 }}>
          {mix.map((m, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
              <select value={m.varietyId} onChange={(e) => setMix(i, 'varietyId', e.target.value)} aria-label="Variety">{ref.varieties.map((v) => <option key={v.id} value={v.id}>{v.name}{v.scabResistant ? ' (scab-resistant)' : ''}</option>)}</select>
              <input style={{ maxWidth: 110 }} inputMode="numeric" value={m.trees} onChange={(e) => setMix(i, 'trees', e.target.value)} placeholder="trees" aria-label="Trees" />
              <button type="button" className="btn sm ghost" onClick={() => setF({ ...f, variety_mix: mix.filter((_, j) => j !== i) })} aria-label="Remove variety">✕</button>
            </div>
          ))}
          <div><button type="button" className="btn sm" onClick={() => setF({ ...f, variety_mix: [...mix, { varietyId: 'golden-delicious', trees: '' }] })}>+ Variety</button></div>
        </div>
        {mix.some((m) => Number(m.trees) > 0) && <div className="faint" style={{ marginTop: 6 }}>Pollinizers {pol.share}% — {pol.advice}</div>}
      </div>
      <div className="row" style={{ gap: 18 }}>
        <label className="f check"><input type="checkbox" checked={!!f.scab_resistant} onChange={chk('scab_resistant')} />Scab-resistant (Rvi6) — low-spray programme</label>
        <label className="f check"><input type="checkbox" checked={!!f.drip} onChange={chk('drip')} />Drip</label>
        <label className="f check"><input type="checkbox" checked={!!f.trellis} onChange={chk('trellis')} />Trellis</label>
        <label className="f check"><input type="checkbox" checked={!!f.hail_net} onChange={chk('hail_net')} />Anti-hail net</label>
      </div>
      {f.scab_resistant && !resistantMix && <Note tone="warn">Only Rvi6 varieties (Shireen, Firdous, Shalimar Apple-1) qualify. Lal Ambri and Sunehari are not documented as scab-resistant.</Note>}
      <Field label="Notes"><textarea value={f.notes ?? ''} onChange={set('notes')} /></Field>
      <div className="row"><button className="btn primary">Save block</button><button type="button" className="btn ghost" onClick={() => onDone()}>Cancel</button></div>
    </form>
  );
}

interface Advisory { district: string; links: { label: string; url: string }[]; note: string }

export function OrchardDetail() {
  const { id = '' } = useParams();
  const { tables, ref, save, remove } = useData();
  const toast = useToast();
  const nav = useNavigate();
  const o = live(tables.orchards).find((x) => x.id === id);
  const [tab, setTab] = useState<'blocks' | 'weather' | 'traps' | 'expenses' | 'advisories'>('blocks');
  const [edit, setEdit] = useState(false);
  const [addBlock, setAddBlock] = useState(false);
  const [adv, setAdv] = useState<Advisory | null>(null);
  useEffect(() => { if (o?.district) api<Advisory>(`/v1/advisories/${encodeURIComponent(String(o.district))}`).then(setAdv).catch(() => setAdv(null)); }, [o?.district]);
  if (!o) return <Empty>Orchard not found. <Link to="/orchards">Back</Link></Empty>;
  const blocks = live(tables.blocks).filter((b) => b.orchard_id === id);
  const hours = orchardHours(tables, id);
  const traps = live(tables.trap_catches).filter((t) => t.orchard_id === id).sort((a, b) => String(b.caught_on).localeCompare(String(a.caught_on)));
  const biofix = detectBiofix(traps.map((t) => ({ date: String(t.caught_on), moths: Number(t.moths), ...(t.sunset_temp_c != null ? { sunsetTempC: Number(t.sunset_temp_c) } : {}) })));
  const dd = biofix ? accumulateDD(dailySummaries(hours.filter((h) => !h.isForecast)), biofix).at(-1)?.cumulative : undefined;
  const expenses = live(tables.expenses).filter((e) => e.orchard_id === id).sort((a, b) => String(b.spent_on).localeCompare(String(a.spent_on)));

  return (
    <>
      <PageHead title={String(o.name)} sub={<>{[o.village, o.district].filter(Boolean).join(', ')} {o.lat != null && <span className="faint">· {Number(o.lat).toFixed(3)}, {Number(o.lng).toFixed(3)}</span>} {o.elevation_m && <span className="faint">· {o.elevation_m} m</span>} · stage <b>{stageFor(ref, today(), o)?.name ?? '—'}</b></>}
        actions={canManage() && <><button className="btn" onClick={() => setEdit(true)}>Edit</button><button className="btn primary" onClick={() => setAddBlock(true)}>+ Block</button></>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'blocks', label: `Blocks (${blocks.length})` }, { id: 'weather', label: 'Weather' }, { id: 'traps', label: 'Codling moth traps' }, { id: 'expenses', label: 'Expenses' }, { id: 'advisories', label: 'Advisories' }]} />

      {tab === 'blocks' && (blocks.length ? (
        <div className="grid g3">
          {blocks.map((b) => {
            const mix = (b.variety_mix as { varietyId: string; trees: number }[]) ?? [];
            return (
              <Card key={b.id} title={<Link to={`/blocks/${b.id}`}><h2>{b.name}</h2></Link>} actions={<Badge tone={b.system_type === 'hdp' ? 'info' : ''}>{SYSTEM_LABEL[String(b.system_type)]}</Badge>}>
                <div className="stack" style={{ gap: 4, fontSize: '0.9rem' }}>
                  <div className="muted">{ref.rootstocks.find((r) => r.id === b.rootstock_id)?.name ?? '—'} · {b.tree_count ?? '?'} trees{b.planting_year ? ` · planted ${b.planting_year}` : ''}</div>
                  <div>{mix.map((m) => varietyName(ref, m.varietyId)).join(', ') || 'No varieties'}</div>
                  <div className="faint">Harvest {fmtDate(b.expected_harvest_date)} · stage {stageName(ref, stageFor(ref, today(), o, b)?.id)}</div>
                  <div className="row" style={{ marginTop: 6 }}>{b.scab_resistant && <Badge tone="ok">Low-spray (Rvi6)</Badge>}{b.drip && <Badge>Drip</Badge>}{b.hail_net && <Badge>Hail net</Badge>}{b.trellis && <Badge>Trellis</Badge>}</div>
                  <Link className="btn sm primary" style={{ marginTop: 8, alignSelf: 'flex-start' }} to={`/blocks/${b.id}`}>Open spray plan →</Link>
                </div>
              </Card>
            );
          })}
        </div>
      ) : <Empty>No blocks yet. Add a block to get the stage-wise spray plan.</Empty>)}

      {tab === 'weather' && <Card title="Hourly weather — past days and forecast"><WeatherChart hours={hours} /><p className="faint" style={{ marginBottom: 0 }}>Hourly at {o.lat != null ? `${Number(o.lat).toFixed(3)}, ${Number(o.lng).toFixed(3)}` : 'orchard'}. Leaf wetness for the scab model uses RH ≥ 90% or rain.</p></Card>}

      {tab === 'traps' && <TrapPanel orchardId={id} traps={traps} biofix={biofix} dd={dd} save={save} remove={remove} toast={toast} />}

      {tab === 'expenses' && <ExpensePanel orchardId={id} rows={expenses} save={save} toast={toast} />}

      {tab === 'advisories' && (
        <Card title={`Official advisories — ${o.district ?? 'Kashmir'}`}>
          <Note tone="info">{adv?.note ?? 'Official advisories take precedence over app model outputs.'}</Note>
          <ul>{(adv?.links ?? []).map((l) => <li key={l.url} style={{ margin: '6px 0' }}><a href={l.url} target="_blank" rel="noreferrer">{l.label}</a></li>)}</ul>
        </Card>
      )}

      {edit && <Dialog title="Edit orchard" onClose={() => setEdit(false)}><OrchardForm orchard={o} onDone={() => setEdit(false)} /></Dialog>}
      {addBlock && <Dialog title="Add block" onClose={() => setAddBlock(false)}><BlockForm orchardId={id} onDone={(bid) => { setAddBlock(false); if (bid) nav(`/blocks/${bid}`); }} /></Dialog>}
    </>
  );
}

type SaveFn = ReturnType<typeof useData>['save'];

function TrapPanel({ orchardId, traps, biofix, dd, save, toast }: { orchardId: string; traps: Row[]; biofix: string | null; dd?: number; save: SaveFn; remove: ReturnType<typeof useData>['remove']; toast: (m: string) => void }) {
  const [f, setF] = useState({ trap_code: 'T1', caught_on: today(), moths: '', sunset_temp_c: '' });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save('trap_catches', { id: newId(), orchard_id: orchardId, trap_code: f.trap_code, caught_on: f.caught_on, moths: Number(f.moths), sunset_temp_c: f.sunset_temp_c === '' ? null : Number(f.sunset_temp_c) }, { isNew: true });
      setF({ ...f, moths: '' });
      toast('Trap catch recorded');
    } catch (x) { setErr((x as Error).message); }
  };
  return (
    <div className="grid g2">
      <Card title="Degree-day model">
        {biofix ? (
          <div className="stack">
            <div>Biofix <b>{fmtDate(biofix)}</b> (first sustained catch, sunset ≥ 16.7 °C)</div>
            <div className="stat"><div className="v">{Math.round(dd ?? 0)}</div><div className="l">°F-days since biofix (50/88 °F, single sine)</div></div>
            <div className="faint">First cover spray near 250 DD; 2nd generation egg hatch near 1260 DD. Advisory — not yet validated for Kashmir.</div>
          </div>
        ) : <div className="muted">No biofix yet. Record pheromone trap catches; biofix is set at the first two consecutive catches with warm sunsets.</div>}
      </Card>
      <Card title="Record trap catch">
        <form className="stack" onSubmit={submit}>
          {err && <Note tone="bad">{err}</Note>}
          <div className="form-grid">
            <Field label="Trap"><input value={f.trap_code} onChange={(e) => setF({ ...f, trap_code: e.target.value })} required /></Field>
            <Field label="Date"><input type="date" value={f.caught_on} onChange={(e) => setF({ ...f, caught_on: e.target.value })} required /></Field>
            <Field label="Moths caught"><input inputMode="numeric" value={f.moths} onChange={(e) => setF({ ...f, moths: e.target.value })} required /></Field>
            <Field label="Sunset temp °C"><input inputMode="decimal" value={f.sunset_temp_c} onChange={(e) => setF({ ...f, sunset_temp_c: e.target.value })} /></Field>
          </div>
          <div><button className="btn primary">Save</button></div>
        </form>
        {traps.length > 0 && <table style={{ marginTop: 12 }}><thead><tr><th>Date</th><th>Trap</th><th className="num">Moths</th></tr></thead><tbody>{traps.slice(0, 10).map((t) => <tr key={t.id}><td>{fmtDate(t.caught_on)}</td><td>{t.trap_code}</td><td className="num">{t.moths}</td></tr>)}</tbody></table>}
      </Card>
    </div>
  );
}

const EXPENSE_CATS = ['Pesticides', 'Fertilisers', 'Labour', 'Packing & boxes', 'Transport', 'Irrigation', 'Equipment', 'Other'];

function ExpensePanel({ orchardId, rows, save, toast }: { orchardId: string; rows: Row[]; save: SaveFn; toast: (m: string) => void }) {
  const [f, setF] = useState({ spent_on: today(), category: 'Labour', amount_inr: '', notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save('expenses', { id: newId(), orchard_id: orchardId, ...f, amount_inr: Number(f.amount_inr) }, { isNew: true });
      setF({ ...f, amount_inr: '', notes: '' });
      toast('Expense added');
    } catch (x) { setErr((x as Error).message); }
  };
  const total = rows.reduce((s, r) => s + Number(r.amount_inr ?? 0), 0);
  return (
    <div className="grid g2">
      <Card title={`Expenses · ${inr(total)}`}>
        {rows.length ? <div className="tbl-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Notes</th><th className="num">Amount</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{fmtDate(r.spent_on)}</td><td>{r.category}</td><td className="muted">{r.notes}</td><td className="num">{inr(r.amount_inr)}</td></tr>)}</tbody></table></div> : <Empty>No expenses recorded.</Empty>}
      </Card>
      {canManage() && (
        <Card title="Add expense">
          <form className="stack" onSubmit={submit}>
            {err && <Note tone="bad">{err}</Note>}
            <div className="form-grid">
              <Field label="Date"><input type="date" value={f.spent_on} onChange={(e) => setF({ ...f, spent_on: e.target.value })} required /></Field>
              <Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Amount (₹)"><input inputMode="decimal" value={f.amount_inr} onChange={(e) => setF({ ...f, amount_inr: e.target.value })} required /></Field>
            </div>
            <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            <div><button className="btn primary">Add</button></div>
          </form>
        </Card>
      )}
    </div>
  );
}
