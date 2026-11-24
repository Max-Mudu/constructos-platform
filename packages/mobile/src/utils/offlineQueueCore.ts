/**
 * Offline queue — the part that decides what happens to an entry saved while
 * the phone could not reach the server. Plain TypeScript with no React Native
 * import: storage, network, clock and the signed-in user are passed in, so the
 * rules below are unit-tested in Node (tests/offlineQueue.test.ts).
 * src/utils/offlineQueue.ts binds it to the device file system and the API.
 *
 * Rules
 * - An entry is never removed automatically, except a synced one after
 *   SYNCED_RETENTION_MS. Only the person who saved it removes it otherwise:
 *   Dismiss on a failed entry, or "delete" in the log-out dialog.
 * - States: pending (waiting; also while offline or signed out), sending
 *   (request in flight; still treated as pending after a restart), failed
 *   (needs the user: reason shown, Retry or Dismiss), synced.
 * - No connection never counts as a failure. Only a server-side failure
 *   (5xx, 408, 429, or a timeout while the server is reachable) counts; after
 *   MAX_TRANSIENT_FAILURES of them the entry becomes failed, not deleted.
 * - 4xx (validation, permission, not found) → failed with the server's message.
 * - 401 → stays pending; it is sent again once the same user is signed in.
 * - 409 (an entry for that worker and day already exists) → the server's
 *   record is read back and compared with the queued one: recorded by the same
 *   user with the same details means this entry already reached the server
 *   (synced); anything else is failed as a conflict, never overwritten.
 * - Entries belong to the user who saved them and are only ever sent while
 *   that user is signed in.
 * - The "sending" mark is saved before each request. If the app is killed
 *   mid-send the entry is sent again on the next run; the server's one record
 *   per worker and day plus the 409 comparison mean that resend neither
 *   duplicates nor loses it.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type OfflineOpType = 'attendance_self' | 'attendance_create' | 'labour_create';

const OP_TYPES: readonly OfflineOpType[] = ['attendance_self', 'attendance_create', 'labour_create'];

export type EntryState = 'pending' | 'sending' | 'failed' | 'synced';

const STATES: readonly EntryState[] = ['pending', 'sending', 'failed', 'synced'];

export type FailureKind =
  /** The server refused it (4xx): the message says why. */
  | 'rejected'
  /** A different entry for that worker and day is already on the server. */
  | 'conflict'
  /** The server failed MAX_TRANSIENT_FAILURES times. */
  | 'retry_limit'
  /** A worker's own check-in saved on an earlier day (the server records "today"). */
  | 'stale_day'
  /** Saved by an app version that did not record who saved it. */
  | 'unknown_owner';

export interface EntryFailure {
  kind:    FailureKind;
  message: string;
  status?: number;
  at:      string;
}

export interface QueueEntry {
  id:        string;
  type:      OfflineOpType;
  payload:   Record<string, unknown>;
  /** Who saved it; null only for entries from an app version that did not record it. */
  userId:    string | null;
  /** Short description for the screen, e.g. "Jane Doe · 2026-11-24 · 8h". */
  label?:    string;
  createdAt: string;
  state:     EntryState;
  /** Requests started for this entry. */
  attempts:  number;
  /** Server-side failures counted toward MAX_TRANSIENT_FAILURES. */
  transientFailures: number;
  /** Why it is still waiting (no connection, server error, signed out). */
  lastError?:     string;
  lastAttemptAt?: string;
  /** Automatic retries wait until then after a server-side failure; a manual sync does not. */
  nextAttemptAt?: string;
  failure?:       EntryFailure;
  syncedAt?:      string;
  /** Synced because the server already held this user's identical record. */
  alreadyOnServer?: boolean;
  serverId?:      string;
  /** Set on entries converted from the version-1 file. */
  migratedFrom?:  1;
}

export interface QueueLogEvent {
  at:       string;
  event:    string;
  entryId?: string;
  type?:    string;
  userId?:  string | null;
  detail?:  string;
}

export interface QueueFile {
  version: 2;
  entries: QueueEntry[];
  /** Recent queue events (sync, failure, dismiss, delete), newest last. */
  log:     QueueLogEvent[];
  /** Items from the file that could not be understood; kept, never sent. */
  invalid: unknown[];
}

/** Where the queue file lives. write() must replace the contents atomically. */
export interface QueueStorage {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
  /** Keeps a copy of a file that could not be read, before the queue starts afresh. */
  preserveUnreadable(contents: string): Promise<void>;
}

/** The server's record for the worker and day of a queued entry (see findExisting). */
export interface ServerRecord {
  id:           string;
  recordedById: string | null;
  fields:       Record<string, unknown>;
}

