import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, session } from '../api';
import { useRows, type Row } from '../data';
import { Badge, Card, Dialog, Field, Note, PageHead, useToast } from '../ui';

interface User { id: string; name: string; phone: string; role: string; active: boolean }
interface Assignment { userId: string; orchardIds: string[] }

export function Team() {
  const toast = useToast();
  const owner = session.user()?.role === 'owner';
  const orchards = useRows('orchards', useCallback((r: Row) => !r.deleted_at, []));
  const orchardName = useMemo(() => new Map(orchards.map((o) => [o.id, String(o.name)])), [orchards]);
  const [users, setUsers] = useState<User[]>([]);
  const [assigned, setAssigned] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<User | null>(null);
  const [f, setF] = useState({ name: '', phone: '', password: '', role: 'worker' });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [u, a] = await Promise.all([api<User[]>('/v1/users'), api<Assignment[]>('/v1/user-orchards')]);
      setUsers(u);
      setAssigned(Object.fromEntries(a.map((x) => [x.userId, x.orchardIds])));
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await api('/v1/users', { body: f });
      toast(`${f.name} added as ${f.role}`);
      setF({ name: '', phone: '', password: '', role: 'worker' });
      void load();
    } catch (x) { setErr((x as Error).message); }
  };
  const toggle = async (u: User) => {
    try { await api(`/v1/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); void load(); } catch (x) { toast((x as Error).message); }
  };
  const scopeLabel = (u: User) => {
    const ids = assigned[u.id] ?? [];
    if (!ids.length) return <span className="faint">All orchards</span>;
    return <span className="row" style={{ gap: 4 }}>{ids.map((id) => <Badge key={id} tone="info">{orchardName.get(id) ?? 'Removed orchard'}</Badge>)}</span>;
  };
  return (
    <>
      <PageHead title="Team" sub="Owners manage billing and users; managers plan sprays and assign tasks; workers record what was actually done." />
      <div className="grid g2">
        <Card title="People">
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th>Orchards</th><th></th></tr></thead>
              <tbody>{users.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.name}</b></td>
                  <td className="mono">{u.phone}</td>
                  <td><Badge tone={u.role === 'owner' ? 'brand' : u.role === 'manager' ? 'info' : ''}>{u.role}</Badge>{!u.active && <> <Badge tone="warn">inactive</Badge></>}</td>
                  <td>{u.role === 'worker' ? scopeLabel(u) : <span className="faint">All orchards</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      {u.role === 'worker' && <button className="btn sm ghost" onClick={() => setEditing(u)}>Assign orchards</button>}
                      {owner && u.role !== 'owner' && <button className="btn sm ghost" onClick={() => void toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</button>}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="faint" style={{ marginBottom: 0 }}>A worker with assigned orchards only syncs and records data for those orchards (plus tasks assigned to them). Without assignments a worker sees every orchard.</p>
        </Card>
        {owner && (
          <Card title="Add a person">
            <form className="stack" onSubmit={submit}>
              {err && <Note tone="bad">{err}</Note>}
              <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></Field>
              <Field label="Mobile number"><input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.trim() })} required pattern="\+?[0-9]{10,13}" /></Field>
              <Field label="Temporary password"><input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} /></Field>
              <Field label="Role"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="worker">Worker / sprayer</option><option value="manager">Manager</option></select></Field>
              <div><button className="btn primary">Add</button></div>
            </form>
          </Card>
        )}
        {!owner && err && <Note tone="bad">{err}</Note>}
      </div>
      {editing && (
        <AssignDialog
          user={editing}
          orchards={orchards.map((o) => ({ id: o.id, name: String(o.name), district: o.district ? String(o.district) : '' }))}
          current={assigned[editing.id] ?? []}
          onClose={() => setEditing(null)}
          onSaved={(ids) => {
            setAssigned((a) => ({ ...a, [editing.id]: ids }));
            toast(ids.length ? `${editing.name} assigned to ${ids.length} orchard${ids.length === 1 ? '' : 's'}` : `${editing.name} now sees all orchards`);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function AssignDialog({ user, orchards, current, onClose, onSaved }: {
  user: User;
  orchards: { id: string; name: string; district: string }[];
  current: string[];
  onClose: () => void;
  onSaved: (ids: string[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(current));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flip = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ orchardIds: string[] }>(`/v1/users/${user.id}/orchards`, { method: 'PUT', body: { orchardIds: [...sel] } });
      onSaved(r.orchardIds);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title={`Orchards for ${user.name}`} onClose={onClose}>
      <div className="stack">
        {err && <Note tone="bad">{err}</Note>}
        {!orchards.length && <Note tone="warn">No orchards yet. Add an orchard first.</Note>}
        {orchards.map((o) => (
          <label key={o.id} className="f check">
            <input type="checkbox" checked={sel.has(o.id)} onChange={() => flip(o.id)} />
            {o.name}{o.district && <span className="faint"> · {o.district}</span>}
          </label>
        ))}
        <p className="faint" style={{ margin: 0 }}>{sel.size ? `${user.name} will only see the ${sel.size} selected orchard${sel.size === 1 ? '' : 's'}.` : `No selection: ${user.name} sees all orchards.`}</p>
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  );
}
