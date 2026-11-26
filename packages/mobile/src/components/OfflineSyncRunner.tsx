/**
 * Sends the signed-in user's offline entries automatically:
 * - once the session is restored at app start, and whenever a user signs in;
 * - when the app returns to the foreground;
 * - every RETRY_INTERVAL_MS while the app is open and something is due
 *   (the app has no connectivity listener, so this is how a returning signal
 *   is noticed; an offline attempt fails fast and costs nothing).
 * Renders nothing. Mounted once, inside the auth guard.
 */
import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAuthStore } from '../store/auth.store';
import { offlineQueue, RETRY_INTERVAL_MS } from '../utils/offlineQueue';

export function OfflineSyncRunner() {
  const userId    = useAuthStore((s) => s.user?.id ?? null);
  const isLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    if (isLoading || !userId) return;
    let cancelled = false;

    void offlineQueue.load()
      .catch(() => undefined)
      .then(() => { if (!cancelled) void offlineQueue.flush(); });

    function onAppState(next: AppStateStatus) {
      if (next === 'active') void offlineQueue.flush();
    }
    const sub = AppState.addEventListener('change', onAppState);

    const timer = setInterval(() => {
      if (AppState.currentState === 'active' && offlineQueue.hasDuePending(userId)) {
        void offlineQueue.flush();
      }
    }, RETRY_INTERVAL_MS);

    return () => {
      cancelled = true;
      sub.remove();
      clearInterval(timer);
    };
  }, [userId, isLoading]);

  return null;
}
