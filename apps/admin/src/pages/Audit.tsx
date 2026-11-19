import { Fragment, useState } from 'react';
import { adminApi, type AuditEntry } from '../api';
import { Badge, Card, Empty, Note, PageHead, fmtDateTime, useLoad, type Tone } from '../ui';

const PAGE = 100;

const actionTone = (a: string): Tone => (a.endsWith('_failed') ? 'bad' : a.startsWith('reference.') ? 'warn' : a.startsWith('tenant.') ? 'info' : '');

export function Audit() {
  const first = useLoad(() => adminApi.audit(PAGE));
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const all = [...(first.data ?? []), ...more];
  const rows = filter ? all.filter((e) => e.action.startsWith(filter)) : all;
  const exhausted = done || (first.data != null && first.data.length < PAGE);

  const loadMore = async () => {
    const last = all.at(-1);
    if (!last) return;
    setBusy(true);
    try {
      const page = await adminApi.audit(PAGE, last.id);
      setMore((m) => [...m, ...page]);
      if (page.length < PAGE) setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Audit log" sub="Every admin sign-in and mutating action, append-only." actions={<button className="btn" onClick={() => { setMore([]); setDone(false); first.reload(); }}>⟳ Refresh</button>} />
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Filter by action">
            <option value="">All actions</option>
            <option value="admin.">Sign-ins and admin accounts</option>
            <option value="tenant.">Tenant changes</option>
            <option value="reference.">Reference data</option>
          </select>
        </div>
        {(first.error || error) && <Note tone="bad">{first.error ?? error}</Note>}
        {first.loading && !first.data ? <Empty>Loading…</Empty> : rows.length === 0 ? <Empty>No entries.</Empty> : (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="clickable" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                      <td>{fmtDateTime(e.created_at)}</td>
                      <td>{e.admin_email ?? <span className="faint">system / CLI</span>}</td>
                      <td><Badge tone={actionTone(e.action)}>{e.action}</Badge></td>
                      <td className="code">{e.target ?? '—'}</td>
                      <td className="faint">{summarise(e)}</td>
                    </tr>
                    {open === e.id && (
                      <tr className="detail"><td colSpan={5}><pre className="json code">{JSON.stringify(e.detail, null, 2)}</pre></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!exhausted && all.length > 0 && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button className="btn" disabled={busy} onClick={() => void loadMore()}>{busy ? 'Loading…' : 'Load older entries'}</button>
          </div>
        )}
      </Card>
    </>
  );
}

function summarise(e: AuditEntry): string {
  const d = e.detail as Record<string, unknown>;
  if (e.action === 'tenant.plan_update') {
    const b = d.before as { plan?: string; billing_status?: string } | undefined;
    const a = d.after as { plan?: string; billing_status?: string } | undefined;
    return `${String(d.tenant ?? '')}: ${b?.plan}/${b?.billing_status} → ${a?.plan}/${a?.billing_status}`;
  }
  if (e.action.startsWith('reference.')) {
    const sup = Array.isArray(d.superseded) && d.superseded.length ? `, superseded ${(d.superseded as string[]).join(', ')}` : '';
    return `${String(d.status ?? '')}${d.verifiedBy ? ` — signed off by ${String(d.verifiedBy)}` : ''}${sup}`;
  }
  if (typeof d.ip === 'string') return `from ${d.ip}${d.reason ? ` (${String(d.reason)})` : ''}`;
  return '';
}
