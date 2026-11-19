import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, session, type SessionUser } from '../api';
import { Field, Note } from '../ui';

const DISTRICTS = ['Anantnag', 'Bandipora', 'Baramulla', 'Budgam', 'Ganderbal', 'Kulgam', 'Kupwara', 'Pulwama', 'Shopian', 'Srinagar', 'Kargil', 'Leh'];
const PHONE_PATTERN = '\\+?[0-9]{10,13}';

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  /** Run `fn`; on a session result, sign in and go home. */
  const exec = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      setErr((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const signIn = (r: { token: string; user: SessionUser }) => {
    session.set(r.token, r.user);
    nav('/', { replace: true });
  };
  const run = async (path: string, body: unknown) => {
    const r = await exec(() => api<{ token: string; user: SessionUser }>(path, { body }));
    if (r) signIn(r);
  };
  return { busy, err, setErr, exec, signIn, run };
}

type Mode = 'password' | 'otp' | 'forgot';

function Brand() {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 40 }} aria-hidden>🍎</div>
      <h1>Seb Orchard</h1>
      <p className="muted" style={{ margin: '4px 0 0' }}>Apple orchard management for Kashmir</p>
    </div>
  );
}

export function Login() {
  const [mode, setMode] = useState<Mode>('password');
  return (
    <div className="auth">
      {mode === 'password' && <PasswordLogin onMode={setMode} />}
      {mode === 'otp' && <OtpLogin onBack={() => setMode('password')} />}
      {mode === 'forgot' && <ForgotPassword onBack={() => setMode('password')} />}
    </div>
  );
}

function PasswordLogin({ onMode }: { onMode: (m: Mode) => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const { busy, err, run } = useSubmit();
  const submit = (e: FormEvent) => { e.preventDefault(); void run('/v1/auth/login', { phone, password }); };
  return (
    <form className="card stack" onSubmit={submit}>
      <Brand />
      {err && <Note tone="bad">{err}</Note>}
      <Field label="Mobile number"><input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value.trim())} placeholder="94190 00000" required /></Field>
      <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost sm" onClick={() => onMode('otp')}>Log in with OTP</button>
        <button type="button" className="btn ghost sm" onClick={() => onMode('forgot')}>Forgot password?</button>
      </div>
      <p className="faint" style={{ textAlign: 'center', margin: 0 }}>New orchard business? <Link to="/signup">Create an account</Link></p>
    </form>
  );
}

/** Phone → SMS code step shared by OTP login and password reset. */
function useOtp(purpose: 'login' | 'reset') {
  const s = useSubmit();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const request = async () => {
    const r = await s.exec(() => api<{ ok: true; expiresInSec: number }>('/v1/auth/otp/request', { body: { phone, purpose } }));
    if (r) { setSentTo(phone); setCode(''); }
  };
  return { ...s, phone, setPhone, code, setCode, sentTo, setSentTo, request };
}

function PhoneStep({ o, title, sub, onBack }: { o: ReturnType<typeof useOtp>; title: string; sub: string; onBack: () => void }) {
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); void o.request(); }}>
      <div>
        <h1>{title}</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>{sub}</p>
      </div>
      {o.err && <Note tone="bad">{o.err}</Note>}
      <Field label="Mobile number"><input inputMode="tel" autoComplete="tel" value={o.phone} onChange={(e) => o.setPhone(e.target.value.trim())} required pattern={PHONE_PATTERN} title="10–13 digits" /></Field>
      <button className="btn primary" disabled={o.busy}>{o.busy ? 'Sending…' : 'Send code'}</button>
      <button type="button" className="btn ghost sm" onClick={onBack}>Back to sign in</button>
    </form>
  );
}

function CodeField({ o }: { o: ReturnType<typeof useOtp> }) {
  return (
    <>
      <Note tone="info">If {o.sentTo} is registered, a 6-digit code is on its way by SMS. It expires in 5 minutes.</Note>
      <Field label="SMS code"><input inputMode="numeric" autoComplete="one-time-code" value={o.code} onChange={(e) => o.setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} required minLength={4} maxLength={8} pattern="[0-9]{4,8}" /></Field>
    </>
  );
}

function OtpLogin({ onBack }: { onBack: () => void }) {
  const o = useOtp('login');
  if (!o.sentTo) return <PhoneStep o={o} title="Sign in with OTP" sub="We will send a one-time code to your mobile." onBack={onBack} />;
  const submit = (e: FormEvent) => { e.preventDefault(); void o.run('/v1/auth/otp/verify', { phone: o.sentTo, code: o.code, purpose: 'login' }); };
  return (
    <form className="card stack" onSubmit={submit}>
      <h1>Enter the code</h1>
      {o.err && <Note tone="bad">{o.err}</Note>}
      <CodeField o={o} />
      <button className="btn primary" disabled={o.busy || o.code.length < 4}>{o.busy ? 'Checking…' : 'Sign in'}</button>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost sm" disabled={o.busy} onClick={() => void o.request()}>Resend code</button>
        <button type="button" className="btn ghost sm" onClick={() => o.setSentTo(null)}>Change number</button>
      </div>
    </form>
  );
}

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const o = useOtp('reset');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [pw, setPw] = useState({ a: '', b: '' });
  if (!o.sentTo) return <PhoneStep o={o} title="Reset your password" sub="Verify your mobile number with an SMS code, then choose a new password." onBack={onBack} />;
  if (!resetToken) {
    const verify = async (e: FormEvent) => {
      e.preventDefault();
      const r = await o.exec(() => api<{ resetToken: string }>('/v1/auth/otp/verify', { body: { phone: o.sentTo, code: o.code, purpose: 'reset' } }));
      if (r) setResetToken(r.resetToken);
    };
    return (
      <form className="card stack" onSubmit={verify}>
        <h1>Enter the code</h1>
        {o.err && <Note tone="bad">{o.err}</Note>}
        <CodeField o={o} />
        <button className="btn primary" disabled={o.busy || o.code.length < 4}>{o.busy ? 'Checking…' : 'Continue'}</button>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn ghost sm" disabled={o.busy} onClick={() => void o.request()}>Resend code</button>
          <button type="button" className="btn ghost sm" onClick={onBack}>Cancel</button>
        </div>
      </form>
    );
  }
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.a !== pw.b) { o.setErr('passwords do not match'); return; }
    const ok = await o.exec(() => api('/v1/auth/password/reset', { body: { resetToken, password: pw.a } }));
    if (ok) await o.run('/v1/auth/login', { phone: o.sentTo, password: pw.a });
  };
  return (
    <form className="card stack" onSubmit={save}>
      <h1>Choose a new password</h1>
      {o.err && <Note tone="bad">{o.err}</Note>}
      <Field label="New password (min 8 characters)"><input type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} required minLength={8} maxLength={128} /></Field>
      <Field label="Repeat new password"><input type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} required minLength={8} maxLength={128} /></Field>
      <button className="btn primary" disabled={o.busy}>{o.busy ? 'Saving…' : 'Save and sign in'}</button>
      <button type="button" className="btn ghost sm" onClick={onBack}>Cancel</button>
    </form>
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
        <Field label="Mobile number"><input inputMode="tel" value={f.phone} onChange={set('phone')} required pattern={PHONE_PATTERN} title="10–13 digits" autoComplete="tel" /></Field>
        <Field label="Password (min 8 characters)"><input type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" /></Field>
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="faint" style={{ textAlign: 'center', margin: 0 }}>Already registered? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
