/**
 * useOfflineQueue
 * Exposes pending operation count and a flush function.
 * Automatically flushes when the app comes back to the foreground.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  getQueue, dequeue, incrementRetry, clearQueue as clearAllQueue,
  OfflineOp,
} from '../utils/offlineQueue';
import { attendanceApi } from '../api/attendance';
import { labourApi } from '../api/labour';

const MAX_RETRIES = 5;

// ─── Execute a single queued operation ───────────────────────────────────────

async function executeOp(op: OfflineOp): Promise<void> {
  const p = op.payload;

  switch (op.type) {
    case 'attendance_self':
      await attendanceApi.selfAttendance(
        p['projectId'] as string,
        p['siteId'] as string,
        p['checkInTime'] ? { checkInTime: p['checkInTime'] as string } : undefined,
      );
      break;

    case 'attendance_create':
      await attendanceApi.create(
        p['projectId'] as string,
        p['siteId'] as string,
        p['data'] as Parameters<typeof attendanceApi.create>[2],
      );
      break;

    case 'labour_create':
      await labourApi.create(p['data'] as Parameters<typeof labourApi.create>[0]);
      break;

    default:
      throw new Error(`Unknown op type: ${op.type}`);
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [isFlushing,   setIsFlushing]   = useState(false);
  const flushRef = useRef(false);

  async function refresh() {
    const q = await getQueue();
    setPendingCount(q.length);
  }

  const flush = useCallback(async () => {
    if (flushRef.current) return; // already flushing
    flushRef.current = true;
    setIsFlushing(true);

    try {
      const queue = await getQueue();
      for (const op of queue) {
        if (op.retryCount >= MAX_RETRIES) {
          // Give up on this operation after too many failures
          await dequeue(op.id);
          continue;
        }
        try {
          await executeOp(op);
          await dequeue(op.id);
        } catch {
          await incrementRetry(op.id);
          // keep in queue, try again next time
        }
      }
    } finally {
      flushRef.current = false;
      setIsFlushing(false);
      await refresh();
    }
  }, []);

  async function clearQueue() {
    await clearAllQueue();
    setPendingCount(0);
  }

  // Flush on app foreground
  useEffect(() => {
    void refresh();

    function handleAppState(nextState: AppStateStatus) {
      if (nextState === 'active') {
        void flush();
      }
    }

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [flush]);

  return { pendingCount, isFlushing, flush, refresh, clearQueue };
}
