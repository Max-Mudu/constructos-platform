/**
 * Offline queue (src/utils/offlineQueueCore.ts) — run with `npm test` in
 * packages/mobile: Node 24's test runner runs these .ts files directly (its
 * built-in type stripping), so no React Native and no extra package is needed.
 *
 * Test names carry a [category] tag; CI-independent checks look for one
 * passing test per category.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OfflineQueue, MAX_TRANSIENT_FAILURES, SYNCED_RETENTION_MS,
  classifyError, createFileStorage, matchesQueuedEntry, shouldQueueAfterError, parseQueueFile,
} from '../src/utils/offlineQueueCore.ts';
import type { QueueEntry, QueueFile, QueueTransport, ServerRecord } from '../src/utils/offlineQueueCore.ts';
import {
  Harness, QUEUE_PATH, attendancePayload, httpError, labourPayload, networkError, timeoutError,
} from './offlineQueue.harness.ts';
import { scenarios } from './offlineQueue.scenarios.ts';
import type { Driver } from './offlineQueue.scenarios.ts';

// ─── Wiring the queue to the fake world ───────────────────────────────────────

function transportFor(h: Harness): QueueTransport {
  return {
    async send(entry) {
      const created = await h.callWrite(entry.type, entry.payload);
      return { serverId: created.id };
    },
    async findExisting(entry): Promise<ServerRecord | null> {
      const d = (entry.payload['data'] ?? {}) as Record<string, unknown>;
      if (entry.type === 'labour_create') {
        const [r] = await h.listLabour(String(d['siteId']), String(d['date']), String(d['workerId']));
        return r ? { id: r.id, recordedById: r.registeredById, fields: { ...r } } : null;
      }
      if (entry.type === 'attendance_create') {
        const [r] = await h.listAttendance(String(entry.payload['siteId']), String(d['date']), String(d['workerId']));
        return r ? { id: r.id, recordedById: r.recordedById, fields: { ...r } } : null;
      }
      return null;
    },
    async isServerReachable() {
      return h.reachable();
    },
  };
}

let idSeq = 0;
function makeQueue(h: Harness, warnings: string[] = []): OfflineQueue {
  return new OfflineQueue({
    storage: createFileStorage(h.fs, QUEUE_PATH, h.clock.now),
    transport: transportFor(h),
    now: h.clock.now,
    currentUserId: () => h.userId,
    newId: () => `e${++idSeq}`,
    warn: (m) => warnings.push(m),
  });
}

function onDisk(h: Harness): QueueFile {
  const raw = h.fs.files.get(QUEUE_PATH);
  assert.ok(raw !== undefined, 'queue file exists');
  const parsed = parseQueueFile(raw, new Date(h.clock.now()).toISOString());
  assert.ok(parsed.ok);
  return parsed.file;
}

function only(h: Harness): QueueEntry {
  const { entries } = onDisk(h);
  assert.equal(entries.length, 1, `exactly one entry on disk, found ${entries.length}`);
  return entries[0]!;
}

function driverFor(h: Harness): Driver {
  let q = makeQueue(h);
  return {
    async enqueue(kind, payload) {
      try {
        const r = await q.enqueue(kind, payload);
        return r.status === 'queued' ? 'accepted' : 'refused';
      } catch {
        return 'refused';
      }
    },
    async flush() { await q.flush(); },
    async restart() { q = makeQueue(h); await q.load(); },
    async unsynced() {
      const raw = h.fs.files.get(QUEUE_PATH);
      if (!raw) return [];
      const parsed = parseQueueFile(raw, new Date(h.clock.now()).toISOString());
      assert.ok(parsed.ok);
      return parsed.file.entries.filter((e) => e.state !== 'synced')
        .map((e) => ({ type: e.type, payload: e.payload, userId: e.userId }));
    },
  };
}

// ─── Shared scenarios ─────────────────────────────────────────────────────────

describe('scenarios', () => {
  for (const s of scenarios) {
    test(s.name, async () => {
      const h = new Harness();
      await s.run(h, driverFor(h));
    });
  }
});

// ─── One flush per outcome ────────────────────────────────────────────────────

describe('outcome of one send, by answer', () => {
  interface Row {
    tag: string;
    name: string;
    setup(h: Harness): void;
    state: QueueEntry['state'];
    counted: number;
    failure?: string;
    rows: number;
    stoppedBy?: string;
    alreadyOnServer?: boolean;
  }
  const rows: Row[] = [
    { tag: 'outcome:success', name: '201 → synced', setup: () => {}, state: 'synced', counted: 0, rows: 1 },
    { tag: 'outcome:offline', name: 'no connection → pending, not counted, sync stops', setup: (h) => { h.net = 'offline'; },
      state: 'pending', counted: 0, rows: 0, stoppedBy: 'offline' },
    { tag: 'outcome:timeout', name: 'timeout, server unreachable → pending, not counted', setup: (h) => { h.net = 'timeout-unreachable'; },
      state: 'pending', counted: 0, rows: 0, stoppedBy: 'offline' },
    { tag: 'outcome:timeout', name: 'timeout while the server is reachable (slow server) → counted, sync stops',
      setup: (h) => h.loseNextAnswer('timeout-no-save'), state: 'pending', counted: 1, rows: 0, stoppedBy: 'timeout' },
    { tag: 'outcome:5xx', name: '500 → pending, counted', setup: (h) => h.server.failNextWrites(500), state: 'pending', counted: 1, rows: 0 },
    { tag: 'outcome:5xx', name: '503 → pending, counted', setup: (h) => h.server.failNextWrites(503), state: 'pending', counted: 1, rows: 0 },
    { tag: 'outcome:408', name: '408 → pending, counted', setup: (h) => h.server.failNextWrites(408), state: 'pending', counted: 1, rows: 0 },
    { tag: 'outcome:429', name: '429 → pending, counted, sync stops', setup: (h) => h.server.failNextWrites(429),
      state: 'pending', counted: 1, rows: 0, stoppedBy: 'rate_limited' },
    { tag: 'outcome:4xx', name: '422 → failed with the server message', setup: (h) => h.server.failNextWrites(422, 1, 'Validation failed'),
      state: 'failed', counted: 0, failure: 'rejected', rows: 0 },
    { tag: 'outcome:4xx', name: '403 → failed', setup: (h) => h.server.failNextWrites(403, 1, 'Worker is not assigned to this site'),
      state: 'failed', counted: 0, failure: 'rejected', rows: 0 },
    { tag: 'outcome:4xx', name: '404 → failed', setup: (h) => h.server.failNextWrites(404, 1, 'Labour entry not found'),
      state: 'failed', counted: 0, failure: 'rejected', rows: 0 },
    { tag: 'outcome:401', name: '401 (session ended) → pending, not counted, sync stops', setup: (h) => { h.sessionEnds = true; },
      state: 'pending', counted: 0, rows: 0, stoppedBy: 'signed_out' },
    { tag: 'outcome:409-own', name: '409 and the server holds this user\'s identical entry → synced', setup: (h) => {
      h.server.labour.push({ id: 'srv-own', projectId: 'proj-1', siteId: 'site-1', workerId: 'worker-1', date: '2026-11-24',
        hoursWorked: 8, notes: null, registeredById: 'user-a' });
    }, state: 'synced', counted: 0, rows: 1, alreadyOnServer: true },
    { tag: 'outcome:409-other', name: '409 and the server holds another user\'s entry → failed conflict', setup: (h) => {
      h.server.labour.push({ id: 'srv-b', projectId: 'proj-1', siteId: 'site-1', workerId: 'worker-1', date: '2026-11-24',
        hoursWorked: 8, notes: null, registeredById: 'user-b' });
    }, state: 'failed', counted: 0, failure: 'conflict', rows: 1 },
    { tag: 'outcome:409-other', name: '409 and the same user\'s entry has different hours → failed conflict', setup: (h) => {
      h.server.labour.push({ id: 'srv-a6', projectId: 'proj-1', siteId: 'site-1', workerId: 'worker-1', date: '2026-11-24',
        hoursWorked: 6, notes: null, registeredById: 'user-a' });
    }, state: 'failed', counted: 0, failure: 'conflict', rows: 1 },
  ];

  for (const row of rows) {
    test(`[${row.tag}] ${row.name}`, async () => {
      const h = new Harness();
      const q = makeQueue(h);
      await q.enqueue('labour_create', labourPayload());
      row.setup(h);
      const report = await q.flush();
      const e = only(h);
      assert.equal(e.state, row.state);
      assert.equal(e.transientFailures, row.counted, 'counted failures');
      assert.equal(e.failure?.kind, row.failure);
      assert.equal(h.server.labour.length, row.rows, 'rows on the server');
      assert.equal(report.stoppedBy, row.stoppedBy);
      if (row.alreadyOnServer) assert.equal(e.alreadyOnServer, true);
      if (row.failure === 'rejected') assert.ok(e.failure!.message.length > 0 && !/^The server refused/.test(e.failure!.message));
      if (row.state === 'pending' && row.counted === 0) assert.equal(e.nextAttemptAt, undefined, 'no back-off for offline/signed out');
    });
  }

  test('[outcome:409-own] attendance: 409 and the server holds this user\'s identical record → synced', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    h.server.attendance.push({ id: 'srv-at', projectId: 'proj-1', siteId: 'site-1', workerId: 'worker-1', date: '2026-11-24',
      status: 'late', checkInTime: '08:10', checkOutTime: null, notes: null, recordedById: 'user-a' });
    await q.enqueue('attendance_create', attendancePayload({ status: 'late', checkInTime: '08:10' }));
    await q.flush();
    const e = only(h);
    assert.equal(e.state, 'synced');
    assert.equal(e.serverId, 'srv-at');
    assert.equal(h.server.attendance.length, 1);
  });

  test('[outcome:409-other] attendance: different status by the same user → failed conflict, record untouched', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    h.server.attendance.push({ id: 'srv-at', projectId: 'proj-1', siteId: 'site-1', workerId: 'worker-1', date: '2026-11-24',
      status: 'absent', checkInTime: null, checkOutTime: null, notes: null, recordedById: 'user-a' });
    await q.enqueue('attendance_create', attendancePayload({ status: 'present' }));
    await q.flush();
    const e = only(h);
    assert.equal(e.state, 'failed');
    assert.equal(e.failure?.kind, 'conflict');
    assert.equal(h.server.attendance[0]!.status, 'absent');
  });

  test('[outcome:5xx] an older server that answers 500 for a duplicate: own entry found → synced, not retried', async () => {
    const h = new Harness();
    h.server.duplicateAnswers500 = true;
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    h.loseNextAnswer('drop-after-commit');
    await q.flush();
    await q.flush();
    const e = only(h);
    assert.equal(e.state, 'synced');
    assert.equal(e.transientFailures, 0);
    assert.equal(h.server.labour.length, 1);
  });

  test('[outcome:timeout] timeout after the server saved it, server reachable → found on the server → synced', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    h.loseNextAnswer('timeout-after-commit');
    await q.flush();
    const e = only(h);
    assert.equal(e.state, 'synced');
    assert.equal(e.alreadyOnServer, true);
    assert.equal(h.server.labour.length, 1);
  });
});

// ─── Retry counting and the limit ─────────────────────────────────────────────

describe('retry counting', () => {
  test('[offline-count] 20 syncs with no signal: 20 attempts, 0 counted failures, still pending', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    h.net = 'offline';
    for (let i = 0; i < 20; i++) await q.flush();
    const e = only(h);
    assert.equal(e.state, 'pending');
    assert.equal(e.attempts, 20);
    assert.equal(e.transientFailures, 0);
    assert.match(e.lastError ?? '', /No connection/);
  });

  test('[offline-count] offline syncs in between do not add to server-side failures', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    h.server.failNextWrites(500, 2);
    await q.flush({ manual: true });
    h.net = 'offline';
    for (let i = 0; i < 5; i++) await q.flush({ manual: true });
    h.net = 'online';
    await q.flush({ manual: true });
    const e = only(h);
    assert.equal(e.transientFailures, 2);
    assert.equal(e.state, 'pending');
    await q.flush({ manual: true });
    assert.equal(only(h).state, 'synced');
  });

  test(`[outcome:5xx] after ${MAX_TRANSIENT_FAILURES} server failures the entry is failed (kept), Retry resets and sends it`, async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    h.server.failNextWrites(503, MAX_TRANSIENT_FAILURES);
    for (let i = 0; i < MAX_TRANSIENT_FAILURES; i++) await q.flush({ manual: true });
    let e = only(h);
    assert.equal(e.state, 'failed');
    assert.equal(e.failure?.kind, 'retry_limit');
    assert.match(e.failure!.message, /HTTP 503/);
    await q.flush({ manual: true });
    assert.equal(only(h).state, 'failed', 'a failed entry is not sent again without Retry');
    await q.retry(e.id);
    e = only(h);
    assert.equal(e.state, 'pending');
    assert.equal(e.transientFailures, 0);
    await q.flush({ manual: true });
    assert.equal(only(h).state, 'synced');
    assert.equal(h.server.labour.length, 1);
  });

  test('[outcome:5xx] automatic syncs wait for the back-off; a manual sync does not', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    h.server.failNextWrites(500);
    await q.flush();
    const before = h.server.writeRequests;
    await q.flush();
    assert.equal(h.server.writeRequests, before, 'automatic sync skipped the entry in back-off');
    assert.equal(q.hasDuePending('user-a'), false);
    h.clock.advance(31_000);
    assert.equal(q.hasDuePending('user-a'), true);
    await q.flush({ manual: true });
    assert.equal(only(h).state, 'synced');
  });
});

// ─── Restart recovery ─────────────────────────────────────────────────────────

describe('restart recovery', () => {
  test('[restart] the "sending" mark is on disk before the request leaves', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    let stateDuringSend: string | undefined;
    const original = h.callWrite.bind(h);
    h.callWrite = async (kind, payload) => {
      stateDuringSend = only(h).state;
      return original(kind, payload);
    };
    await q.flush();
    assert.equal(stateDuringSend, 'sending');
    assert.equal(only(h).state, 'synced');
  });

  test('[restart] killed after the server saved it: after restart the resend is matched, one row, synced', async () => {
    const h = new Harness();
    let q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload({ notes: 'late shift', dailyRate: 1500 }));
    h.server.onCommit = () => { h.server.onCommit = null; h.fs.killOnNextWrite(); };
    const report = await q.flush();
    assert.equal(report.stoppedBy, 'storage');
    assert.equal(only(h).state, 'sending', 'disk still says sending');
    q = makeQueue(h); // restart
    await q.load();
    assert.equal(q.view('user-a').pending.length, 1, 'shown as waiting after restart');
    await q.flush();
    const e = only(h);
    assert.equal(e.state, 'synced');
    assert.equal(e.alreadyOnServer, true);
    assert.equal(h.server.labour.length, 1);
  });

  test('[restart] killed while saving the "sending" mark: nothing was sent, the entry is still pending', async () => {
    const h = new Harness();
    let q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    h.fs.killOnNextWrite();
    const report = await q.flush();
    assert.equal(report.stoppedBy, 'storage');
    assert.equal(h.server.writeRequests, 0);
    q = makeQueue(h);
    await q.flush();
    assert.equal(only(h).state, 'synced');
    assert.equal(h.server.labour.length, 1);
  });

  test('[restart] killed between the mark and the request: the entry is sent once after restart', async () => {
    const h = new Harness();
    const q1 = makeQueue(h);
    await q1.enqueue('labour_create', labourPayload());
    const original = h.callWrite.bind(h);
    // The request never completes: the process is gone before it leaves.
    h.callWrite = () => new Promise<never>(() => {});
    void q1.flush();
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    assert.equal(only(h).state, 'sending');
    h.callWrite = original;
    const q2 = makeQueue(h); // restart
    await q2.flush();
    assert.equal(only(h).state, 'synced');
    assert.equal(h.server.labour.length, 1);
  });

  test('[restart] a reload part-way through a sync keeps every entry exactly once', async () => {
    const h = new Harness();
    const q1 = makeQueue(h);
    h.net = 'offline';
    for (const w of ['w1', 'w2', 'w3']) await q1.enqueue('labour_create', labourPayload({ workerId: w }));
    h.net = 'online';
    // The second send kills the app after the server stored it.
    let n = 0;
    h.server.onCommit = () => { if (++n === 2) { h.server.onCommit = null; h.fs.killOnNextWrite(); } };
    await q1.flush();
    const q2 = makeQueue(h);
    await q2.load();
    assert.deepEqual(q2.view('user-a').pending.map((e) => (e.payload['data'] as { workerId: string }).workerId), ['w2', 'w3']);
    await q2.flush();
    assert.deepEqual(h.server.labour.map((r) => r.workerId).sort(), ['w1', 'w2', 'w3']);
    assert.equal(onDisk(h).entries.filter((e) => e.state !== 'synced').length, 0);
  });
});

// ─── User binding ─────────────────────────────────────────────────────────────

describe('user binding', () => {
  test('[user-binding] B\'s sync never sends A\'s entries, and B does not see them', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    h.net = 'offline';
    await q.enqueue('labour_create', labourPayload({ workerId: 'wa' }));
    h.signIn('user-b');
    await q.enqueue('labour_create', labourPayload({ workerId: 'wb' }));
    h.net = 'online';
    await q.flush({ manual: true });
    assert.deepEqual(h.server.labour.map((r) => [r.workerId, r.registeredById]), [['wb', 'user-b']]);
    assert.equal(q.view('user-b').pending.length, 0);
    assert.equal(q.view('user-a').pending.length, 1);
    h.signIn('user-a');
    await q.flush();
    assert.deepEqual(h.server.labour.map((r) => [r.workerId, r.registeredById]), [['wb', 'user-b'], ['wa', 'user-a']]);
  });

  test('[user-binding] the user changes while a sync runs: the sync stops before the next entry', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    h.net = 'offline';
    await q.enqueue('labour_create', labourPayload({ workerId: 'w1' }));
    await q.enqueue('labour_create', labourPayload({ workerId: 'w2' }));
    h.net = 'online';
    const original = h.callWrite.bind(h);
    h.callWrite = async (kind, payload) => {
      const r = await original(kind, payload);
      h.signIn('user-b'); // someone else signs in while the first request is answered
      return r;
    };
    const report = await q.flush();
    assert.equal(report.stoppedBy, 'user_changed');
    assert.equal(h.server.labour.length, 1);
    assert.ok(h.sentBy.every((s) => s.userId === 'user-a'));
  });

  test('[user-binding] B cannot retry or dismiss A\'s failed entry', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    h.server.failNextWrites(422, 1, 'Validation failed');
    await q.flush();
    const id = only(h).id;
    h.signIn('user-b');
    await q.retry(id);
    assert.equal(await q.dismiss(id), false);
    assert.equal(only(h).state, 'failed');
    assert.equal(q.view('user-b').failed.length, 0);
  });

  test('[user-binding] the user captured at save time owns the entry even if the session ended during the request', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    h.signOut(); // the 401 path signed the user out before the screen queued it
    const r = await q.enqueue('labour_create', labourPayload(), { userId: 'user-a' });
    assert.equal(r.status, 'queued');
    assert.equal(only(h).userId, 'user-a');
    await assert.rejects(q.enqueue('labour_create', labourPayload({ workerId: 'x' })), /signed-in user/);
  });

  test('[user-binding] logging out with "delete" removes only that user\'s entries, logged', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    h.net = 'offline';
    await q.enqueue('labour_create', labourPayload({ workerId: 'wa' }));
    h.signIn('user-b');
    await q.enqueue('labour_create', labourPayload({ workerId: 'wb' }));
    assert.equal(q.unsyncedCount('user-a'), 1);
    assert.equal(await q.deleteForUser('user-a'), 1);
    const file = onDisk(h);
    assert.deepEqual(file.entries.map((e) => e.userId), ['user-b']);
    assert.ok(file.log.some((l) => l.event === 'deleted_at_logout' && l.userId === 'user-a'));
  });
});

// ─── Deduplication ────────────────────────────────────────────────────────────

describe('deduplication', () => {
  test('[dedup] the same entry saved twice while waiting is kept once', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    h.net = 'offline';
    assert.equal((await q.enqueue('labour_create', labourPayload({ notes: 'a' }))).status, 'queued');
    assert.equal((await q.enqueue('labour_create', labourPayload({ notes: 'a' }))).status, 'already_queued');
    assert.equal(onDisk(h).entries.length, 1);
  });

  test('[dedup] a different entry for the same worker and day is refused while the first waits', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    h.net = 'offline';
    await q.enqueue('attendance_create', attendancePayload({ status: 'present' }));
    const r = await q.enqueue('attendance_create', attendancePayload({ status: 'absent' }));
    assert.equal(r.status, 'blocked');
    assert.ok(r.status === 'blocked' && r.message.length > 0);
    assert.equal(onDisk(h).entries.length, 1);
    // Another worker, or another day, is a different entry.
    assert.equal((await q.enqueue('attendance_create', attendancePayload({ workerId: 'worker-2' }))).status, 'queued');
    assert.equal((await q.enqueue('attendance_create', attendancePayload({ date: '2026-11-25' }))).status, 'queued');
  });

  test('[dedup] replaying the same entry many times leaves one server row', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    for (let i = 0; i < 3; i++) h.loseNextAnswer('drop-after-commit');
    for (let i = 0; i < 5; i++) await q.flush();
    assert.equal(h.server.labour.length, 1);
    assert.equal(only(h).state, 'synced');
  });

  test('[dedup] matchesQueuedEntry compares user, worker, day and every entered field', () => {
    const entry: QueueEntry = {
      id: 'x', type: 'labour_create', payload: labourPayload({ hoursWorked: 7.5, notes: 'n', dailyRate: 1200 }),
      userId: 'u1', createdAt: '2026-11-24T07:00:00.000Z', state: 'sending', attempts: 1, transientFailures: 0,
    };
    const base = { workerId: 'worker-1', date: '2026-11-24T00:00:00.000Z', hoursWorked: '7.50', notes: 'n', dailyRate: '1200' };
    assert.equal(matchesQueuedEntry(entry, { id: 's', recordedById: 'u1', fields: base }), true);
    assert.equal(matchesQueuedEntry(entry, { id: 's', recordedById: 'u2', fields: base }), false);
    assert.equal(matchesQueuedEntry(entry, { id: 's', recordedById: 'u1', fields: { ...base, hoursWorked: '8' } }), false);
    assert.equal(matchesQueuedEntry(entry, { id: 's', recordedById: 'u1', fields: { ...base, notes: null } }), false);
    assert.equal(matchesQueuedEntry(entry, { id: 's', recordedById: 'u1', fields: { ...base, dailyRate: '1300' } }), false);
    // Rate hidden from a non-finance caller: not compared.
    const { dailyRate: _r, ...noRate } = base;
    assert.equal(matchesQueuedEntry(entry, { id: 's', recordedById: 'u1', fields: noRate }), true);
    assert.equal(matchesQueuedEntry({ ...entry, userId: null }, { id: 's', recordedById: 'u1', fields: base }), false);
  });
});

// ─── Migration of the previous file format ────────────────────────────────────

describe('migration', () => {
  const v1 = (ops: unknown[]) => JSON.stringify(ops);

  test('[migration] version-1 ops become pending entries of their user, failure count reset, file rewritten as version 2', async () => {
    const h = new Harness();
    h.fs.files.set(QUEUE_PATH, v1([
      { id: 'a1', type: 'labour_create', payload: labourPayload(), createdAt: '2026-11-23T08:00:00.000Z', retryCount: 5, userId: 'user-a' },
      { id: 'a2', type: 'attendance_self', payload: { projectId: 'p', siteId: 's', checkInTime: null }, createdAt: '2026-11-24T05:00:00.000Z', retryCount: 0, userId: 'user-c' },
    ]));
    const q = makeQueue(h);
    await q.load();
    const file = onDisk(h);
    assert.equal(file.version, 2);
    assert.deepEqual(file.entries.map((e) => [e.id, e.state, e.userId, e.attempts, e.transientFailures, e.migratedFrom]),
      [['a1', 'pending', 'user-a', 5, 0, 1], ['a2', 'pending', 'user-c', 0, 0, 1]]);
    assert.ok(file.log.some((l) => l.event === 'migrated_v1'));
    await q.flush();
    assert.equal(h.server.labour.length, 1, 'retryCount 5 from the old version did not cause a drop');
  });

  test('[migration] a version-1 op without a user is failed "unknown owner", never sent automatically; Retry sends it as the current user', async () => {
    const h = new Harness();
    h.fs.files.set(QUEUE_PATH, v1([{ id: 'n1', type: 'labour_create', payload: labourPayload(), createdAt: '2026-11-23T08:00:00.000Z', retryCount: 0 }]));
    const q = makeQueue(h);
    await q.flush({ manual: true });
    let e = only(h);
    assert.equal(e.state, 'failed');
    assert.equal(e.failure?.kind, 'unknown_owner');
    assert.equal(h.server.writeRequests, 0);
    assert.equal(q.view('user-a').failed.length, 1, 'shown to the signed-in user to decide');
    await q.retry(e.id);
    await q.flush({ manual: true });
    e = only(h);
    assert.equal(e.state, 'synced');
    assert.equal(e.userId, 'user-a');
    assert.equal(h.server.labour[0]!.registeredById, 'user-a');
    assert.ok(onDisk(h).log.some((l) => l.event === 'claimed'));
  });

  test('[migration] unreadable items in a version-1 file are kept in the file, not dropped', async () => {
    const h = new Harness();
    h.fs.files.set(QUEUE_PATH, v1([{ nonsense: true }, { id: 'ok', type: 'labour_create', payload: labourPayload(), retryCount: 0, userId: 'user-a' }]));
    const q = makeQueue(h);
    await q.load();
    const file = onDisk(h);
    assert.equal(file.entries.length, 1);
    assert.deepEqual(file.invalid, [{ nonsense: true }]);
    await q.load();
    const again = makeQueue(h);
    await again.load();
    assert.equal(onDisk(h).entries.length, 1, 'loading twice does not duplicate');
  });

  test('[migration] migration is repeated safely if the app is killed before the new file is written', async () => {
    const h = new Harness();
    const raw = v1([{ id: 'a1', type: 'labour_create', payload: labourPayload(), retryCount: 0, userId: 'user-a' }]);
    h.fs.files.set(QUEUE_PATH, raw);
    h.fs.killOnNextWrite();
    const q1 = makeQueue(h);
    await q1.load();
    assert.equal(h.fs.files.get(QUEUE_PATH), raw, 'old file untouched when the write failed');
    const q2 = makeQueue(h);
    await q2.load();
    assert.equal(onDisk(h).entries.length, 1);
  });
});

// ─── Storage ──────────────────────────────────────────────────────────────────

describe('storage', () => {
  test('[atomic-storage] every save writes a temp file and renames it over the queue file', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    assert.deepEqual(h.fs.ops.slice(-2), [`write ${QUEUE_PATH}.tmp`, `move ${QUEUE_PATH}.tmp -> ${QUEUE_PATH}`]);
    assert.equal(h.fs.files.has(`${QUEUE_PATH}.tmp`), false);
  });

  test('[atomic-storage] killed during a save: the previous file is intact and the new entry was reported as not saved', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload({ workerId: 'w1' }));
    h.fs.killOnNextWrite();
    await assert.rejects(q.enqueue('labour_create', labourPayload({ workerId: 'w2' })));
    assert.equal(only(h).id, onDisk(h).entries[0]!.id);
    assert.equal(q.view('user-a').pending.length, 1, 'memory matches the disk after a failed save');
  });

  test('[atomic-storage] killed between deleting the old file and the rename (iOS): the complete temp file is used', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    const contents = h.fs.files.get(QUEUE_PATH)!;
    h.fs.files.delete(QUEUE_PATH);
    h.fs.files.set(`${QUEUE_PATH}.tmp`, contents);
    const q2 = makeQueue(h);
    await q2.load();
    assert.equal(q2.view('user-a').pending.length, 1);
  });

  test('[atomic-storage] an unreadable queue file is copied aside before a new queue starts', async () => {
    const h = new Harness();
    h.fs.files.set(QUEUE_PATH, '{"version":2,"entries":[{"id":"x"');
    const warnings: string[] = [];
    const q = makeQueue(h, warnings);
    await q.load();
    const kept = [...h.fs.files.keys()].filter((k) => k.startsWith(`${QUEUE_PATH}.unreadable-`));
    assert.equal(kept.length, 1);
    assert.equal(h.fs.files.get(kept[0]!), '{"version":2,"entries":[{"id":"x"');
    assert.ok(warnings.some((w) => /could not be read/.test(w)));
  });

  test('[atomic-storage] a read error leaves the file alone and saving offline reports failure', async () => {
    const h = new Harness();
    const q0 = makeQueue(h);
    await q0.enqueue('labour_create', labourPayload());
    const before = h.fs.files.get(QUEUE_PATH);
    h.fs.failReads = true;
    const q = makeQueue(h);
    await assert.rejects(q.enqueue('labour_create', labourPayload({ workerId: 'w2' })));
    const report = await q.flush();
    assert.equal(report.stoppedBy, 'storage');
    assert.equal(h.fs.files.get(QUEUE_PATH), before);
  });
});

// ─── Failed entries: reason, retry, dismiss ───────────────────────────────────

describe('failed entries', () => {
  test('[dismiss] dismissing a failed entry removes it and records who did it', async () => {
    const h = new Harness();
    const warnings: string[] = [];
    const q = makeQueue(h, warnings);
    await q.enqueue('labour_create', labourPayload(), { label: 'Jane Doe · 2026-11-24 · 8h' });
    h.server.failNextWrites(403, 1, 'Worker is not assigned to this site');
    await q.flush();
    const [failed] = q.view('user-a').failed;
    assert.ok(failed);
    assert.equal(failed.failure?.message, 'Worker is not assigned to this site');
    assert.equal(failed.label, 'Jane Doe · 2026-11-24 · 8h');
    assert.equal(await q.dismiss(failed.id), true);
    const file = onDisk(h);
    assert.equal(file.entries.length, 0);
    assert.ok(file.log.some((l) => l.event === 'dismissed_by_user' && l.entryId === failed.id && /user-a/.test(l.detail ?? '')));
    assert.ok(warnings.some((w) => /dismissed by the user/.test(w)));
  });

  test('[dismiss] a pending entry cannot be dismissed', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    h.net = 'offline';
    const r = await q.enqueue('labour_create', labourPayload());
    assert.equal(await q.dismiss(r.entry.id), false);
    assert.equal(only(h).state, 'pending');
  });

  test('[stale-day] a worker check-in saved yesterday is not sent as today\'s', async () => {
    const h = new Harness();
    h.signIn('worker-user');
    const q = makeQueue(h);
    h.net = 'offline';
    await q.enqueue('attendance_self', { projectId: 'proj-1', siteId: 'site-1', checkInTime: '07:00' });
    h.net = 'online';
    h.clock.advance(24 * 60 * MIN_MS);
    await q.flush();
    const e = only(h);
    assert.equal(e.state, 'failed');
    assert.equal(e.failure?.kind, 'stale_day');
    assert.equal(h.server.attendance.length, 0);
  });

  test('[synced] synced entries stay visible for a day, then are pruned', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    await q.enqueue('labour_create', labourPayload());
    await q.flush();
    assert.equal(q.view('user-a').recentlySynced.length, 1);
    assert.ok(q.view('user-a').lastSyncedAt);
    h.clock.advance(SYNCED_RETENTION_MS + 1);
    await q.flush();
    assert.equal(onDisk(h).entries.length, 0);
    assert.ok(onDisk(h).log.some((l) => l.event === 'synced'));
  });

  test('[concurrency] a sync requested while one runs runs once more afterwards; entries are sent once', async () => {
    const h = new Harness();
    const q = makeQueue(h);
    h.net = 'offline';
    await q.enqueue('labour_create', labourPayload({ workerId: 'w1' }));
    h.net = 'online';
    const first = q.flush();
    await q.enqueue('labour_create', labourPayload({ workerId: 'w2' }));
    const second = q.flush({ manual: true });
    const third = q.flush();
    await Promise.all([first, second, third]);
    assert.deepEqual(h.server.labour.map((r) => r.workerId).sort(), ['w1', 'w2']);
    assert.equal(h.server.writeRequests, 2);
  });
});

const MIN_MS = 60_000;

// ─── Error classification (what the screens use to decide to keep an entry) ───

describe('classification', () => {
  const cases: Array<[string, unknown, string, boolean]> = [
    ['no connection', networkError(), 'offline', true],
    ['timeout', timeoutError(), 'timeout', true],
    ['500', httpError(500), 'transient', true],
    ['502 from a proxy', httpError(502), 'transient', true],
    ['408', httpError(408), 'transient', true],
    ['429', httpError(429), 'transient', true],
    ['401', httpError(401), 'auth', true],
    ['400', httpError(400), 'rejected', false],
    ['403', httpError(403), 'rejected', false],
    ['404', httpError(404), 'rejected', false],
    ['422', httpError(422), 'rejected', false],
    ['409', httpError(409, 'exists', 'LABOUR_ENTRY_EXISTS'), 'conflict', false],
    ['plain error without response', new Error('This build has no server address configured'), 'transient', true],
  ];
  for (const [name, err, kind, keep] of cases) {
    test(`[classify] ${name} → ${kind}, keep offline: ${keep}`, () => {
      assert.equal(classifyError(err).kind, kind);
      assert.equal(shouldQueueAfterError(err), keep);
    });
  }

  test('[classify] a 422 message includes the field errors', () => {
    const err = { response: { status: 422, data: { error: 'Validation failed', details: { hoursWorked: ['Number must be less than or equal to 24'] } } } };
    const c = classifyError(err);
    assert.equal(c.kind, 'rejected');
    assert.ok(c.kind === 'rejected' && /hoursWorked: Number must be less/.test(c.message));
  });
});
