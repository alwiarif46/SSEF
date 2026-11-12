import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { synchronize as wmSync } from '@nozbe/watermelondb/sync';
import { database } from '../db';
import { collection, Q } from '../db/repo';
import { getBaseUrl, getToken, request } from '../api/client';
import { acceptedAppendOnly, countChanges, normalizePulled, preparePush, pullUrl, pushUrl, toRejectedIds, type Changes, type PushResponse } from './mapping';

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncedAt?: number;
  error?: string;
  rejected: PushResponse['rejected'];
  conflicts: PushResponse['conflicts'];
  pushed: number;
  pulled: number;
}

let status: SyncStatus = { state: 'idle', rejected: [], conflicts: [], pushed: 0, pulled: 0 };
const listeners = new Set<(s: SyncStatus) => void>();
const emit = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
};
export const getSyncStatus = () => status;
export function onSyncStatus(l: (s: SyncStatus) => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let running: Promise<void> | null = null;

/** Pull then push (WatermelonDB protocol). Safe to call repeatedly; concurrent calls coalesce. */
export function synchronize(): Promise<void> {
  if (running) return running;
  if (!getToken()) return Promise.resolve();
  running = (async () => {
    emit({ state: 'syncing', error: undefined });
    let pushed: Changes = {};
    let pushRes: PushResponse | undefined;
    let pulledCount = 0;
    try {
      await wmSync({
        database,
        sendCreatedAsUpdated: false,
        pullChanges: async ({ lastPulledAt }) => {
          const { data } = await request<{ changes: Changes; timestamp: number }>(pullUrl(getBaseUrl(), lastPulledAt));
          const changes = normalizePulled(data.changes);
          pulledCount = countChanges(changes);
          return { changes, timestamp: data.timestamp };
        },
        pushChanges: async ({ changes, lastPulledAt }) => {
          pushed = preparePush(changes as unknown as Changes);
          if (!countChanges(pushed)) return {};
          const { data } = await request<PushResponse>(pushUrl(getBaseUrl(), lastPulledAt), { method: 'POST', json: { changes: pushed } });
          pushRes = data;
          return { experimentalRejectedIds: toRejectedIds(data) };
        },
      });
      await lockAccepted(pushed, pushRes);
      emit({ state: 'idle', lastSyncedAt: Date.now(), rejected: pushRes?.rejected ?? [], conflicts: pushRes?.conflicts ?? [], pushed: countChanges(pushed), pulled: pulledCount });
    } catch (e) {
      emit({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Append-only rows accepted by the server are immutable: reflect `locked` locally without re-pushing. */
async function lockAccepted(pushed: Changes, res: PushResponse | undefined) {
  const accepted = acceptedAppendOnly(pushed, res);
  const entries = Object.entries(accepted);
  if (!entries.length) return;
  await database.write(async () => {
    const ops = [];
    for (const [table, ids] of entries) {
      const rows = await collection(table).query(Q.where('id', Q.oneOf(ids))).fetch();
      for (const r of rows.filter((x) => !x.bool('locked')))
        ops.push(r.prepareUpdate((m) => m._dangerouslySetRawWithoutMarkingColumnChange('locked', true)));
    }
    await database.batch(...ops);
  });
}

/** Auto-sync when the app returns to the foreground and when connectivity is restored. */
export function startAutoSync(): () => void {
  let wasConnected = true;
  const onApp = (s: AppStateStatus) => {
    if (s === 'active') void synchronize();
  };
  const appSub = AppState.addEventListener('change', onApp);
  const netUnsub = NetInfo.addEventListener((st) => {
    const connected = !!st.isConnected && st.isInternetReachable !== false;
    if (!connected) emit({ state: 'offline' });
    if (connected && !wasConnected) void synchronize();
    wasConnected = connected;
  });
  const timer = setInterval(() => void synchronize(), 15 * 60_000);
  void synchronize();
  return () => {
    appSub.remove();
    netUnsub();
    clearInterval(timer);
  };
}
