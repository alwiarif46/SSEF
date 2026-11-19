import { useEffect, useState } from 'react';
import { api, session } from '../api';
import { useData } from '../data';
import { Card, Field, Note, PageHead, useToast } from '../ui';

const getTheme = () => { try { return localStorage.getItem('seb.theme') ?? 'system'; } catch { return 'system'; } };

export function Settings() {
  const { ref, refStatus } = useData();
  const [theme, setTheme] = useState(getTheme());
  const apply = (t: string) => {
    setTheme(t);
    try { localStorage.setItem('seb.theme', t); } catch { /* ignore */ }
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  };
  const user = session.user();
  return (
    <>
      <PageHead title="Settings & safety" />
      <div className="grid g2">
        <div className="stack">
          <Card title="Account">
            <div>{user?.name} · <span style={{ textTransform: 'capitalize' }}>{user?.role}</span></div>
            <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={() => { session.clear(); window.location.assign('/login'); }}>Sign out</button></div>
          </Card>
          <NotificationPrefs />
          <Card title="Appearance">
            <div className="seg">{['system', 'light', 'dark'].map((t) => <button key={t} className={theme === t ? 'on' : ''} onClick={() => apply(t)} style={{ textTransform: 'capitalize' }}>{t}</button>)}</div>
          </Card>
          <Card title="Reference data">
            <div className="stack" style={{ gap: 4 }}>
              <div>{ref.version.source}</div>
              <div className="faint">Version {ref.version.id} · status {refStatus.replace('_', ' ')} · {ref.chemicals.length} products · {ref.stages.length} stages</div>
              {ref.version.sourceUrl && <a href={ref.version.sourceUrl} target="_blank" rel="noreferrer">Official schedule (J&K Horticulture)</a>}
              <p className="faint" style={{ marginBottom: 0 }}>{ref.version.disclaimer}</p>
            </div>
          </Card>
        </div>
        <Card title="Applicator safety (SKUAST-K)">
          <h3 style={{ color: 'var(--ok)' }}>Do</h3>
          <ul>{ref.safety.filter((s) => s.kind === 'do').map((s) => <li key={s.id} style={{ margin: '4px 0' }}>{s.text}</li>)}</ul>
          <h3 style={{ color: 'var(--bad)' }}>Don't</h3>
          <ul>{ref.safety.filter((s) => s.kind === 'dont').map((s) => <li key={s.id} style={{ margin: '4px 0' }}>{s.text}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}

const ALERT_LABELS: Record<string, string> = {
  scab_infection: 'Scab infection',
  protect_before_rain: 'Protect before rain',
  codling_moth_dd: 'Codling moth (degree-days)',
  frost: 'Frost',
  hail: 'Hail',
  heat_stress: 'Heat stress',
  spray_window: 'Spray window',
};

interface Prefs { alertTypes: string[] | null; minSeverity: string; quietHoursStart: string | null; quietHoursEnd: string | null; smsFallback: boolean }
interface PrefsResponse extends Prefs { options: { alertTypes: string[]; severities: string[] } }

function NotificationPrefs() {
  const toast = useToast();
  const [p, setP] = useState<Prefs | null>(null);
  const [opts, setOpts] = useState<PrefsResponse['options']>({ alertTypes: Object.keys(ALERT_LABELS), severities: ['low', 'medium', 'high', 'critical'] });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<PrefsResponse>('/v1/me/notifications')
      .then(({ options, ...prefs }) => { setP(prefs); setOpts(options); })
      .catch((e) => setErr((e as Error).message));
  }, []);
  if (!p) return <Card title="Alert notifications">{err ? <Note tone="bad">{err}</Note> : <span className="faint">Loading…</span>}</Card>;
  const all = p.alertTypes == null;
  const types = new Set(p.alertTypes ?? opts.alertTypes);
  const flip = (t: string) => {
    const n = new Set(types);
    if (n.has(t)) n.delete(t); else n.add(t);
    setP({ ...p, alertTypes: opts.alertTypes.every((x) => n.has(x)) ? null : opts.alertTypes.filter((x) => n.has(x)) });
  };
  const quiet = p.quietHoursStart != null;
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const saved = await api<Prefs>('/v1/me/notifications', { method: 'PUT', body: p });
      setP(saved);
      toast('Notification preferences saved');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card title="Alert notifications">
      <div className="stack">
        {err && <Note tone="bad">{err}</Note>}
        <div>
          <div className="muted" style={{ marginBottom: 6 }}>Alert types {all && <span className="faint">(all)</span>}</div>
          {opts.alertTypes.map((t) => (
            <label key={t} className="f check"><input type="checkbox" checked={types.has(t)} onChange={() => flip(t)} />{ALERT_LABELS[t] ?? t}</label>
          ))}
        </div>
        <Field label="Minimum severity">
          <select value={p.minSeverity} onChange={(e) => setP({ ...p, minSeverity: e.target.value })}>
            {opts.severities.map((s) => <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>)}
          </select>
        </Field>
        <label className="f check">
          <input type="checkbox" checked={quiet} onChange={() => setP(quiet ? { ...p, quietHoursStart: null, quietHoursEnd: null } : { ...p, quietHoursStart: '21:00', quietHoursEnd: '06:00' })} />
          Quiet hours (IST) — only critical alerts get through
        </label>
        {quiet && (
          <div className="row">
            <Field label="From"><input type="time" value={p.quietHoursStart ?? ''} onChange={(e) => setP({ ...p, quietHoursStart: e.target.value || null })} required /></Field>
            <Field label="To"><input type="time" value={p.quietHoursEnd ?? ''} onChange={(e) => setP({ ...p, quietHoursEnd: e.target.value || null })} required /></Field>
          </div>
        )}
        <label className="f check">
          <input type="checkbox" checked={p.smsFallback} onChange={() => setP({ ...p, smsFallback: !p.smsFallback })} />
          SMS me critical alerts when this account has no phone app for push notifications
        </label>
        <div><button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save preferences'}</button></div>
      </div>
    </Card>
  );
}

// Apply stored theme on load.
try {
  const t = localStorage.getItem('seb.theme');
  if (t && t !== 'system') document.documentElement.setAttribute('data-theme', t);
} catch { /* ignore */ }
