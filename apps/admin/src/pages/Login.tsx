import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { adminApi, session } from '../api';
import { Field, Note } from '../ui';

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (session.token()) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await adminApi.login(email.trim(), password);
      session.set(r.token, r.admin);
      nav('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="card stack" onSubmit={(e) => void submit(e)}>
        <div className="brand" style={{ padding: 0 }}>
          <span style={{ fontSize: 26 }} aria-hidden>🍎</span>
          <div>Seb Orchard<small>Platform administration</small></div>
        </div>
        <p className="muted" style={{ margin: 0 }}>Staff only. Grower accounts cannot sign in here.</p>
        {error && <Note tone="bad">{error}</Note>}
        <Field label="Email">
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
