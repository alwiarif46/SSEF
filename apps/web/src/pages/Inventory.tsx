import { useState, type FormEvent } from 'react';
import { session } from '../api';
import { newId, today, useData, type Row } from '../data';
import { Badge, Card, Dialog, Empty, Field, Note, PageHead, fmtDate, inr, useToast } from '../ui';
import { live } from '../lib';

export function Inventory() {
  const { tables, ref } = useData();
  const [form, setForm] = useState<Row | null>(null);
  const rows = live(tables.chemical_inventory).sort((a, b) => String(a.expiry_date ?? '9').localeCompare(String(b.expiry_date ?? '9')));
  const chem = new Map(ref.chemicals.map((c) => [c.id, c]));
  const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const value = rows.reduce((s, r) => s + Number(r.cost_inr ?? 0), 0);
  const canAdd = session.user()?.role !== 'worker';
  return (
    <>
      <PageHead title="Chemical inventory" sub="Batch-level stock with dealer, invoice and CIBRC registration — sprays deduct from the earliest-expiring batch automatically."
        actions={canAdd && <button className="btn primary" onClick={() => setForm({ id: newId(), chemical_id: ref.chemicals[0]!.id, batch_no: '', expiry_date: '', quantity: '', unit: 'kg', dealer: '', dealer_licence_no: '', invoice_no: '', registration_no: '', purchased_on: today(), cost_inr: '' })}>+ Add stock</button>} />
      {rows.length ? (
        <Card title={`${rows.length} batches · purchase value ${inr(value)}`}>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Product</th><th>Batch</th><th className="num">Quantity</th><th>Expiry</th><th>Dealer / invoice</th><th>CIBRC reg.</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const c = chem.get(String(r.chemical_id));
                  const expired = r.expiry_date && String(r.expiry_date) < today();
                  const soon = !expired && r.expiry_date && String(r.expiry_date) <= in60;
                  return (
                    <tr key={r.id}>
                      <td><b>{c?.product ?? r.chemical_id}</b>{c && c.status !== 'registered' && <> <Badge tone={c.status === 'banned' ? 'bad' : 'warn'}>{c.status}</Badge></>}</td>
                      <td>{r.batch_no || '—'}</td>
                      <td className="num">{Number(r.quantity) <= 0 ? <Badge tone="warn">empty</Badge> : `${r.quantity} ${r.unit}`}</td>
                      <td>{expired ? <Badge tone="bad">expired {fmtDate(r.expiry_date)}</Badge> : soon ? <Badge tone="warn">{fmtDate(r.expiry_date)}</Badge> : fmtDate(r.expiry_date)}</td>
                      <td>{r.dealer || '—'}{r.invoice_no && <div className="faint">Inv. {r.invoice_no}</div>}</td>
                      <td>{r.registration_no || <Badge tone="warn">missing</Badge>}</td>
                      <td><button className="btn sm ghost" onClick={() => setForm(r)}>Edit</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : <Empty>No stock recorded. Add what you buy — with the invoice and registration number for traceability.</Empty>}
      {form && <Dialog title={rows.some((r) => r.id === form.id) ? 'Edit stock' : 'Add stock'} onClose={() => setForm(null)}><StockForm row={form} onDone={() => setForm(null)} /></Dialog>}
    </>
  );
}

function StockForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const { ref, save } = useData();
  const toast = useToast();
  const [f, setF] = useState<Row>(row);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const c = ref.chemicals.find((x) => x.id === f.chemical_id);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save('chemical_inventory', { ...f, quantity: Number(f.quantity), cost_inr: f.cost_inr === '' ? null : Number(f.cost_inr), expiry_date: f.expiry_date || null, purchased_on: f.purchased_on || null });
      toast('Stock saved');
      onDone();
    } catch (x) { setErr((x as Error).message); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      {err && <Note tone="bad">{err}</Note>}
      <Field label="Product"><select value={f.chemical_id} onChange={(e) => { const ch = ref.chemicals.find((x) => x.id === e.target.value); setF({ ...f, chemical_id: e.target.value, unit: ch && ['SC', 'EC', 'SL', 'OD'].includes(ch.formulation) ? 'l' : 'kg' }); }}>{ref.chemicals.filter((x) => x.status !== 'banned').map((x) => <option key={x.id} value={x.id}>{x.product}</option>)}</select></Field>
      {c?.status === 'watch' && <Note tone="warn">{c.statusNote}</Note>}
      <div className="form-grid">
        <Field label="Quantity"><input inputMode="decimal" value={f.quantity} onChange={set('quantity')} required /></Field>
        <Field label="Unit"><select value={f.unit} onChange={set('unit')}>{['kg', 'g', 'l', 'ml'].map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label="Batch no."><input value={f.batch_no ?? ''} onChange={set('batch_no')} /></Field>
        <Field label="Expiry"><input type="date" value={f.expiry_date ?? ''} onChange={set('expiry_date')} /></Field>
        <Field label="CIBRC registration no."><input value={f.registration_no ?? ''} onChange={set('registration_no')} /></Field>
        <Field label="Purchased on"><input type="date" value={f.purchased_on ?? ''} onChange={set('purchased_on')} /></Field>
        <Field label="Dealer"><input value={f.dealer ?? ''} onChange={set('dealer')} /></Field>
        <Field label="Dealer licence no."><input value={f.dealer_licence_no ?? ''} onChange={set('dealer_licence_no')} /></Field>
        <Field label="Invoice no."><input value={f.invoice_no ?? ''} onChange={set('invoice_no')} /></Field>
        <Field label="Cost (₹)"><input inputMode="decimal" value={f.cost_inr ?? ''} onChange={set('cost_inr')} /></Field>
      </div>
      <div className="faint">Buy only from a licensed dealer and keep the invoice.</div>
      <div className="row"><button className="btn primary">Save</button><button type="button" className="btn ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}
