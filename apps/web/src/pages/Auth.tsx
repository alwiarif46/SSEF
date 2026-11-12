import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, session, type SessionUser } from '../api';
import { Field, Note } from '../ui';

const DISTRICTS = ['Anantnag', 'Bandipora', 'Baramulla', 'Budgam', 'Ganderbal', 'Kulgam', 'Kupwara', 'Pulwama', 'Shopian', 'Srinagar', 'Kargil', 'Leh'];

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  const run = async (path: string, body: unknown) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string; user: SessionUser }>(path, { body });
      session.set(r.token, r.user);
      nav('/', { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

export function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const { busy, err, run } = useSubmit();
  const submit = (e: FormEvent) => { e.preventDefault(); void run('/v1/auth/login', { phone, password }); };
  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40 }} aria-hidden>🍎</div>
          <h1>Seb Orchard</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Apple orchard management for Kashmir</p>
        </div>
        {err && <Note tone="bad">{err}</Note>}
        <Field label="Mobile number"><input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value.trim())} placeholder="94190 00000" required /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="faint" style={{ textAlign: 'center', margin: 0 }}>New orchard business? <Link to="/signup">Create an account</Link></p>
      </form>
    </div>
  );
}

export function Signup() {
  const [f, setF] = useState({ tenantName: '', name: '', phone: '', password: '', district: 'Shopian' });
  const { busy, err, run } = useSubmit();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => { e.preventDefault(); void run('/v1/auth/signup', f); };
  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <div>
          <h1>Create your orchard account</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>You become the owner. Add managers and sprayers later.</p>
        </div>
        {err && <Note tone="bad">{err}</Note>}
        <Field label="Business / orchard name"><input value={f.tenantName} onChange={set('tenantName')} placeholder="Mir Apple Orchards" required minLength={2} /></Field>
        <Field label="Your name"><input value={f.name} onChange={set('name')} required minLength={2} autoComplete="name" /></Field>
        <Field label="District"><select value={f.district} onChange={set('district')}>{DISTRICTS.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Mobile number"><input inputMode="tel" value={f.phone} onChange={set('phone')} required pattern="\+?[0-9]{10,13}" title="10–13 digits" autoComplete="tel" /></Field>
        <Field label="Password (min 8 characters)"><input type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" /></Field>
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="faint" style={{ textAlign: 'center', margin: 0 }}>Already registered? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
