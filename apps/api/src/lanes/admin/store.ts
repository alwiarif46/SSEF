import type { Tx } from '../../db.js';

/** Typed wrappers around the admin SECURITY DEFINER functions (migration 006_admin.sql). */

export interface TenantSummary {
  id: string; name: string; plan: string; billing_status: string; district: string | null; created_at: string;
  users: number; orchards: number; blocks: number; sprays_this_season: number; last_activity_at: string | null;
}

export interface WorkerRun {
  id: number; started_at: string; finished_at: string | null; orchards: number | null; hours: number | null; alerts: number | null;
  new_alerts: number | null; pushed: number | null; errors: { orchardId: string; error: string }[]; provider: string;
}

export interface AuditEntry {
  id: number; admin_id: string | null; admin_email: string | null; admin_name: string | null; action: string; target: string | null;
  detail: Record<string, unknown>; created_at: string;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

export async function listTenants(tx: Tx): Promise<TenantSummary[]> {
  const { rows } = await tx.query('SELECT * FROM app.admin_list_tenants()');
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at)!, last_activity_at: iso(r.last_activity_at) }));
}

export async function setTenantPlan(tx: Tx, tenantId: string, plan: string | null, billingStatus: string | null) {
  const { rows } = await tx.query('SELECT * FROM app.admin_set_tenant_plan($1, $2, $3)', [tenantId, plan, billingStatus]);
  return rows[0] as { id: string; name: string; plan: string; billing_status: string; previous_plan: string; previous_billing_status: string } | undefined;
}

export async function listWorkerRuns(tx: Tx, limit: number): Promise<WorkerRun[]> {
  const { rows } = await tx.query('SELECT * FROM app.admin_list_worker_runs($1)', [limit]);
  return rows.map((r) => ({ ...r, started_at: iso(r.started_at)!, finished_at: iso(r.finished_at) }));
}

export async function listAudit(tx: Tx, limit: number, before: number | null): Promise<AuditEntry[]> {
  const { rows } = await tx.query('SELECT * FROM app.admin_list_audit($1, $2)', [limit, before]);
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at)! }));
}

export async function recordAudit(tx: Tx, adminId: string | null, action: string, target: string | null, detail: Record<string, unknown> = {}): Promise<number> {
  const { rows } = await tx.query('SELECT app.admin_record_audit($1, $2, $3, $4::jsonb) AS id', [adminId, action, target, JSON.stringify(detail)]);
  return rows[0].id;
}

export type WorkerHealth = 'ok' | 'degraded' | 'failing' | 'stale' | 'running' | 'unknown';

/** Health of the weather worker from its latest runs. */
export function workerHealth(runs: WorkerRun[], intervalMin: number, now = Date.now()): { status: WorkerHealth; lastRunAt: string | null; message: string } {
  const last = runs[0];
  if (!last) return { status: 'unknown', lastRunAt: null, message: 'No worker runs recorded yet.' };
  const finished = runs.find((r) => r.finished_at);
  const staleAfter = Math.max(3 * intervalMin, 15) * 60_000;
  if (now - Date.parse(last.started_at) > staleAfter)
    return { status: 'stale', lastRunAt: last.started_at, message: `No run started in the last ${Math.round(staleAfter / 60_000)} min.` };
  if (!last.finished_at) {
    // A run that has been "running" for longer than an interval probably crashed.
    if (now - Date.parse(last.started_at) > intervalMin * 60_000) return { status: 'failing', lastRunAt: last.started_at, message: 'Latest run never finished.' };
    if (!finished) return { status: 'running', lastRunAt: last.started_at, message: 'First run in progress.' };
  }
  const r = last.finished_at ? last : finished!;
  const errs = r.errors.length;
  if (errs && !r.orchards) return { status: 'failing', lastRunAt: r.started_at, message: `Last run failed for every orchard (${errs} error${errs > 1 ? 's' : ''}).` };
  if (errs) return { status: 'degraded', lastRunAt: r.started_at, message: `Last run had ${errs} orchard error${errs > 1 ? 's' : ''}.` };
  return { status: last.finished_at ? 'ok' : 'running', lastRunAt: r.started_at, message: `Last run processed ${r.orchards ?? 0} orchard(s).` };
}