export interface QueueTransport {
  /** Sends the entry; resolves on success, throws the HTTP client's error otherwise. */
  send(entry: QueueEntry): Promise<{ serverId?: string }>;
  /** The server's record for the entry's worker, site and day, or null. Throws like send. */
  findExisting(entry: QueueEntry): Promise<ServerRecord | null>;
  /** True when the server answers at all (any HTTP status); false when unreachable. */
  isServerReachable(): Promise<boolean>;
}

export interface QueueDeps {
  storage:       QueueStorage;
  transport:     QueueTransport;
  now:           () => number;
  currentUserId: () => string | null;
  newId?:        () => string;
  /** Device log for failures and deliberate removals (no payload contents). */
  warn?:         (message: string) => void;
}

export type EnqueueResult =
  | { status: 'queued';         entry: QueueEntry }
  /** The same entry is already waiting; nothing new was saved. */
  | { status: 'already_queued'; entry: QueueEntry }
  /** A different entry for the same worker and day is waiting; nothing new was saved. */
  | { status: 'blocked';        entry: QueueEntry; message: string };

export type FlushStop = 'offline' | 'signed_out' | 'rate_limited' | 'timeout' | 'user_changed' | 'storage';

export interface FlushReport {
  ran:             boolean;
  synced:          number;
  alreadyOnServer: number;
  failed:          number;
  /** Pending entries of the user left after this run. */
  stillPending:    number;
  stoppedBy?:      FlushStop;
  at:              string;
}

export interface QueueView {
  loaded:         boolean;
  /** pending + sending, oldest first */
  pending:        QueueEntry[];
  failed:         QueueEntry[];
  recentlySynced: QueueEntry[];
  lastSyncedAt:   string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_TRANSIENT_FAILURES = 5;
export const SYNCED_RETENTION_MS    = 24 * 60 * 60 * 1000;
export const RECENTLY_SYNCED_MS     = 30 * 60 * 1000;
export const MAX_LOG_EVENTS         = 200;

/** Wait before the next automatic try after the n-th server-side failure. */
export function backoffMs(failures: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, failures - 1), 15 * 60_000);
}

// ─── Error classification ─────────────────────────────────────────────────────

export type ErrorClass =
  | { kind: 'offline';   reason: string }
  | { kind: 'timeout' }
  | { kind: 'auth' }
  | { kind: 'conflict';  message: string }
  | { kind: 'transient'; status?: number; message: string }
  | { kind: 'rejected';  status: number; message: string };

