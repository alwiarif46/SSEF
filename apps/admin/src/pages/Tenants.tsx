import { useMemo, useState } from 'react';
import { adminApi, type BillingStatus, type TenantSummary } from '../api';
import { Badge, Card, Dialog, Empty, Field, Note, PageHead, Stat, fmtAgo, fmtDate, useLoad, useToast, type Tone } from '../ui';

const BILLING: BillingStatus[] = ['trial', 'active', 'past_due', 'cancelled'];
const PLANS = ['pilot', 'basic', 'pro', 'enterprise'];
const billingTone: Record<BillingStatus, Tone> = { trial: 'info', active: 'ok', past_due: 'warn', cancelled: 'bad' };

type SortKey = 'name' | 'created_at' | 'last_activity_at' | 'orchards' | 'sprays_this_season';

export function Tenants() {
  const { data, error, loading, reload } = useLoad(adminApi.tenants);
  const [q, setQ] = useState('');
  const [billing, setBilling] = useState<BillingStatus | ''>('');
  const [sort, setSort] = useState<SortKey>('created_at');
  const [editing, setEditing] = useState<TenantSummary | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (data ?? []).filter((t) =>
      (!billing || t.billing_status === billing) &&
      (!needle || [t.name, t.district ?? '', t.plan, t.id].some((v) => v.toLowerCase().includes(needle))));
    const dir = sort === 'name' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = a[sort] ?? '', y = b[sort] ?? '';
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [data, q, billing, sort]);

  const totals = useMemo(() => {
    const all = data ?? [];
    const weekAgo = Date.now() - 7 * 86_400_000;
    return {
      tenants: all.length,
      paying: all.filter((t) => t.billing_status === 'active').length,
      pastDue: all.filter((t) => t.billing_status === 'past_due').length,
      active7d: all.filter((t) => t.last_activity_at && Date.parse(t.last_activity_at) >= weekAgo).length,
    };
  }, [data]);

  return (
    <>
      <PageHead title="Tenants" sub="Per-tenant aggregates only — orchard and spray contents are never visible here." actions={<button className="btn" onClick={reload}>⟳ Refresh</button>} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Tenants" value={totals.tenants} />
        <Stat label="Active (paying)" value={totals.paying} />
        <Stat label="Past due" value={totals.pastDue} />
        <Stat label="Active in last 7 days" value={totals.active7d} />
      </div>
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <input type="search" placeholder="Search name, district, plan or id…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} aria-label="Search tenants" />
          <select value={billing} onChange={(e) => setBilling(e.target.value as BillingStatus | '')} style={{ width: 'auto' }} aria-label="Billing status filter">
            <option value="">All billing statuses</option>
            {BILLING.map((b) => <option key={b} value={b}>{b.replace('_', ' ')}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ width: 'auto' }} aria-label="Sort">
            <option value="created_at">Newest first</option>
            <option value="last_activity_at">Recently active</option>
            <option value="orchards">Most orchards</option>
            <option value="sprays_this_season">Most sprays this season</option>
            <option value="name">Name A–Z</option>
          </select>
          <span className="faint" style={{ marginLeft: 'auto' }}>{rows.length} of {data?.length ?? 0}</span>
        </div>
        {error && <Note tone="bad">{error}</Note>}
        {loading && !data ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>No tenants match.</Empty> : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tenant</th><th>District</th><th>Plan</th><th>Billing</th>
                  <th className="num">Users</th><th className="num">Orchards</th><th className="num">Blocks</th><th className="num">Sprays (season)</th>
                  <th>Last activity</th><th>Created</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.name}</b><div className="faint code">{t.id.slice(0, 8)}</div></td>
                    <td>{t.district ?? '—'}</td>
                    <td><Badge tone="brand">{t.plan}</Badge></td>
                    <td><Badge tone={billingTone[t.billing_status]}>{t.billing_status.replace('_', ' ')}</Badge></td>
                    <td className="num">{t.users}</td>
                    <td className="num">{t.orchards}</td>
                    <td className="num">{t.blocks}</td>
                    <td className="num">{t.sprays_this_season}</td>
                    <td title={t.last_activity_at ?? ''}>{fmtAgo(t.last_activity_at)}</td>
                    <td>{fmtDate(t.created_at)}</td>
                    <td><button className="btn sm" onClick={() => setEditing(t)}>Edit plan</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <EditPlan tenant={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function EditPlan({ tenant, onClose, onSaved }: { tenant: TenantSummary; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState(tenant.plan);
  const [billing, setBilling] = useState<BillingStatus>(tenant.billing_status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planOptions = PLANS.includes(tenant.plan) ? PLANS : [tenant.plan, ...PLANS];
  const unchanged = plan === tenant.plan && billing === tenant.billing_status;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.setPlan(tenant.id, { ...(plan !== tenant.plan ? { plan } : {}), ...(billing !== tenant.billing_status ? { billing_status: billing } : {}) });
      toast(`${tenant.name}: ${plan} / ${billing.replace('_', ' ')}`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Plan & billing — ${tenant.name}`} onClose={onClose}>
      <div className="stack">
        {error && <Note tone="bad">{error}</Note>}
        <div className="form-grid">
          <Field label="Plan">
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              {planOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Billing status">
            <select value={billing} onChange={(e) => setBilling(e.target.value as BillingStatus)}>
              {BILLING.map((b) => <option key={b} value={b}>{b.replace('_', ' ')}</option>)}
            </select>
          </Field>
        </div>
        {billing === 'cancelled' && <Note tone="warn">Cancelled tenants are skipped by the weather worker: no new weather, infection alerts or push notifications.</Note>}
        <p className="faint" style={{ margin: 0 }}>The change is recorded in the audit log with the previous values.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || unchanged} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Dialog>
  );
}
