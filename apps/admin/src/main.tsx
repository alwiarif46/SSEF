import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import './admin.css';
import { adminApi, session, type WorkerRunsResponse } from './api';
import { ToastProvider, fmtAgo } from './ui';
import { Login } from './pages/Login';
import { Tenants } from './pages/Tenants';
import { HealthDot, WorkerRuns } from './pages/WorkerRuns';
import { Reference } from './pages/Reference';
import { Audit } from './pages/Audit';

const NAV = [
  { to: '/', label: 'Tenants', icon: '🏢' },
  { to: '/worker', label: 'Worker runs', icon: '⟳' },
  { to: '/reference', label: 'Reference data', icon: '☰' },
  { to: '/audit', label: 'Audit log', icon: '⚑' },
];

/** Sidebar worker health, refreshed every minute. */
function useWorkerHealth() {
  const [h, setH] = useState<WorkerRunsResponse['health'] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => adminApi.workerRuns(5).then((r) => { if (live) setH(r.health); }, () => {});
    void load();
    const t = window.setInterval(load, 60_000);
    return () => { live = false; window.clearInterval(t); };
  }, []);
  return h;
}

function Shell({ children }: { children: ReactNode }) {
  const admin = session.admin();
  const health = useWorkerHealth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  // Re-check the session on load: a deactivated admin is signed out by the 401 handler.
  useEffect(() => { void adminApi.me().catch(() => {}); }, []);
  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <span style={{ fontSize: 26 }} aria-hidden>🍎</span>
          <div>Seb Orchard<small>Platform admin</small></div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              <span aria-hidden style={{ width: 18, textAlign: 'center' }}>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          {health && (
            <NavLink to="/worker" style={{ display: 'block', marginBottom: 10 }} title={health.message}>
              <div className="faint">Weather worker</div>
              <HealthDot status={health.status} /> <span className="faint">{fmtAgo(health.lastRunAt)}</span>
            </NavLink>
          )}
          <div style={{ color: 'var(--text)', fontWeight: 600 }}>{admin?.name}</div>
          <div>{admin?.email}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm ghost" onClick={() => { session.clear(); window.location.assign('/login'); }}>Sign out</button>
          </div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div style={{ minWidth: 0 }}>
        <div className="topbar">
          <button className="btn sm" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <b>🍎 Seb Orchard admin</b>
          {health && <span style={{ marginLeft: 'auto' }}><HealthDot status={health.status} /></span>}
        </div>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

function Protected() {
  if (!session.token()) return <Navigate to="/login" replace />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Tenants />} />
        <Route path="/worker" element={<WorkerRuns />} />
        <Route path="/reference" element={<Reference />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<Protected />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
);