const NETWORK_CODES = new Set(['ERR_NETWORK', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/** The server's explanation, with field errors when it sent them. */
export function serverMessage(data: unknown, status: number): string {
  const d = asRecord(data);
  const error = typeof d?.['error'] === 'string' ? (d['error'] as string) : '';
  const details = asRecord(d?.['details']);
  const fieldText = details
    ? Object.entries(details)
        .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : String(msgs)}`)
        .join('; ')
    : '';
  const text = [error, fieldText].filter(Boolean).join(' — ');
  return text || `The server refused this entry (HTTP ${status})`;
}

/**
 * Sorts an HTTP client (axios-shaped) error into what the queue does with it.
 * No response: a timeout, or no connection. A response: by status.
 */
export function classifyError(err: unknown): ErrorClass {
  const e = asRecord(err);
  const response = asRecord(e?.['response']);
  const status = typeof response?.['status'] === 'number' ? (response['status'] as number) : undefined;

  if (status !== undefined) {
    if (status === 401) return { kind: 'auth' };
    if (status === 409) return { kind: 'conflict', message: serverMessage(response?.['data'], status) };
    if (status === 408) return { kind: 'transient', status, message: 'The server timed out (HTTP 408)' };
    if (status === 429) return { kind: 'transient', status, message: 'The server is busy (HTTP 429)' };
    if (status >= 500)  return { kind: 'transient', status, message: `Server error (HTTP ${status})` };
    if (status >= 400)  return { kind: 'rejected', status, message: serverMessage(response?.['data'], status) };
    return { kind: 'transient', status, message: `Unexpected answer (HTTP ${status})` };
  }

  const code = typeof e?.['code'] === 'string' ? (e['code'] as string) : '';
  const message = typeof e?.['message'] === 'string' ? (e['message'] as string) : '';
  if (TIMEOUT_CODES.has(code) || /timeout|timed out/i.test(message)) return { kind: 'timeout' };
  if (NETWORK_CODES.has(code) || e?.['isAxiosError'] === true || /network/i.test(message)) {
    return { kind: 'offline', reason: 'No connection to the server' };
  }
  // Not a network error at all (e.g. a build without a server address):
  // counted like a server failure so it ends up visible as failed.
  return { kind: 'transient', message: message || 'Unexpected error' };
}

/**
 * For a screen whose save just failed: true when the entry should be kept on
 * the phone and sent later (no connection, timeout, server-side failure or the
 * session ending), false when the user has to fix it (4xx, 409).
 */
export function shouldQueueAfterError(err: unknown): boolean {
  const k = classifyError(err).kind;
  return k === 'offline' || k === 'timeout' || k === 'transient' || k === 'auth';
}

// ─── Payload helpers ──────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

/** Calendar day (YYYY-MM-DD) in the phone's time zone. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dataOf(entry: { type: OfflineOpType; payload: Record<string, unknown> }): Record<string, unknown> {
  return asRecord(entry.payload['data']) ?? {};
}

/** Site, worker and day: the server keeps one labour entry / attendance record per key. */
export function naturalKey(entry: { type: OfflineOpType; payload: Record<string, unknown>; createdAt: string }): string {
  const d = dataOf(entry);
  switch (entry.type) {
    case 'labour_create':
      return `labour|${str(d['siteId'])}|${str(d['workerId'])}|${str(d['date'])}`;
    case 'attendance_create':
      return `attendance|${str(entry.payload['siteId'])}|${str(d['workerId'])}|${str(d['date'])}`;
    case 'attendance_self':
      return `self|${str(entry.payload['siteId'])}|${localDay(Date.parse(entry.createdAt))}`;
  }
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const r = asRecord(v);
  if (r) {
    return `{${Object.keys(r).filter((k) => r[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(r[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function samePayload(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** null, undefined and '' are all "no value". */
function sameText(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  return n(a) === n(b);
}

function sameNumber(a: unknown, b: unknown): boolean {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 0.005;
}

function sameDay(serverDate: unknown, day: unknown): boolean {
  return str(serverDate).slice(0, 10) === str(day);
}

/**
 * True when the server's record is this entry already saved: recorded by the
 * same user, for the same worker and day, with the same details. Anything else
 * (another person's record, or the same person's with different hours, status,
 * times or notes) is a different entry, so the queued one is NOT treated as
 * saved.
 */
export function matchesQueuedEntry(entry: QueueEntry, record: ServerRecord): boolean {
  if (!entry.userId || record.recordedById !== entry.userId) return false;
  const d = dataOf(entry);
  const f = record.fields;
  switch (entry.type) {
    case 'labour_create':
      return str(f['workerId']) === str(d['workerId'])
        && sameDay(f['date'], d['date'])
        && sameNumber(f['hoursWorked'], d['hoursWorked'])
        && sameText(f['notes'], d['notes'])
        // A rate is compared only when it was sent and the server showed it.
        && (d['dailyRate'] === undefined || f['dailyRate'] === undefined || f['dailyRate'] === null
            || sameNumber(f['dailyRate'], d['dailyRate']));
    case 'attendance_create':
      return str(f['workerId']) === str(d['workerId'])
        && sameDay(f['date'], d['date'])
        && str(f['status']) === str(d['status'])
        && sameText(f['checkInTime'], d['checkInTime'])
        && sameText(f['checkOutTime'], d['checkOutTime'])
        && sameText(f['notes'], d['notes']);
    case 'attendance_self':
      return false;
  }
}

/** Short description when the screen gave none. */
export function describeEntry(entry: QueueEntry): string {
  if (entry.label) return entry.label;
  const d = dataOf(entry);
  switch (entry.type) {
    case 'labour_create':     return `Labour entry · ${str(d['date'])} · ${str(d['hoursWorked'])}h`;
    case 'attendance_create': return `Attendance · ${str(d['date'])} · ${str(d['status'])}`;
    case 'attendance_self':   return `Check-in · ${entry.createdAt.slice(0, 10)}`;
  }
}

// ─── File format ──────────────────────────────────────────────────────────────

function emptyFile(): QueueFile {
  return { version: 2, entries: [], log: [], invalid: [] };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function toEntry(raw: unknown): QueueEntry | null {
  const r = asRecord(raw);
  if (!r) return null;
  const type = r['type'] as OfflineOpType;
  const payload = asRecord(r['payload']);
  const state = r['state'] as EntryState;
  if (typeof r['id'] !== 'string' || !OP_TYPES.includes(type) || !payload || !STATES.includes(state)) return null;
  const failure = asRecord(r['failure']);
  return {
    id:                r['id'] as string,
    type,
    payload,
    userId:            typeof r['userId'] === 'string' ? (r['userId'] as string) : null,
    label:             optStr(r['label']),
    createdAt:         optStr(r['createdAt']) ?? new Date(0).toISOString(),
    state,
    attempts:          num(r['attempts']),
    transientFailures: num(r['transientFailures']),
    lastError:         optStr(r['lastError']),
    lastAttemptAt:     optStr(r['lastAttemptAt']),
    nextAttemptAt:     optStr(r['nextAttemptAt']),
    failure:           failure ? {
      kind:    failure['kind'] as FailureKind,
      message: str(failure['message']),
      status:  typeof failure['status'] === 'number' ? (failure['status'] as number) : undefined,
      at:      str(failure['at']),
    } : undefined,
    syncedAt:          optStr(r['syncedAt']),
    alreadyOnServer:   r['alreadyOnServer'] === true ? true : undefined,
    serverId:          optStr(r['serverId']),
    migratedFrom:      r['migratedFrom'] === 1 ? 1 : undefined,
  };
}

/**
 * Version 1 (app builds up to this change) stored a bare array of
 * { id, type, payload, createdAt, retryCount, userId? }. Every op becomes a
 * pending entry with no counted failures (version 1 also counted offline
 * attempts). An op with no userId cannot be bound to anyone, so it is never
 * sent automatically: it is shown as failed ("unknown_owner") until someone
 * deliberately sends or dismisses it.
 */
export function migrateV1(ops: unknown[], nowIso: string): { file: QueueFile; migrated: number } {
  const file = emptyFile();
  for (const raw of ops) {
    const r = asRecord(raw);
    const type = r?.['type'] as OfflineOpType;
    const payload = asRecord(r?.['payload']);
    if (!r || typeof r['id'] !== 'string' || !OP_TYPES.includes(type) || !payload) {
      file.invalid.push(raw);
      continue;
    }
    const userId = typeof r['userId'] === 'string' && r['userId'] ? (r['userId'] as string) : null;
    file.entries.push({
      id:                r['id'] as string,
      type,
      payload,
      userId,
      createdAt:         optStr(r['createdAt']) ?? nowIso,
      state:             userId ? 'pending' : 'failed',
      attempts:          num(r['retryCount']),
      transientFailures: 0,
      failure:           userId ? undefined : {
        kind: 'unknown_owner',
        message: 'Saved by an older version of the app, which did not record who saved it. Send it only if it is yours.',
        at: nowIso,
      },
      migratedFrom: 1,
    });
  }
  file.log.push({
    at: nowIso, event: 'migrated_v1',
    detail: `${file.entries.length} entries, ${file.invalid.length} unreadable kept`,
  });
  return { file, migrated: file.entries.length };
}

type Parsed =
  | { ok: true; file: QueueFile; needsWrite: boolean }
  | { ok: false };

export function parseQueueFile(raw: string | null, nowIso: string): Parsed {
  if (raw === null || raw.trim() === '') return { ok: true, file: emptyFile(), needsWrite: false };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (Array.isArray(data)) {
    return { ok: true, file: migrateV1(data, nowIso).file, needsWrite: true };
  }
  const r = asRecord(data);
  if (r && r['version'] === 2 && Array.isArray(r['entries'])) {
    const file = emptyFile();
    for (const e of r['entries'] as unknown[]) {
      const entry = toEntry(e);
      if (entry) file.entries.push(entry);
      else file.invalid.push(e);
    }
    file.log = Array.isArray(r['log']) ? (r['log'] as QueueLogEvent[]) : [];
    if (Array.isArray(r['invalid'])) file.invalid.push(...(r['invalid'] as unknown[]));
    return { ok: true, file, needsWrite: false };
  }
  return { ok: false };
}

// ─── File storage with atomic replace ─────────────────────────────────────────

export interface FileOps {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  /** Renames from → to, replacing to. */
  move(from: string, to: string): Promise<void>;
}

/**
 * Writes go to "<path>.tmp" first and are then renamed over <path>, so a kill
 * at any moment leaves either the old or the new complete file. On Android the
 * rename replaces the file in one step. On iOS the old file is deleted before
 * the rename; a kill in between leaves only the temp file, which read() then
 * uses (it was completely written before the delete started).
 */
export function createFileStorage(ops: FileOps, path: string, now: () => number): QueueStorage {
  const tmp = `${path}.tmp`;
  return {
    async read() {
      if (await ops.exists(path)) return ops.read(path);
      if (await ops.exists(tmp)) return ops.read(tmp);
      return null;
    },
    async write(contents) {
      await ops.write(tmp, contents);
      await ops.move(tmp, path);
    },
    async preserveUnreadable(contents) {
      await ops.write(`${path}.unreadable-${now()}`, contents);
    },
  };
}

// ─── Queue ────────────────────────────────────────────────────────────────────

type Outcome =
  | { kind: 'synced'; serverId?: string; already: boolean }
  | { kind: 'offline'; reason: string }
  | { kind: 'signed_out' }
  | { kind: 'transient'; message: string; status?: number; stop?: FlushStop }
  | { kind: 'failed'; failure: Omit<EntryFailure, 'at'> };

/** Is this entry already on the server? 'unknown' when the check itself failed. */
type ExistingCheck = { kind: 'own'; serverId: string } | { kind: 'other'; record: ServerRecord } | { kind: 'none' } | { kind: 'unknown'; err: unknown };

const CONFLICT_OTHER_USER =
  'Not saved: someone else already recorded an entry for this worker on this date. Check the list, then dismiss this one.';
const CONFLICT_DIFFERENT =
  'Not saved: an entry for this worker on this date already exists with different details. Check the list, then dismiss this one.';

export class OfflineQueue {
  private file: QueueFile | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private flushing: Promise<FlushReport> | null = null;
  private queuedFlush: Promise<FlushReport> | null = null;
  private queuedManual = false;
  private listeners = new Set<() => void>();
  lastReport: FlushReport | null = null;
  private readonly deps: QueueDeps;

  constructor(deps: QueueDeps) {
    this.deps = deps;
  }

  // ── Observation ──────────────────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* a screen's listener must not break the queue */ }
    }
  }

  isFlushing(): boolean {
    return this.flushing !== null;
  }

  /** What one user sees. Entries of unknown owner (old app version) are shown to whoever is signed in, as failed. */
  view(userId: string | null): QueueView {
    const now = this.deps.now();
    const entries = this.file?.entries ?? [];
    const own = entries.filter((e) => userId !== null && e.userId === userId);
    const synced = own.filter((e) => e.state === 'synced');
    const lastSyncedAt = synced.reduce<string | null>((max, e) => (e.syncedAt && (!max || e.syncedAt > max) ? e.syncedAt : max), null);
    return {
      loaded:  this.file !== null,
      pending: own.filter((e) => e.state === 'pending' || e.state === 'sending').sort(byCreated),
      failed:  entries.filter((e) => e.state === 'failed' && userId !== null && (e.userId === userId || e.userId === null)).sort(byCreated),
      recentlySynced: synced.filter((e) => e.syncedAt && now - Date.parse(e.syncedAt) <= RECENTLY_SYNCED_MS),
      lastSyncedAt,
    };
  }

  /** True when the user has a pending entry an automatic sync may send now. */
  hasDuePending(userId: string | null): boolean {
    const now = this.deps.now();
    return (this.file?.entries ?? []).some((e) => e.userId !== null && e.userId === userId
      && (e.state === 'pending' || e.state === 'sending')
      && (!e.nextAttemptAt || Date.parse(e.nextAttemptAt) <= now));
  }

  // ── Loading and saving ───────────────────────────────────────────────────

  /** Reads (and if needed migrates) the queue file. Safe to call repeatedly. */
  async load(): Promise<void> {
    await this.serial(async () => { await this.ensureLoaded(); });
  }

  private async ensureLoaded(): Promise<QueueFile> {
    if (this.file) return this.file;
    const nowIso = new Date(this.deps.now()).toISOString();
    let raw: string | null;
    try {
      raw = await this.deps.storage.read();
    } catch (err) {
      // Could not read: do not start empty, which would overwrite the file.
      throw err;
    }
    const parsed = parseQueueFile(raw, nowIso);
    let file: QueueFile;
    let needsWrite: boolean;
    if (parsed.ok) {
      file = parsed.file;
      needsWrite = parsed.needsWrite;
    } else {
      // Unreadable: keep a copy first (throws → nothing is overwritten).
      await this.deps.storage.preserveUnreadable(raw ?? '');
      file = emptyFile();
      file.log.push({ at: nowIso, event: 'unreadable_file_preserved' });
      this.warn('queue file could not be read; a copy was kept and a new queue started');
      needsWrite = true;
    }
    if (needsWrite) {
      // The old (or preserved) file stays on disk until this succeeds; any
      // later change writes the new format again.
      try { await this.deps.storage.write(JSON.stringify(file)); } catch { /* retried on the next change */ }
    }
    this.file = file;
    this.emit();
    return file;
  }

  /** Runs fn on the loaded file and saves it; on a failed save the in-memory state is put back. */
  private mutate<T>(fn: (file: QueueFile) => T): Promise<T> {
    return this.serial(async () => {
      const file = await this.ensureLoaded();
      const before = JSON.stringify(file);
      const result = fn(file);
      try {
        await this.deps.storage.write(JSON.stringify(file));
      } catch (err) {
        this.file = JSON.parse(before) as QueueFile;
        throw err;
      }
      this.emit();
      return result;
    });
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private find(file: QueueFile, id: string): QueueEntry | undefined {
    return file.entries.find((e) => e.id === id);
  }

  private record(file: QueueFile, event: string, entry?: QueueEntry, detail?: string): void {
    file.log.push({
      at: new Date(this.deps.now()).toISOString(),
      event,
      ...(entry && { entryId: entry.id, type: entry.type, userId: entry.userId }),
      ...(detail && { detail }),
    });
    if (file.log.length > MAX_LOG_EVENTS) file.log.splice(0, file.log.length - MAX_LOG_EVENTS);
  }

  private warn(message: string): void {
    this.deps.warn?.(`[offline-queue] ${message}`);
  }

  private nowIso(): string {
    return new Date(this.deps.now()).toISOString();
  }

  // ── Adding ───────────────────────────────────────────────────────────────

  /**
   * Saves an entry on the phone. Resolves only after it is on disk; throws
   * when it could not be saved (the screen must then say it was NOT saved).
   * userId: the user who pressed save, captured before the request (the
   * session may have ended while it ran).
   */
  async enqueue(
    type: OfflineOpType,
    payload: Record<string, unknown>,
    opts: { userId?: string | null; label?: string } = {},
  ): Promise<EnqueueResult> {
    const userId = opts.userId ?? this.deps.currentUserId();
    if (!userId) throw new Error('Cannot keep an entry offline without a signed-in user');
    const createdAt = this.nowIso();
    const candidate = { type, payload, createdAt };
    const key = naturalKey(candidate);

    return this.mutate((file) => {
      const waiting = file.entries.find((e) => e.userId === userId && e.type === type
        && (e.state === 'pending' || e.state === 'sending') && naturalKey(e) === key);
      if (waiting) {
        if (samePayload(waiting.payload, payload)) return { status: 'already_queued', entry: waiting } as EnqueueResult;
        return {
          status: 'blocked',
          entry: waiting,
          message: 'An entry for this worker on this date is already waiting to be sent. Sync it first; to change it, dismiss it once it has failed or edit it after it is sent.',
        } as EnqueueResult;
      }
      const entry: QueueEntry = {
        id: this.deps.newId?.() ?? `${this.deps.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        type,
        payload,
        userId,
        label: opts.label,
        createdAt,
        state: 'pending',
        attempts: 0,
        transientFailures: 0,
      };
      file.entries.push(entry);
      this.record(file, 'queued', entry);
      return { status: 'queued', entry } as EnqueueResult;
    });
  }

  // ── Sending ──────────────────────────────────────────────────────────────

  /**
   * Sends the signed-in user's pending entries, oldest first. Automatic runs
   * skip entries still in back-off; manual runs (a tap) send everything. A
   * call during a run is answered by one more run right after it.
   */
  flush(opts: { manual?: boolean } = {}): Promise<FlushReport> {
    if (!this.flushing) return this.startFlush(!!opts.manual);
    if (opts.manual) this.queuedManual = true;
    if (!this.queuedFlush) {
      const next = () => {
        const manual = this.queuedManual;
        this.queuedFlush = null;
        this.queuedManual = false;
        return this.flushing ?? this.startFlush(manual);
      };
      this.queuedFlush = this.flushing.then(next, next);
    }
    return this.queuedFlush;
  }

  private startFlush(manual: boolean): Promise<FlushReport> {
    const run = this.runFlush(manual)
      .catch((): FlushReport => ({
        ran: false, synced: 0, alreadyOnServer: 0, failed: 0, stillPending: 0, stoppedBy: 'storage', at: this.nowIso(),
      }))
      .then((report) => { this.lastReport = report; return report; })
      .finally(() => { this.flushing = null; this.emit(); });
    this.flushing = run;
    this.emit();
    return run;
  }

  private async runFlush(manual: boolean): Promise<FlushReport> {
    const report: FlushReport = { ran: true, synced: 0, alreadyOnServer: 0, failed: 0, stillPending: 0, at: this.nowIso() };
    const userId = this.deps.currentUserId();
    if (!userId) return { ...report, ran: false, stoppedBy: 'signed_out' };

    let file: QueueFile;
    try {
      file = await this.serial(() => this.ensureLoaded());
    } catch {
      return { ...report, ran: false, stoppedBy: 'storage' };
    }
    const now = this.deps.now();
    const ids = file.entries
      .filter((e) => e.userId === userId && (e.state === 'pending' || e.state === 'sending')
        && (manual || !e.nextAttemptAt || Date.parse(e.nextAttemptAt) <= now))
      .sort(byCreated)
      .map((e) => e.id);

    for (const id of ids) {
      if (this.deps.currentUserId() !== userId) { report.stoppedBy = 'user_changed'; break; }
      const stop = await this.sendOne(id, userId, report);
      if (stop) { report.stoppedBy = stop; break; }
    }

    try {
      await this.mutate((f) => this.prune(f));
    } catch { /* pruning can wait */ }
    report.stillPending = (this.file?.entries ?? [])
      .filter((e) => e.userId === userId && (e.state === 'pending' || e.state === 'sending')).length;
    return report;
  }

  private async sendOne(id: string, userId: string, report: FlushReport): Promise<FlushStop | undefined> {
    let entry: QueueEntry | undefined;
    try {
      entry = await this.mutate((file) => {
        const e = this.find(file, id);
        if (!e || e.userId !== userId || (e.state !== 'pending' && e.state !== 'sending')) return undefined;
        if (e.type === 'attendance_self' && localDay(Date.parse(e.createdAt)) !== localDay(this.deps.now())) {
          // The server records a check-in for the day it arrives, so sending
          // it later would record the wrong day.
          this.markFailed(file, e, {
            kind: 'stale_day',
            message: `Saved on ${localDay(Date.parse(e.createdAt))}; a check-in can only be sent on the day it was made. Ask your supervisor to record it.`,
          });
          report.failed++;
          return undefined;
        }
        // Saved before the request leaves, so a kill during the request is recoverable.
        e.state = 'sending';
        e.attempts += 1;
        e.lastAttemptAt = this.nowIso();
        return { ...e, payload: e.payload };
      });
    } catch {
      return 'storage';
    }
    if (!entry) return undefined;

    let outcome: Outcome;
    try {
      const res = await this.deps.transport.send(entry);
      outcome = { kind: 'synced', serverId: res?.serverId, already: false };
    } catch (err) {
      outcome = await this.resolveFailure(entry, err);
    }

    try {
      await this.mutate((file) => this.apply(file, id, outcome, report));
    } catch {
      return 'storage';
    }
    switch (outcome.kind) {
      case 'offline':    return 'offline';
      case 'signed_out': return 'signed_out';
      case 'transient':  return outcome.stop;
      default:           return undefined;
    }
  }

  private async checkExisting(entry: QueueEntry): Promise<ExistingCheck> {
    try {
      const record = await this.deps.transport.findExisting(entry);
      if (!record) return { kind: 'none' };
      return matchesQueuedEntry(entry, record) ? { kind: 'own', serverId: record.id } : { kind: 'other', record };
    } catch (err) {
      return { kind: 'unknown', err };
    }
  }

  private conflictFailure(entry: QueueEntry, record: ServerRecord): Outcome {
    return {
      kind: 'failed',
      failure: {
        kind: 'conflict',
        status: 409,
        message: record.recordedById !== entry.userId ? CONFLICT_OTHER_USER : CONFLICT_DIFFERENT,
      },
    };
  }

  private async resolveFailure(entry: QueueEntry, err: unknown): Promise<Outcome> {
    const c = classifyError(err);
    switch (c.kind) {
      case 'offline':
        return { kind: 'offline', reason: c.reason };
      case 'auth':
        return { kind: 'signed_out' };
      case 'rejected':
        return { kind: 'failed', failure: { kind: 'rejected', status: c.status, message: c.message } };
      case 'conflict': {
        if (entry.type === 'attendance_self') {
          // One check-in per worker and day; a 409 means a simultaneous
          // check-in by the same worker already recorded today.
          return { kind: 'synced', already: true };
        }
        const check = await this.checkExisting(entry);
        if (check.kind === 'own') return { kind: 'synced', serverId: check.serverId, already: true };
        if (check.kind === 'other') return this.conflictFailure(entry, check.record);
        if (check.kind === 'none') {
          return { kind: 'failed', failure: { kind: 'conflict', status: 409, message: c.message } };
        }
        // Could not read the existing record: decide on a later run.
        const again = classifyError(check.err);
        if (again.kind === 'offline' || again.kind === 'timeout') return { kind: 'offline', reason: 'No connection to the server' };
        if (again.kind === 'auth') return { kind: 'signed_out' };
        return { kind: 'transient', message: 'Could not check the entry already on the server' };
      }
      case 'timeout': {
        // Only a timeout while the server is reachable counts as a failure;
        // otherwise the connection is the problem.
        let reachable = false;
        try { reachable = await this.deps.transport.isServerReachable(); } catch { reachable = false; }
        if (!reachable) return { kind: 'offline', reason: 'No connection to the server (request timed out)' };
        const check = await this.checkExisting(entry);
        if (check.kind === 'own') return { kind: 'synced', serverId: check.serverId, already: true };
        return { kind: 'transient', message: 'The server did not answer in time', stop: 'timeout' };
      }
      case 'transient': {
        if (c.status !== undefined && c.status >= 500 && entry.type !== 'attendance_self') {
          // The save may have gone through before the error (or an older
          // server answers 500 for a duplicate): look before counting it.
          const check = await this.checkExisting(entry);
          if (check.kind === 'own') return { kind: 'synced', serverId: check.serverId, already: true };
          if (check.kind === 'other') return this.conflictFailure(entry, check.record);
        }
        return { kind: 'transient', message: c.message, status: c.status, stop: c.status === 429 ? 'rate_limited' : undefined };
      }
    }
  }

  private apply(file: QueueFile, id: string, outcome: Outcome, report: FlushReport): void {
    const e = this.find(file, id);
    if (!e) return;
    const nowIso = this.nowIso();
    switch (outcome.kind) {
      case 'synced':
        e.state = 'synced';
        e.syncedAt = nowIso;
        e.serverId = outcome.serverId ?? e.serverId;
        e.alreadyOnServer = outcome.already || undefined;
        e.lastError = undefined;
        e.nextAttemptAt = undefined;
        e.failure = undefined;
        if (outcome.already) report.alreadyOnServer++;
        else report.synced++;
        this.record(file, outcome.already ? 'already_on_server' : 'synced', e);
        return;
      case 'offline':
        e.state = 'pending';
        e.lastError = outcome.reason;
        return;
      case 'signed_out':
        e.state = 'pending';
        e.lastError = 'Waiting for you to sign in again';
        return;
      case 'transient':
        e.transientFailures += 1;
        e.lastError = outcome.message;
        if (e.transientFailures >= MAX_TRANSIENT_FAILURES) {
          this.markFailed(file, e, {
            kind: 'retry_limit',
            status: outcome.status,
            message: `The server could not save this entry after ${e.transientFailures} tries (last: ${outcome.message}). Tap Retry to try again.`,
          });
          report.failed++;
        } else {
          e.state = 'pending';
          e.nextAttemptAt = new Date(this.deps.now() + backoffMs(e.transientFailures)).toISOString();
        }
        return;
      case 'failed':
        this.markFailed(file, e, outcome.failure);
        report.failed++;
        return;
    }
  }

  private markFailed(file: QueueFile, e: QueueEntry, failure: Omit<EntryFailure, 'at'>): void {
    e.state = 'failed';
    e.failure = { ...failure, at: this.nowIso() };
    e.nextAttemptAt = undefined;
    this.record(file, 'failed', e, failure.kind);
    this.warn(`entry ${e.id} (${e.type}) needs attention: ${failure.kind}`);
  }

  /** Synced entries are kept a day (the list shows them), then removed. */
  private prune(file: QueueFile): void {
    const now = this.deps.now();
    file.entries = file.entries.filter((e) => !(e.state === 'synced' && e.syncedAt
      && now - Date.parse(e.syncedAt) > SYNCED_RETENTION_MS));
  }

  // ── User actions ─────────────────────────────────────────────────────────

  /**
   * Puts a failed entry back in the queue with a fresh failure count. An
   * entry of unknown owner (older app version) becomes the current user's.
   * The caller then runs flush({ manual: true }).
   */
  async retry(id: string): Promise<void> {
    const userId = this.deps.currentUserId();
    if (!userId) throw new Error('Sign in to retry this entry');
    await this.mutate((file) => {
      const e = this.find(file, id);
      if (!e || e.state !== 'failed' || (e.userId !== userId && e.userId !== null)) return;
      if (e.userId === null) {
        e.userId = userId;
        this.record(file, 'claimed', e);
      }
      e.state = 'pending';
      e.transientFailures = 0;
      e.failure = undefined;
      e.nextAttemptAt = undefined;
      e.lastError = undefined;
      this.record(file, 'retried', e);
    });
  }

  /** The user deliberately drops a failed entry. Logged; the entry is gone. */
  async dismiss(id: string): Promise<boolean> {
    const userId = this.deps.currentUserId();
    if (!userId) throw new Error('Sign in to dismiss this entry');
    return this.mutate((file) => {
      const e = this.find(file, id);
      if (!e || e.state !== 'failed' || (e.userId !== userId && e.userId !== null)) return false;
      file.entries = file.entries.filter((x) => x.id !== id);
      this.record(file, 'dismissed_by_user', e, `${e.failure?.kind ?? 'failed'} by ${userId}`);
      this.warn(`entry ${e.id} (${e.type}) dismissed by the user (${e.failure?.kind ?? 'failed'})`);
      return true;
    });
  }

  /** Pending and failed entries of a user (what log-out asks about). */
  unsyncedCount(userId: string | null): number {
    if (!userId) return 0;
    return (this.file?.entries ?? []).filter((e) => e.userId === userId && e.state !== 'synced').length;
  }

  /**
   * Explicit "delete them" choice when logging out: removes the user's
   * pending, failed and synced entries. Logged. Other users' entries stay.
   */
  async deleteForUser(userId: string): Promise<number> {
    return this.mutate((file) => {
      const mine = file.entries.filter((e) => e.userId === userId);
      const removedUnsynced = mine.filter((e) => e.state !== 'synced');
      for (const e of removedUnsynced) this.record(file, 'deleted_at_logout', e);
      file.entries = file.entries.filter((e) => e.userId !== userId);
      if (removedUnsynced.length) this.warn(`${removedUnsynced.length} unsynced entries deleted by the user at log-out`);
      return removedUnsynced.length;
    });
  }
}

function byCreated(a: QueueEntry, b: QueueEntry): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
