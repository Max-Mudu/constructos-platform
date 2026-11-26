/**
 * useOfflineQueue — the signed-in user's offline entries for a screen:
 * pending ones, failed ones (with the reason) and recently synced ones, plus
 * Sync now / Retry / Dismiss. Automatic syncing lives in OfflineSyncRunner.
 */
import { useCallback, useEffect, useReducer } from 'react';
import { useAuthStore } from '../store/auth.store';
import { offlineQueue } from '../utils/offlineQueue';

export function useOfflineQueue() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const unsubscribe = offlineQueue.subscribe(rerender);
    offlineQueue.load().catch(() => { /* shown as not loaded; retried on the next change */ });
    return unsubscribe;
  }, []);

  const view = offlineQueue.view(userId);

  const flush = useCallback(() => offlineQueue.flush({ manual: true }), []);

  const retry = useCallback(async (id: string) => {
    await offlineQueue.retry(id);
    await offlineQueue.flush({ manual: true });
  }, []);

  const dismiss = useCallback((id: string) => offlineQueue.dismiss(id), []);

  return {
    loaded:         view.loaded,
    pendingCount:   view.pending.length,
    pending:        view.pending,
    failed:         view.failed,
    recentlySynced: view.recentlySynced,
    lastSyncedAt:   view.lastSyncedAt,
    otherAccounts:  view.otherAccounts,
    previousVersion: view.previousVersion,
    unreadable:     view.unreadable,
    lastReport:     offlineQueue.lastReport,
    isFlushing:     offlineQueue.isFlushing(),
    flush,
    retry,
    dismiss,
  };
}
