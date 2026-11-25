/**
 * End-to-end queue scenarios written only against the Driver below, so the
 * same scenarios can be run against any queue implementation. The test file
 * runs them against the current queue; a separate check ran them against the
 * queue code that shipped before this change, where the scenarios marked
 * `key` fail (that code dropped entries in each of those situations).
 *
 * The rule every scenario checks: an entry the app accepted is either on the
 * server (once, with what was entered) or still on the phone. Never neither.
 */
import assert from 'node:assert/strict';
import { QUEUE_PATH, attendancePayload, labourPayload } from './offlineQueue.harness.ts';
import type { Harness, OpKind } from './offlineQueue.harness.ts';

export interface DriverEntry {
  type: string;
  payload: Record<string, unknown>;
  userId: string | null;
}

export interface Driver {
  /** The screen's "save failed, keep it offline" path. 'refused' = the user was told it was not kept. */
  enqueue(kind: OpKind, payload: Record<string, unknown>): Promise<'accepted' | 'refused'>;
  /** An automatic sync (app start, foreground, timer). */
  flush(): Promise<void>;
  /** The app process is restarted (state is re-read from the file). */
  restart(): Promise<void>;
  /** Entries in the queue file not yet confirmed on the server (pending or failed), any user. */
  unsynced(): Promise<DriverEntry[]>;
}

export interface Scenario {
  name: string;
  /** Expected to fail against the pre-change queue code. */
  key: boolean;
  run(h: Harness, d: Driver): Promise<void>;
}

const MIN = 60_000;

async function flushTimes(h: Harness, d: Driver, n: number, gapMs = 20 * MIN): Promise<void> {
  for (let i = 0; i < n; i++) {
    h.clock.advance(gapMs);
    await d.flush();
  }
}

