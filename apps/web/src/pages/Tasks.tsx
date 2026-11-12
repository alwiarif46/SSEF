import { useEffect, useState, type FormEvent } from 'react';
import { api, session } from '../api';
import { newId, today, useData, type Row } from '../data';
import { Badge, Card, Dialog, Empty, Field, Note, PageHead, fmtDate, useToast } from '../ui';
import { live } from '../lib';

interface User { id: string; name: string; role: string; active: boolean }
const KINDS = ['spray', 'scouting', 'pruning', 'irrigation', 'fertiliser', 'harvest', 'trellis/net', 'other'];

export function Tasks() {
  const { tables, save } = useData();
  const toast = useToast();
  const me = session.user();
  const manager = me?.role !== 'worker';
  const [users, setUsers] = useState<User[]>([]);
  const [filter, setFilter] = useState<'mine' | 'open' | 'done'>(manager ? 'open' : 'mine');
  const [form, setForm] = useState<Row | null>(null);
  useEffect(() => { if (manager) api<User[]>('/v1/users').then(setUsers).catch(() => setUsers([])); }, [manager]);
  const orchards = live(tables.orchards);
  const blocks = live(tables.blocks);
  const name = (uid?: string) => users.find((u) => u.id === uid)?.name ?? (uid === me?.id ? me?.name : uid ? 'Assigned' : 'Unassigned');
  const rows = live(tables.tasks)
    .filter((t) => (filter === 'done' ? t.status === 'done' : t.status !== 'done' && t.status !== 'cancelled'))
    .filter((t) => filter !== 'mine' || t.assignee_user_id === me?.id || !t.assignee_user_id)
    .sort((a, b) => String(a.due_on ?? '9').localeCompare(String(b.due_on ?? '9')));

  const setStatus = async (t: Row, status: string) => {
    try {
      await save('tasks', { ...t, status, ...(status === 'done' ? { completed_at: new Date().toISOString(), completed_by: me?.id ?? null } : {}) });
      toast(status === 'done' ? 'Task completed' : 'Task updated');
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <>
      <PageHead title="Tasks" sub="Work orders for the orchard team. Spray alerts create tasks automatically."
        actions={<>
          <div className="seg">{(['mine', 'open', 'done'] as const).map((k) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{k === 'mine' ? 'Mine' : k === 'open' ? 'All open' : 'Done'}</button>)}</div>
          {manager && <button className="btn primary" disabled={!orchards.length} onClick={() => setForm({ id: newId(), orchard_id: orchards[0]?.id, block_id: '', title: '', kind: 'spray', assignee_user_id: '', due_on: today(), status: 'open', notes: '' })}>+ New task</button>}
        </>} />
      {rows.length ? (
        <Card>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Task</th><th>Where</th><th>Assignee</th><th>Due</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((t) => {
                  const overdue = t.due_on && String(t.due_on) < today() && t.status !== 'done';
                  return (
                    <tr key={t.id}>
                      <td><b>{t.title}</b><div className="faint">{t.kind}{t.alert_id ? ' · from alert' : ''}</div>{t.notes && <div className="faint">{t.notes}</div>}</td>
                      <td>{orchards.find((o) => o.id === t.orchard_id)?.name}{t.block_id ? ` / ${blocks.find((b) => b.id === t.block_id)?.name ?? ''}` : ''}</td>
                      <td>{name(t.assignee_user_id)}</td>
                      <td>{overdue ? <Badge tone="bad">{fmtDate(t.due_on)}</Badge> : fmtDate(t.due_on)}</td>
                      <td><Badge tone={t.status === 'done' ? 'ok' : t.status === 'in_progress' ? 'info' : ''}>{String(t.status).replace('_', ' ')}</Badge></td>
                      <td>
                        <div className="row">
                          {t.status === 'open' && <button className="btn sm" onClick={() => void setStatus(t, 'in_progress')}>Start</button>}
                          {t.status !== 'done' && <button className="btn sm primary" onClick={() => void setStatus(t, 'done')}>Done</button>}
                          {manager && t.status !== 'done' && <button className="btn sm ghost" onClick={() => setForm(t)}>Edit</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : <Empty>No tasks here.</Empty>}
      {form && <Dialog title={live(tables.tasks).some((t) => t.id === form.id) ? 'Edit task' : 'New task'} onClose={() => setForm(null)}><TaskForm task={form} users={users} onDone={() => setForm(null)} /></Dialog>}
    </>
  );
}

function TaskForm({ task, users, onDone }: { task: Row; users: User[]; onDone: () => void }) {
  const { tables, save } = useData();
  const toast = useToast();
  const [f, setF] = useState<Row>(task);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save('tasks', { ...f, block_id: f.block_id || null, assignee_user_id: f.assignee_user_id || null, due_on: f.due_on || null });
      toast('Task saved');
      onDone();
    } catch (x) { setErr((x as Error).message); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      {err && <Note tone="bad">{err}</Note>}
      <Field label="Title"><input value={f.title} onChange={set('title')} required /></Field>
      <div className="form-grid">
        <Field label="Type"><select value={f.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Orchard"><select value={f.orchard_id} onChange={(e) => setF({ ...f, orchard_id: e.target.value, block_id: '' })}>{live(tables.orchards).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Block"><select value={f.block_id ?? ''} onChange={set('block_id')}><option value="">Whole orchard</option>{live(tables.blocks).filter((b) => b.orchard_id === f.orchard_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Assign to"><select value={f.assignee_user_id ?? ''} onChange={set('assignee_user_id')}><option value="">Unassigned</option>{users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select></Field>
        <Field label="Due"><input type="date" value={f.due_on ?? ''} onChange={set('due_on')} /></Field>
      </div>
      <Field label="Instructions"><textarea value={f.notes ?? ''} onChange={set('notes')} /></Field>
      <div className="row"><button className="btn primary">Save task</button><button type="button" className="btn ghost" onClick={onDone}>Cancel</button></div>
    </form>
  );
}
