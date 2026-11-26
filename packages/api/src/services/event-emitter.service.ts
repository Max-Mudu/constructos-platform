/**
 * In-process SSE client registry.
 *
 * Each connected browser tab or phone registers a writer function here, with
 * the verified access-token payload it connected with.
 *  - emitToReaders() sends an event about one record only to the connected
 *    users who could read that record through the API right now: an
 *    unexpired token of a current session, the user's role and finance
 *    permission as stored now, then the record's own read rule (role, project
 *    membership, site scope, contractor link, finance scope).
 *  - emitToUser() sends to one user's own connections (their notifications).
 * There is no company-wide broadcast.
 *
 * This is intentionally simple — no Redis, no clustering.
 * Suitable for a single-server deployment; can be swapped for a proper
 * pub/sub adapter later without changing the call sites.
 */
import { JwtPayload, RequestUser } from '../types';
import { currentUserForSession } from '../middleware/authenticate';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SSEEvent {
  /** Matches the browser's EventSource `event:` type field */
  type: string;
  /** JSON payload: record ids only */
  payload?: Record<string, unknown>;
}

export interface Client {
  id:        string;
  userId:    string;
  companyId: string;
  /**
   * The verified access-token payload the stream was opened with. A client
   * without one never receives a record event.
   */
  session?:  JwtPayload;
  write:     (data: string) => void;
}

/**
 * True when `reader` may read the record the event is about, by the same rule
 * as the record's GET route. Any error counts as false.
 */
export type ReaderCheck = (reader: RequestUser) => Promise<boolean>;

// ─── Registry ──────────────────────────────────────────────────────────────────

/** companyId → Set of connected clients */
const registry = new Map<string, Set<Client>>();

/** Deliveries still being checked (see liveUpdatesSettled). */
const pending = new Set<Promise<void>>();

// ─── API ───────────────────────────────────────────────────────────────────────

export function registerClient(client: Client): void {
  let clients = registry.get(client.companyId);
  if (!clients) {
    clients = new Set();
    registry.set(client.companyId, clients);
  }
  clients.add(client);
}

export function unregisterClient(client: Client): void {
  const clients = registry.get(client.companyId);
  if (!clients) return;
  clients.delete(client);
  if (clients.size === 0) registry.delete(client.companyId);
}

/**
 * Per event: at most `concurrency` recipient checks run at once, so one event
 * cannot take the whole database pool; a check that takes longer than
 * `timeoutMs` counts as "not allowed" and is logged. Mutable for tests.
 */
export const liveUpdateLimits = { concurrency: 8, timeoutMs: 10_000 };

const TIMED_OUT = Symbol('timed out');

/** Whether `session` may receive the event: current user row, then canRead. */
async function allowed(companyId: string, session: JwtPayload, canRead: ReaderCheck): Promise<boolean> {
  // The registry groups by company; the token must agree.
  if (session.companyId !== companyId) return false;
  const reader = await currentUserForSession(session);
  return reader !== null && (await canRead(reader));
}

async function decideWithTimeout(companyId: string, session: JwtPayload, canRead: ReaderCheck): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), liveUpdateLimits.timeoutMs);
  });
  try {
    const result = await Promise.race([allowed(companyId, session, canRead).catch(() => false), timeout]);
    if (result === TIMED_OUT) {
      console.warn('[live-updates] a recipient check timed out; the event was not sent to that connection');
      return false;
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function deliverToReaders(
  companyId: string,
  snapshot: Client[],
  line: string,
  canRead: ReaderCheck,
): Promise<void> {
  // One check per token: a user with several tabs is checked once.
  const groups = new Map<string, { session: JwtPayload; clients: Client[] }>();
  for (const client of snapshot) {
    if (!client.session) continue;
    const s = client.session;
    const key = JSON.stringify([s.sub, s.sv ?? 0, s.companyId, s.exp ?? null]);
    const group = groups.get(key);
    if (group) group.clients.push(client); else groups.set(key, { session: s, clients: [client] });
  }

  const queue = [...groups.values()];
  const worker = async (): Promise<void> => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      if (!(await decideWithTimeout(companyId, group.session, canRead))) continue;
      for (const client of group.clients) {
        if (!registry.get(companyId)?.has(client)) continue; // disconnected meanwhile
        try { client.write(line); } catch { /* client already disconnected */ }
      }
    }
  };
  const workers = Math.max(1, Math.min(liveUpdateLimits.concurrency, queue.length));
  await Promise.all(Array.from({ length: workers }, worker));
}

/**
 * Send an event about one record to the connected clients of `companyId`
 * whose user passes `canRead`. Returns at once; the checks run in the
 * background and never throw, so a write's response does not wait for them.
 */
export function emitToReaders(companyId: string, event: SSEEvent, canRead: ReaderCheck): void {
  const clients = registry.get(companyId);
  if (!clients || clients.size === 0) return;

  const line = formatSSE(event.type, event.payload ?? {});
  const task = deliverToReaders(companyId, [...clients], line, canRead).catch(() => undefined);
  pending.add(task);
  void task.finally(() => pending.delete(task));
}

/**
 * Resolves once every emitToReaders() delivery started so far has finished.
 * For tests, which must wait for the background checks.
 */
export async function liveUpdatesSettled(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}

/**
 * Send an event to a single user (identified by userId within the company).
 * Falls back to no-op if the user has no connected clients.
 */
export function emitToUser(companyId: string, userId: string, event: SSEEvent): void {
  const clients = registry.get(companyId);
  if (!clients) return;

  const line = formatSSE(event.type, event.payload ?? {});
  for (const client of clients) {
    if (client.userId === userId) {
      try { client.write(line); } catch { /* ignore */ }
    }
  }
}

/** How many clients are currently registered (for testing) */
export function clientCount(companyId?: string): number {
  if (companyId) return registry.get(companyId)?.size ?? 0;
  let n = 0;
  for (const s of registry.values()) n += s.size;
  return n;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function formatSSE(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}
