import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { session } from './api';
import { DataProvider, useData } from './data';
import { ToastProvider } from './ui';
import { Login, Signup } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { Orchards, OrchardDetail } from './pages/Orchards';
import { BlockDetail } from './pages/Block';
import { Alerts } from './pages/Alerts';
import { Tasks } from './pages/Tasks';
import { Inventory } from './pages/Inventory';
import { Schedule, Chemicals } from './pages/Schedule';
import { Reports } from './pages/Reports';
import { Team } from './pages/Team';
import { Settings } from './pages/Settings';
import { TankCalc } from './pages/TankCalc';

const NAV: { to: string; label: string; icon: string; min?: 'manager' | 'owner'; sep?: string }[] = [
  { to: '/', label: 'Today', icon: '◐' },
  { to: '/orchards', label: 'Orchards', icon: '🌳' },
  { to: '/alerts', label: 'Alerts', icon: '⚠' },
  { to: '/tasks', label: 'Tasks', icon: '✓' },
  { to: '/inventory', label: 'Inventory', icon: '▤' },
  { to: '/tank', label: 'Tank calculator', icon: '⚗' },
  { to: '/schedule', label: 'Spray schedule', icon: '☰', sep: 'Reference' },
  { to: '/chemicals', label: 'Chemicals', icon: '⚑' },
  { to: '/reports', label: 'Reports', icon: '▦', min: 'manager', sep: 'Business' },
  { to: '/team', label: 'Team', icon: '👥', min: 'manager' },
  { to: '/settings', label: 'Settings & safety', icon: '⚙' },
];

const rank = { worker: 1, manager: 2, owner: 3 } as const;

function Shell({ children }: { children: ReactNode }) {
  const user = session.user();
  const { lastSync, error, refresh, tables } = useData();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const openAlerts = (tables.infection_alerts ?? []).filter((a) => !a.acknowledged).length;
  const items = NAV.filter((n) => !n.min || rank[user?.role ?? 'worker'] >= rank[n.min]);
  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <span style={{ fontSize: 26 }} aria-hidden>🍎</span>
          <div>Seb Orchard<small>Kashmir apple management</small></div>
        </div>
        <nav className="nav">
          {items.map((n) => (
            <div key={n.to}>
              {n.sep && <div className="nav-sep">{n.sep}</div>}
              <NavLink to={n.to} end={n.to === '/'}>
                <span aria-hidden style={{ width: 18, textAlign: 'center' }}>{n.icon}</span>
                {n.label}
                {n.to === '/alerts' && openAlerts > 0 && <span className="badge bad" style={{ marginLeft: 'auto' }}>{openAlerts}</span>}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div style={{ color: 'var(--text)', fontWeight: 600 }}>{user?.name}</div>
          <div style={{ textTransform: 'capitalize' }}>{user?.role}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => void refresh()} title="Sync now">⟳ Sync</button>
            <button className="btn sm ghost" onClick={() => { session.clear(); window.location.assign('/login'); }}>Sign out</button>
          </div>
          <div style={{ marginTop: 6 }}>{error ? <span style={{ color: 'var(--bad)' }}>Offline: {error}</span> : lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Syncing…'}</div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div style={{ minWidth: 0 }}>
        <div className="topbar">
          <button className="btn sm" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <b>🍎 Seb Orchard</b>
          {openAlerts > 0 && <NavLink to="/alerts" className="badge bad" style={{ marginLeft: 'auto' }}>{openAlerts} alerts</NavLink>}
        </div>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

function Protected() {
  if (!session.token()) return <Navigate to="/login" replace />;
  return (
    <DataProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orchards" element={<Orchards />} />
          <Route path="/orchards/:id" element={<OrchardDetail />} />
          <Route path="/blocks/:id" element={<BlockDetail />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/tank" element={<TankCalc />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/chemicals" element={<Chemicals />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/team" element={<Team />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </DataProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/*" element={<Protected />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
);
