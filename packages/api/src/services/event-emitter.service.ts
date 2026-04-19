/**
 * In-process SSE client registry.
 *
 * Each connected browser tab registers a writer function here.
 * When a mutation happens, the service calls emitToCompany() or emitToUser()
 * to push a JSON event to all matching connected clients.
 *
 * This is intentionally simple — no Redis, no clustering.
 * Suitable for a single-server deployment; can be swapped for a proper
 * pub/sub adapter later without changing the call sites.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SSEEvent {
  /** Matches the browser's EventSource `event:` type field */
  type: string;
  /** Arbitrary JSON payload */
  payload?: Record<string, unknown>;
}

interface Client {
  id:        string;
  userId:    string;
  companyId: string;
  write:     (data: string) => void;
}

// ─── Registry ──────────────────────────────────────────────────────────────────

/** companyId → Set of connected clients */
const registry = new Map<string, Set<Client>>();

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
 * Broadcast an event to every connected client in the given company.
 */
export function emitToCompany(companyId: string, event: SSEEvent): void {
  const clients = registry.get(companyId);
  if (!clients || clients.size === 0) return;

  const line = formatSSE(event.type, event.payload ?? {});
  for (const client of clients) {
    try { client.write(line); } catch { /* client already disconnected */ }
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
