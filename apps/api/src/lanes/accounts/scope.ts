import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, RouteHandlerMethod } from 'fastify';
import type { TableDef } from '@orchard/domain';
import type { Principal } from '../../auth.js';
import type { Tx } from '../../db.js';

/**
 * Worker orchard scoping.
 *
 * A WORKER with at least one row in public.user_orchards only sees (sync pull)
 * and may only write (sync push) rows that belong to those orchards. Workers
 * without assignments, managers and owners see the whole tenant (backward
 * compatible). Tables without an orchard link (chemical_inventory) are shared.
 */
export interface SyncScope {
  userId: string;
  /** true when the viewer is a worker with ≥1 assignment. */
  restricted: boolean;
  orchardIds: string[];
  /** When the viewer's assignment set last changed (null = never). */
  changedAt: Date | null;
}

export async function loadScope(tx: Tx, p: Principal): Promise<SyncScope> {
  const { rows: [u] } = await tx.query<{ changed: Date | null }>('SELECT orchard_scope_changed_at AS changed FROM public.users WHERE id = $1', [p.userId]);
  const changedAt = u?.changed ?? null;
  if (p.role !== 'worker') return { userId: p.userId, restricted: false, orchardIds: [], changedAt };
  const { rows } = await tx.query<{ orchard_id: string }>('SELECT orchard_id FROM public.user_orchards WHERE user_id = $1 ORDER BY orchard_id', [p.userId]);
  const orchardIds = rows.map((r) => r.orchard_id);
  return { userId: p.userId, restricted: orchardIds.length > 0, orchardIds, changedAt };
}

const has = (t: TableDef, col: string) => t.columns.some((c) => c.name === col);

/**
 * SQL predicate restricting `t` to the scope; `bind` registers a parameter and
 * returns its placeholder. null = table is not orchard-linked (no restriction).
 */
export function scopePredicate(t: TableDef, scope: SyncScope, bind: (v: unknown) => string): string | null {
  const o = () => `${bind(scope.orchardIds)}::text[]`;
  if (t.name === 'orchards') return `id = ANY(${o()})`;
  if (t.name === 'tasks') return `(orchard_id = ANY(${o()}) OR assignee_user_id = ${bind(scope.userId)}::text)`;
  if (has(t, 'orchard_id')) return `orchard_id = ANY(${o()})`;
  if (has(t, 'block_id')) return `block_id IN (SELECT b.id FROM public.blocks b WHERE b.orchard_id = ANY(${o()}))`;
  return null;
}

export class OutOfScope extends Error {
  constructor() { super('orchard not assigned to you'); }
}

type RowLike = Record<string, unknown> | undefined;

async function blockOrchard(tx: Tx, blockId: unknown): Promise<string | undefined> {
  if (typeof blockId !== 'string' || !blockId) return undefined;
  const { rows: [b] } = await tx.query<{ orchard_id: string }>('SELECT orchard_id FROM public.blocks WHERE id = $1', [blockId]);
  return b?.orchard_id;
}

/**
 * Throws OutOfScope when a restricted worker writes (creates, updates or deletes)
 * a row outside their orchards. Both the stored row and the incoming values are
 * checked, so a row can neither be edited in nor moved into another orchard.
 */
export async function assertWritable(tx: Tx, scope: SyncScope | null, t: TableDef, existing: RowLike, incoming: RowLike): Promise<void> {
  if (!scope?.restricted) return;
  const allowed = new Set(scope.orchardIds);
  const orchardsOf = async (row: RowLike): Promise<(string | undefined)[]> => {
    if (!row) return [];
    if (t.name === 'orchards') return [row.id as string | undefined];
    if (has(t, 'orchard_id')) return 'orchard_id' in row && row.orchard_id != null ? [String(row.orchard_id)] : [];
    if (has(t, 'block_id')) return 'block_id' in row && row.block_id != null ? [await blockOrchard(tx, row.block_id)] : [];
    return [];
  };
  if (t.name === 'tasks' && existing && existing.assignee_user_id === scope.userId) {
    // Their own task: may update it, but not move it into an unassigned orchard.
    if (incoming && 'orchard_id' in incoming && incoming.orchard_id != null && incoming.orchard_id !== existing.orchard_id && !allowed.has(String(incoming.orchard_id))) throw new OutOfScope();
    return;
  }
  if (!has(t, 'orchard_id') && !has(t, 'block_id') && t.name !== 'orchards') return;
  const ids = [...(await orchardsOf(existing)), ...(await orchardsOf(incoming))];
  // Unknown parents (undefined) are left to the composite FKs ("parent record not found").
  for (const id of ids) if (id !== undefined && !allowed.has(id)) throw new OutOfScope();
}

// ── Viewer propagation for GET /v1/sync ──────────────────────────────────────
// app.ts calls pull(tx, lastPulledAt) without the principal; the route handler is
// wrapped (root onRoute hook) so pull() can read the authenticated viewer.
const viewer = new AsyncLocalStorage<Principal | null>();

export const currentSyncViewer = (): Principal | undefined => viewer.getStore() ?? undefined;

export function installSyncScope(app: FastifyInstance) {
  app.addHook('onRoute', (opts) => {
    const methods = Array.isArray(opts.method) ? opts.method : [opts.method];
    if (opts.url !== '/v1/sync' || !methods.includes('GET')) return;
    const handler = opts.handler as RouteHandlerMethod;
    const wrapped: RouteHandlerMethod = function (this: FastifyInstance, req, reply) {
      return viewer.run(req.principal ?? null, () => handler.call(this, req, reply));
    };
    opts.handler = wrapped;
  });
}
