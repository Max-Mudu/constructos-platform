/**
 * Offline queue — persists pending write operations to device storage.
 * Uses expo-file-system so no extra packages are needed.
 *
 * Operations are retried automatically when the app comes to the foreground.
 * Only network failures are queued — HTTP 4xx/5xx errors are NOT queued
 * because they represent real validation errors the user must fix.
 */
import * as FileSystem from 'expo-file-system';

const QUEUE_FILE = (FileSystem.documentDirectory ?? '') + 'offline_queue.json';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OfflineOpType =
  | 'attendance_self'
  | 'attendance_create'
  | 'labour_create';

export interface OfflineOp {
  id:         string;
  type:       OfflineOpType;
  payload:    Record<string, unknown>;
  createdAt:  string;
  retryCount: number;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function readQueue(): Promise<OfflineOp[]> {
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(QUEUE_FILE);
    return JSON.parse(raw) as OfflineOp[];
  } catch {
    return [];
  }
}

async function writeQueue(queue: OfflineOp[]): Promise<void> {
  await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(queue));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns current pending operations. */
export async function getQueue(): Promise<OfflineOp[]> {
  return readQueue();
}

/** Adds an operation to the queue. */
export async function enqueue(
  type: OfflineOpType,
  payload: Record<string, unknown>,
): Promise<OfflineOp> {
  const queue = await readQueue();
  const op: OfflineOp = {
    id:         Math.random().toString(36).slice(2),
    type,
    payload,
    createdAt:  new Date().toISOString(),
    retryCount: 0,
  };
  queue.push(op);
  await writeQueue(queue);
  return op;
}

/** Removes a completed operation from the queue. */
export async function dequeue(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((op) => op.id !== id));
}

/** Increments retry count for a failed-but-retryable operation. */
export async function incrementRetry(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(
    queue.map((op) =>
      op.id === id ? { ...op, retryCount: op.retryCount + 1 } : op,
    ),
  );
}

/** Clears the entire queue (e.g. on logout). */
export async function clearQueue(): Promise<void> {
  await writeQueue([]);
}

/**
 * Returns true if the error is a network connectivity failure (no internet),
 * as opposed to a server-side validation or auth error.
 * Only network errors should be queued.
 */
export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  // Axios network error: no response object
  if (e['response'] !== undefined) return false;
  // Axios error codes for no-connectivity
  const code = e['code'] as string | undefined;
  if (code && ['ECONNABORTED', 'ENOTFOUND', 'ECONNREFUSED', 'ERR_NETWORK', 'ETIMEDOUT'].includes(code)) {
    return true;
  }
  // Generic "Network Error" message from axios
  const msg = (e['message'] as string | undefined) ?? '';
  return msg.toLowerCase().includes('network') || msg.toLowerCase().includes('timeout');
}
