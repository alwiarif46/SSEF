import { SYNC_SCHEMA_VERSION } from '@orchard/domain';

const TOKEN_KEY = 'seb.token';
const USER_KEY = 'seb.user';

export interface SessionUser { id: string; name: string; role: 'owner' | 'manager' | 'worker'; phone?: string }

const safe = <T,>(fn: () => T, fallback: T): T => {
  try { return fn(); } catch { return fallback; }
};

export const session = {
  token: () => safe(() => localStorage.getItem(TOKEN_KEY), null),
  user: (): SessionUser | null => safe(() => JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'), null),
  set(token: string, user: SessionUser) {
    safe(() => { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); }, undefined);
  },
  clear() {
    safe(() => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }, undefined);
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const token = session.token();
  const res = await fetch(path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status === 401 && token) {
    session.clear();
    window.location.assign('/login');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof data === 'object' && data && 'error' in data ? String((data as { error: string }).error) : `HTTP ${res.status}`;
    const issues = typeof data === 'object' && data && 'issues' in data ? (data as { issues: { message: string }[] }).issues.map((i) => i.message).join('; ') : '';
    throw new ApiError(res.status, issues ? `${msg}: ${issues}` : msg, data);
  }
  return data as T;
}

export type WireRow = Record<string, unknown> & { id: string };
export interface PullResponse { changes: Record<string, { created: WireRow[]; updated: WireRow[]; deleted: string[] }>; timestamp: number }
export interface PushResponse { ok: boolean; rejected: { table: string; id: string; reason: string }[]; conflicts: { table: string; id: string; fields: string[] }[]; flags: { table: string; id: string; violations: { code: string; severity: string; message: string }[] }[] }

export const pullChanges = (since: number) => api<PullResponse>(`/v1/sync?last_pulled_at=${since}&schema_version=${SYNC_SCHEMA_VERSION}`);
export const pushChanges = (changes: PullResponse['changes'], since: number) => api<PushResponse>(`/v1/sync?last_pulled_at=${since}`, { body: { changes } });

export async function downloadFile(path: string, filename: string) {
  const res = await fetch(path, { headers: { authorization: `Bearer ${session.token()}` } });
  if (!res.ok) throw new ApiError(res.status, `download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