export const scenarios: Scenario[] = [
  {
    name: '[offline-count] ten automatic syncs with no signal keep the entry; it is sent once the signal returns',
    key: true,
    async run(h, d) {
      h.net = 'offline';
      assert.equal(await d.enqueue('labour_create', labourPayload()), 'accepted');
      await flushTimes(h, d, 10);
      assert.equal((await d.unsynced()).length, 1, 'entry still on the phone after 10 offline syncs');
      h.net = 'online';
      await flushTimes(h, d, 1);
      assert.equal(h.server.labour.length, 1);
      assert.equal((await d.unsynced()).length, 0);
    },
  },
  {
    name: '[outcome:timeout] timeouts while the server is unreachable never use up the entry',
    key: true,
    async run(h, d) {
      h.net = 'timeout-unreachable';
      await d.enqueue('labour_create', labourPayload());
      await flushTimes(h, d, 10);
      assert.equal((await d.unsynced()).length, 1);
      h.net = 'online';
      await flushTimes(h, d, 1);
      assert.equal(h.server.labour.length, 1);
    },
  },
  {
    name: '[outcome:4xx] an entry the server refuses (422) stays on the phone for the user to see',
    key: true,
    async run(h, d) {
      await d.enqueue('labour_create', labourPayload());
      h.server.failNextWrites(422, 1, 'Validation failed');
      await flushTimes(h, d, 1);
      const left = await d.unsynced();
      assert.equal(left.length, 1, 'refused entry is kept (as failed), not deleted');
      assert.equal(h.server.labour.length, 0);
    },
  },
  {
    name: '[outcome:5xx] seven server errors in a row: the entry is kept, not dropped after five',
    key: true,
    async run(h, d) {
      await d.enqueue('labour_create', labourPayload());
      h.server.failNextWrites(500, 7);
      await flushTimes(h, d, 7);
      assert.equal((await d.unsynced()).length, 1);
      assert.equal(h.server.labour.length, 0);
    },
  },
  {
    name: '[outcome:409-other] another supervisor already recorded the worker that day: the queued entry is kept, not silently dropped',
    key: true,
    async run(h, d) {
      h.server.labour.push({
        id: 'srv-other', projectId: 'proj-1', siteId: 'site-1', workerId: 'worker-1', date: '2026-11-24',
        hoursWorked: 4, notes: null, registeredById: 'user-b',
      });
      await d.enqueue('labour_create', labourPayload({ hoursWorked: 8 }));
      await flushTimes(h, d, 3);
      assert.equal(h.server.labour.length, 1);
      assert.equal(h.server.labour[0]!.hoursWorked, 4, 'the other entry is not overwritten');
      assert.equal((await d.unsynced()).length, 1, 'the queued entry is still there for the user to decide');
    },
  },
  {
    name: '[user-binding] an entry saved by an app version that did not record the user is never sent under whoever signs in next',
    key: true,
    async run(h, d) {
      h.fs.files.set(QUEUE_PATH, JSON.stringify([{
        id: 'legacy-1', type: 'labour_create', payload: labourPayload(), createdAt: '2026-11-23T08:00:00.000Z', retryCount: 1,
      }]));
      h.signIn('user-b');
      await d.restart();
      await flushTimes(h, d, 3);
      assert.equal(h.server.labour.length, 0, 'not sent under user-b');
      assert.equal((await d.unsynced()).length, 1, 'still kept on the phone');
    },
  },
  {
    name: '[dedup] saving a different entry for the same worker and day while the first waits never loses one silently',
    key: true,
    async run(h, d) {
      h.net = 'offline';
      const first = await d.enqueue('labour_create', labourPayload({ hoursWorked: 8 }));
      const second = await d.enqueue('labour_create', labourPayload({ hoursWorked: 6 }));
      assert.equal(first, 'accepted');
      h.net = 'online';
      await flushTimes(h, d, 3);
      assert.equal(h.server.labour.length, 1);
      const left = await d.unsynced();
      if (second === 'accepted') {
        // Accepted means kept: it must be on the server or still on the phone.
        const onServer = h.server.labour.some((r) => r.hoursWorked === 6);
        assert.ok(onServer || left.length === 1, 'the accepted 6h entry vanished');
      }
    },
  },
  {
    name: '[user-binding] user A\'s entry is never sent while user B is signed in, and is sent once A signs in again',
    key: false,
    async run(h, d) {
      h.signIn('user-a');
      h.net = 'offline';
      await d.enqueue('labour_create', labourPayload());
      h.net = 'online';
      h.signOut();
      h.signIn('user-b');
      await flushTimes(h, d, 3);
      assert.equal(h.server.labour.length, 0);
      assert.ok(h.sentBy.every((s) => s.userId !== 'user-b'));
      h.signIn('user-a');
      await flushTimes(h, d, 1);
      assert.equal(h.server.labour.length, 1);
      assert.equal(h.server.labour[0]!.registeredById, 'user-a');
    },
  },
  {
    name: '[outcome:401] the session ends during a sync: the entry waits and is sent after the same user signs in',
    key: false,
    async run(h, d) {
      await d.enqueue('labour_create', labourPayload());
      h.sessionEnds = true;
      await flushTimes(h, d, 1);
      assert.equal((await d.unsynced()).length, 1);
      h.signIn('user-a');
      await flushTimes(h, d, 1);
      assert.equal(h.server.labour.length, 1);
      assert.equal((await d.unsynced()).length, 0);
    },
  },
  {
    name: '[outcome:409-own] the answer to a save is lost; the resend finds it already saved: one row, nothing left',
    key: false,
    async run(h, d) {
      await d.enqueue('labour_create', labourPayload({ notes: 'night shift' }));
      h.loseNextAnswer('drop-after-commit');
      await flushTimes(h, d, 1);
      await flushTimes(h, d, 1);
      assert.equal(h.server.labour.length, 1);
      assert.equal((await d.unsynced()).length, 0);
    },
  },
  {
    name: '[restart] the app is killed after the server saved the entry but before the phone recorded it: one row after restart',
    key: false,
    async run(h, d) {
      await d.enqueue('attendance_create', attendancePayload({ checkInTime: '07:45' }));
      h.server.onCommit = () => { h.server.onCommit = null; h.fs.killOnNextWrite(); };
      try { await d.flush(); } catch { /* the process died */ }
      await d.restart();
      await flushTimes(h, d, 2);
      assert.equal(h.server.attendance.length, 1);
      assert.equal((await d.unsynced()).length, 0);
    },
  },
  {
    name: '[migration] an entry queued by the previous app version (with its user) is sent after the update',
    key: false,
    async run(h, d) {
      h.fs.files.set(QUEUE_PATH, JSON.stringify([{
        id: 'old-1', type: 'labour_create', payload: labourPayload({ workerId: 'worker-9' }),
        createdAt: '2026-11-23T08:00:00.000Z', retryCount: 4, userId: 'user-a',
      }]));
      h.signIn('user-a');
      await d.restart();
      await flushTimes(h, d, 1);
      assert.equal(h.server.labour.length, 1);
      assert.equal(h.server.labour[0]!.workerId, 'worker-9');
      assert.equal((await d.unsynced()).length, 0);
    },
  },
  {
    name: '[outcome:success] entries saved offline are sent in order once online',
    key: false,
    async run(h, d) {
      h.net = 'offline';
      await d.enqueue('labour_create', labourPayload({ workerId: 'w1' }));
      await d.enqueue('labour_create', labourPayload({ workerId: 'w2' }));
      await d.enqueue('attendance_create', attendancePayload({ workerId: 'w1' }));
      h.net = 'online';
      await flushTimes(h, d, 1);
      assert.deepEqual(h.server.labour.map((r) => r.workerId), ['w1', 'w2']);
      assert.equal(h.server.attendance.length, 1);
      assert.equal((await d.unsynced()).length, 0);
    },
  },
];
