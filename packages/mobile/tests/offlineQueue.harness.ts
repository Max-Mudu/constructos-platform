/**
 * A small fake world for the offline queue tests: a server with the API's
 * one-record-per-worker-and-day rule, a network that can be offline or lose
 * answers, a session that can end, a clock and an in-memory file system.
 * Errors are shaped like axios errors, which is what the app's HTTP client
 * throws. No React Native and no network.
 */

export type OpKind = 'labour_create' | 'attendance_create' | 'attendance_self';

export interface HttpError {
  isAxiosError: true;
  message: string;
  code?: string;
  response?: { status: number; data: unknown };
}

export function httpError(status: number, error = `HTTP ${status}`, code?: string): HttpError {
  return { isAxiosError: true, message: `Request failed with status code ${status}`, response: { status, data: { error, code } } };
}
export const networkError = (): HttpError => ({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
export const timeoutError = (): HttpError => ({ isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' });

// ─── Clock ────────────────────────────────────────────────────────────────────

export class Clock {
  t = Date.parse('2026-11-24T07:00:00.000Z');
  now = (): number => this.t;
  advance(ms: number): void { this.t += ms; }
}

// ─── File system ──────────────────────────────────────────────────────────────

export class MemFs {
  files = new Map<string, string>();
  writes = 0;
  /** When set, the next write throws as if the app were killed at that moment. */
  private killNextWrite = false;
  /** The killed write leaves half of the new contents behind (a torn write). */
  private tornWrite = false;
  /** Called at the start of every write (to change the world at that moment). */
  onWrite: ((path: string) => void) | undefined;
  /** Every write and move, in order, for the atomic-write tests. */
  ops: string[] = [];
  failReads = false;

  killOnNextWrite(opts: { torn?: boolean } = {}): void { this.killNextWrite = true; this.tornWrite = !!opts.torn; }

  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async read(p: string): Promise<string> {
    if (this.failReads) throw new Error('I/O error');
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  }
  async write(p: string, contents: string): Promise<void> {
    this.onWrite?.(p);
    if (this.killNextWrite) {
      this.killNextWrite = false;
      if (this.tornWrite) { this.tornWrite = false; this.files.set(p, contents.slice(0, Math.floor(contents.length / 2))); }
      throw new Error('process killed');
    }
    this.writes++;
    this.ops.push(`write ${p}`);
    this.files.set(p, contents);
  }
  async move(from: string, to: string): Promise<void> {
    const v = this.files.get(from);
    if (v === undefined) throw new Error(`ENOENT ${from}`);
    this.ops.push(`move ${from} -> ${to}`);
    this.files.set(to, v);
    this.files.delete(from);
  }
  async remove(p: string): Promise<void> { this.files.delete(p); }
}

// ─── Server ───────────────────────────────────────────────────────────────────

export interface LabourRow {
  id: string; projectId: string; siteId: string; workerId: string; date: string;
  hoursWorked: number; dailyRate?: number; notes: string | null; registeredById: string;
}
export interface AttendanceRow {
  id: string; projectId: string; siteId: string; workerId: string; date: string; status: string;
  checkInTime: string | null; checkOutTime: string | null; notes: string | null; recordedById: string;
}

export class FakeServer {
  labour: LabourRow[] = [];
  attendance: AttendanceRow[] = [];
  /** Answers for the next write requests, used before the real handling. */
  private scripted: HttpError[] = [];
  /** Older API: a duplicate create answered 500 instead of 409. */
  duplicateAnswers500 = false;
  /** Called after a write is stored (to kill the app between the server's save and the phone's). */
  onCommit: (() => void) | null = null;
  writeRequests = 0;
  private seq = 0;

  failNextWrites(status: number, times = 1, error?: string, code?: string): void {
    for (let i = 0; i < times; i++) this.scripted.push(httpError(status, error ?? `HTTP ${status}`, code));
  }

  private duplicate(code: string, message: string): HttpError {
    return this.duplicateAnswers500 ? httpError(500, 'Internal server error', 'INTERNAL_ERROR') : httpError(409, message, code);
  }

  write(kind: OpKind, payload: Record<string, unknown>, userId: string, today: string): { id: string } {
    this.writeRequests++;
    const scripted = this.scripted.shift();
    if (scripted) throw scripted;
    const id = `srv-${++this.seq}`;
    if (kind === 'labour_create') {
      const d = payload['data'] as Record<string, unknown>;
      if (this.labour.some((r) => r.siteId === d['siteId'] && r.workerId === d['workerId'] && r.date === d['date'])) {
        throw this.duplicate('LABOUR_ENTRY_EXISTS', 'A labour entry already exists for this worker on this date');
      }
      this.labour.push({
        id, projectId: String(d['projectId']), siteId: String(d['siteId']), workerId: String(d['workerId']),
        date: String(d['date']), hoursWorked: Number(d['hoursWorked']),
        dailyRate: d['dailyRate'] === undefined ? undefined : Number(d['dailyRate']),
        notes: (d['notes'] as string | undefined) ?? null, registeredById: userId,
      });
    } else if (kind === 'attendance_create') {
      const d = payload['data'] as Record<string, unknown>;
      const siteId = String(payload['siteId']);
      if (this.attendance.some((r) => r.siteId === siteId && r.workerId === d['workerId'] && r.date === d['date'])) {
        throw this.duplicate('ATTENDANCE_EXISTS', 'Attendance record already exists for this worker on this date');
      }
      this.attendance.push({
        id, projectId: String(payload['projectId']), siteId, workerId: String(d['workerId']), date: String(d['date']),
        status: String(d['status']), checkInTime: (d['checkInTime'] as string | undefined) ?? null,
        checkOutTime: (d['checkOutTime'] as string | undefined) ?? null, notes: (d['notes'] as string | undefined) ?? null,
        recordedById: userId,
      });
    } else {
      const siteId = String(payload['siteId']);
      const workerId = `worker-of-${userId}`;
      const existing = this.attendance.find((r) => r.siteId === siteId && r.workerId === workerId && r.date === today);
      if (existing) {
        existing.checkInTime = (payload['checkInTime'] as string | null) ?? existing.checkInTime;
        this.onCommit?.();
        return { id: existing.id };
      }
      this.attendance.push({
        id, projectId: String(payload['projectId']), siteId, workerId, date: today, status: 'present',
        checkInTime: (payload['checkInTime'] as string | null) ?? null, checkOutTime: null, notes: null, recordedById: userId,
      });
    }
    this.onCommit?.();
    return { id };
  }
}

// ─── Network and session ──────────────────────────────────────────────────────

export type NetMode =
  | 'online'
  /** No connection: fails before reaching the server. */
  | 'offline'
  /** The request times out without reaching the server; the server is unreachable. */
  | 'timeout-unreachable';

/** What happens to the answer of the next write after the server stored it. */
export type LostAnswer =
  | 'drop-after-commit'
  | 'timeout-after-commit'
  /** The server is up but too slow: the request times out and nothing is stored. */
  | 'timeout-no-save';

export class Harness {
  clock = new Clock();
  fs = new MemFs();
  server = new FakeServer();
  net: NetMode = 'online';
  private lostAnswers: LostAnswer[] = [];
  /** The signed-in user (null = signed out). */
  userId: string | null = 'user-a';
  /** When true, the next request finds the session ended (refresh refused): 401 and signed out. */
  sessionEnds = false;
  /** Requests that carried each user's session, by kind. */
  sentBy: Array<{ kind: string; userId: string }> = [];

  loseNextAnswer(mode: LostAnswer): void { this.lostAnswers.push(mode); }

  signIn(userId: string): void { this.userId = userId; this.sessionEnds = false; }
  signOut(): void { this.userId = null; }

  private gate(): string {
    if (this.net === 'offline') throw networkError();
    if (this.net === 'timeout-unreachable') throw timeoutError();
    if (this.sessionEnds) { this.sessionEnds = false; this.userId = null; throw httpError(401, 'Unauthorized', 'UNAUTHORIZED'); }
    if (!this.userId) throw httpError(401, 'Unauthorized', 'UNAUTHORIZED');
    return this.userId;
  }

  /** A create request as the app's API module sends it. */
  async callWrite(kind: OpKind, payload: Record<string, unknown>): Promise<{ id: string }> {
    const user = this.gate();
    this.sentBy.push({ kind, userId: user });
    const lost = this.lostAnswers.shift();
    if (lost === 'timeout-no-save') throw timeoutError();
    const today = new Date(this.clock.now()).toISOString().slice(0, 10);
    const res = this.server.write(kind, payload, user, today);
    if (lost === 'drop-after-commit') throw networkError();
    if (lost === 'timeout-after-commit') throw timeoutError();
    return res;
  }

  /** GET .../labour?date=&workerId= (site-scoped list). */
  async listLabour(siteId: string, date: string, workerId: string): Promise<LabourRow[]> {
    this.gate();
    return this.server.labour.filter((r) => r.siteId === siteId && r.date === date && r.workerId === workerId);
  }

  /** GET .../attendance?date=&workerId= (site-scoped list). */
  async listAttendance(siteId: string, date: string, workerId: string): Promise<AttendanceRow[]> {
    this.gate();
    return this.server.attendance.filter((r) => r.siteId === siteId && r.date === date && r.workerId === workerId);
  }

  /** GET /health: any answer means reachable. */
  async reachable(): Promise<boolean> {
    return this.net === 'online';
  }
}

// ─── Payload builders (the shapes the screens queue) ──────────────────────────

export function labourPayload(over: Partial<{ workerId: string; date: string; hoursWorked: number; notes: string; dailyRate: number; siteId: string }> = {}) {
  return {
    data: {
      projectId: 'proj-1',
      siteId: over.siteId ?? 'site-1',
      workerId: over.workerId ?? 'worker-1',
      date: over.date ?? '2026-11-24',
      hoursWorked: over.hoursWorked ?? 8,
      ...(over.dailyRate !== undefined && { dailyRate: over.dailyRate }),
      ...(over.notes !== undefined && { notes: over.notes }),
    },
  };
}

export function attendancePayload(over: Partial<{ workerId: string; date: string; status: string; checkInTime: string; notes: string }> = {}) {
  return {
    projectId: 'proj-1',
    siteId: 'site-1',
    data: {
      workerId: over.workerId ?? 'worker-1',
      date: over.date ?? '2026-11-24',
      status: over.status ?? 'present',
      ...(over.checkInTime !== undefined && { checkInTime: over.checkInTime }),
      ...(over.notes !== undefined && { notes: over.notes }),
    },
  };
}

/** The queue file path the app uses (documentDirectory + name). */
export const DOC_DIR = 'file:///data/user/0/com.constructos.app/files/';
export const QUEUE_PATH = `${DOC_DIR}offline_queue.json`;
