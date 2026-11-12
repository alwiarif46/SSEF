import { useState } from 'react';
import { session } from '../api';
import { useData } from '../data';
import { Card, PageHead } from '../ui';

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

// Apply stored theme on load.
try {
  const t = localStorage.getItem('seb.theme');
  if (t && t !== 'system') document.documentElement.setAttribute('data-theme', t);
} catch { /* ignore */ }
