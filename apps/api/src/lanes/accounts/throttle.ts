import type { Tx } from '../../db.js';
import { accountsConfig } from './config.js';

/**
 * Postgres-backed login throttle (shared across API instances). Counters live in
 * app.login_throttle and are reachable only through SECURITY DEFINER functions.
 */
export const loginThrottle = {
  /** Seconds until this phone / IP may try again; 0 when allowed. */
  async retryAfter(tx: Tx, phone: string, ip: string | undefined): Promise<number> {
    const { rows } = await tx.query<{ s: number }>('SELECT app.login_retry_after($1, $2) AS s', [phone, ip ?? null]);
    return Number(rows[0]?.s ?? 0);
  },
  /** Record a failure; true when the phone or IP is now locked. */
  async failed(tx: Tx, phone: string, ip: string | undefined): Promise<boolean> {
    const l = accountsConfig.login;
    const { rows } = await tx.query<{ locked: boolean }>('SELECT app.login_failed($1, $2, $3, $4, $5, $6) AS locked', [
      phone, ip ?? null, l.phoneMaxFailures, l.ipMaxFailures, l.lockMinutes, l.windowMinutes,
    ]);
    return !!rows[0]?.locked;
  },
  async succeeded(tx: Tx, phone: string): Promise<void> {
    await tx.query('SELECT app.login_succeeded($1)', [phone]);
  },
};
