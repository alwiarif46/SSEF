import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, session } from '../api';
import { Badge, Card, Field, Note, PageHead, useToast } from '../ui';

interface User { id: string; name: string; phone: string; role: string; active: boolean }

export function Team() {
  const toast = useToast();
  const owner = session.user()?.role === 'owner';
  const [users, setUsers] = useState<User[]>([]);
  const [f, setF] = useState({ name: '', phone: '', password: '', role: 'worker' });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<User[]>('/v1/users').then(setUsers).catch((e) => setErr((e as Error).message)), []);
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
  return (
    <>
      <PageHead title="Team" sub="Owners manage billing and users; managers plan sprays and assign tasks; workers record what was actually done." />
      <div className="grid g2">
        <Card title="People">
          <table>
            <thead><tr><th>Name</th><th>Mobile</th><th>Role</th><th></th></tr></thead>
            <tbody>{users.map((u) => <tr key={u.id}><td><b>{u.name}</b></td><td className="mono">{u.phone}</td><td><Badge tone={u.role === 'owner' ? 'brand' : u.role === 'manager' ? 'info' : ''}>{u.role}</Badge>{!u.active && <> <Badge tone="warn">inactive</Badge></>}</td><td>{owner && u.role !== 'owner' && <button className="btn sm ghost" onClick={() => void toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</button>}</td></tr>)}</tbody>
          </table>
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
      </div>
    </>
  );
}
