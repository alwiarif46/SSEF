import { withoutTenant, type Db } from '../../db.js';

/** Worker run log writers (app.worker_run_start / app.worker_run_finish). */

export interface RunTotals {
  orchards: number;
  hours: number;
  alerts: number;
  newAlerts: number;
  errors: { orchardId: string; error: string }[];
}

const MAX_ERRORS = 200;
const MAX_ERROR_LEN = 500;

export async function workerRunStart(db: Db, provider: string): Promise<number> {
  return withoutTenant(db, async (tx) => (await tx.query('SELECT app.worker_run_start($1) AS id', [provider])).rows[0].id);
}

export async function workerRunFinish(db: Db, runId: number, totals: RunTotals, pushed: number | null): Promise<void> {
  const errors = totals.errors.slice(0, MAX_ERRORS).map((e) => ({ orchardId: e.orchardId, error: e.error.slice(0, MAX_ERROR_LEN) }));
  if (totals.errors.length > MAX_ERRORS) errors.push({ orchardId: '*', error: `${totals.errors.length - MAX_ERRORS} more errors not shown` });
  await withoutTenant(db, (tx) => tx.query('SELECT app.worker_run_finish($1, $2, $3, $4, $5, $6, $7::jsonb)', [
    runId, totals.orchards, totals.hours, totals.alerts, totals.newAlerts, pushed, JSON.stringify(errors),
  ]));
}
