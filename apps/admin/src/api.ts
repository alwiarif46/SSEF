import type { ReferenceBundle } from '@orchard/reference';

/** Admin session lives in sessionStorage (closes with the tab) under keys distinct from the grower app. */
const TOKEN_KEY = 'seb.admin.token';
const ADMIN_KEY = 'seb.admin.profile';

export interface AdminProfile { id: string; email: string; name: string }

const safe = <T,>(fn: () => T, fallback: T): T => {
  try { return fn(); } catch { return fallback; }
};

export const session = {
  token: () => safe(() => sessionStorage.getItem(TOKEN_KEY), null),
  admin: (): AdminProfile | null => safe(() => JSON.parse(sessionStorage.getItem(ADMIN_KEY) ?? 'null') as AdminProfile | null, null),
  set(token: string, admin: AdminProfile) {
    safe(() => { sessionStorage.setItem(TOKEN_KEY, token); sessionStorage.setItem(ADMIN_KEY, JSON.stringify(admin)); }, undefined);
  },
  clear() {
    safe(() => { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(ADMIN_KEY); }, undefined);
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = session.token();
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status === 401 && token) {
    session.clear();
    window.location.assign('/login');
  }
  const ct = res.headers.get('content-type') ?? '';
  const data: unknown = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const obj = typeof data === 'object' && data ? (data as Record<string, unknown>) : {};
    const msg = typeof obj.error === 'string' ? obj.error : `HTTP ${res.status}`;
    const issues = Array.isArray(obj.issues) ? (obj.issues as { message: string }[]).map((i) => i.message).join('; ') : '';
    throw new ApiError(res.status, issues ? `${msg}: ${issues}` : msg, data);
  }
  return data as T;
}

// ── Wire types (mirror apps/api/src/lanes/admin) ────────────────────────────

export type BillingStatus = 'trial' | 'active' | 'past_due' | 'cancelled';
export interface TenantSummary {
  id: string; name: string; plan: string; billing_status: BillingStatus; district: string | null; created_at: string;
  users: number; orchards: number; blocks: number; sprays_this_season: number; last_activity_at: string | null;
}

export type WorkerHealth = 'ok' | 'degraded' | 'failing' | 'stale' | 'running' | 'unknown';
export interface WorkerRun {
  id: number; started_at: string; finished_at: string | null; orchards: number | null; hours: number | null; alerts: number | null;
  new_alerts: number | null; pushed: number | null; errors: { orchardId: string; error: string }[]; provider: string;
}
export interface WorkerRunsResponse { runs: WorkerRun[]; health: { status: WorkerHealth; lastRunAt: string | null; message: string }; intervalMin: number }

export interface ReferenceVersion {
  version_id: string; season: number; status: 'draft' | 'under_review' | 'published' | 'superseded'; etag: string;
  published_at: string | null; created_at: string; source: string | null; verified_by: string | null; verified_at: string | null;
  stages: number; recommendations: number; chemicals: number;
}
export interface ReferenceList { current: { versionId: string; etag: string; status: string }; versions: ReferenceVersion[] }

export interface EntityDiff { added: { id: string; label: string }[]; removed: { id: string; label: string }[]; changed: { id: string; label: string; fields: string[] }[] }
export interface Dose { dosePer100L: number; doseUnit: string }
export interface DoseChange { kind: 'added' | 'removed' | 'changed'; stageId: string; stage: string; recommendationId: string; chemicalId: string; product: string; before: Dose | null; after: Dose | null }
export interface BundleDiff {
  against: { versionId: string; season: number; status: string };
  version: string[];
  stages: EntityDiff; recommendations: EntityDiff; chemicals: EntityDiff;
  chemicalStatus: { chemicalId: string; product: string; before: string; after: string }[];
  doseChanges: DoseChange[];
  summary: { added: number; removed: number; changed: number; doseChanges: number };
}
export interface ImpactEntry { recommendationId: string; stage: string; affected: { chemicalId: string; product: string; status: string; reason: string }[]; alternatives: string[] }
export interface ValidateResponse { ok: boolean; errors: string[]; regulatoryImpact: ImpactEntry[]; diff: BundleDiff | null; against: { versionId: string; etag: string } }
export interface PublishResponse { version_id: string; season: number; status: string; etag: string; published_at: string | null; superseded: string[]; warnings: string[] }

export interface AuditEntry {
  id: number; admin_id: string | null; admin_email: string | null; admin_name: string | null; action: string; target: string | null;
  detail: Record<string, unknown>; created_at: string;
}

export const adminApi = {
  login: (email: string, password: string) => api<{ token: string; admin: AdminProfile }>('/v1/admin/login', { body: { email, password } }),
  me: () => api<AdminProfile>('/v1/admin/me'),
  tenants: () => api<TenantSummary[]>('/v1/admin/tenants'),
  setPlan: (id: string, body: { plan?: string; billing_status?: BillingStatus }) => api<Pick<TenantSummary, 'id' | 'name' | 'plan' | 'billing_status'>>(`/v1/admin/tenants/${id}`, { method: 'PATCH', body }),
  workerRuns: (limit = 100) => api<WorkerRunsResponse>(`/v1/admin/worker-runs?limit=${limit}`),
  reference: () => api<ReferenceList>('/v1/admin/reference'),
  referenceBundle: (versionId: string) => api<ReferenceBundle>(`/v1/admin/reference/${encodeURIComponent(versionId)}`),
  validate: (bundle: unknown) => api<ValidateResponse>('/v1/admin/reference/validate', { body: bundle }),
  publish: (body: { bundle: unknown; status: 'draft' | 'under_review' | 'published'; verifiedBy?: string }) => api<PublishResponse>('/v1/admin/reference/publish', { body }),
  audit: (limit = 100, before?: number) => api<AuditEntry[]>(`/v1/admin/audit?limit=${limit}${before ? `&before=${before}` : ''}`),
};
