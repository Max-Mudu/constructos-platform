/**
 * Offline queue on the device: binds the rules in ./offlineQueueCore (see the
 * comment there) to expo-file-system, the API and the signed-in user.
 *
 * Queued: a labour entry, a supervisor's attendance record and a worker's own
 * check-in whose save could not reach the server. Sent automatically at app
 * start once the session is restored, when the app returns to the
 * foreground, every RETRY_INTERVAL_MS while something is waiting, and on a
 * tap (src/components/OfflineSyncRunner.tsx, OfflineSyncPanel.tsx).
 */
import * as FileSystem from 'expo-file-system/legacy';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth.store';
import { apiClient, QueuedRequestConfig } from '../api/client';
import { API_ORIGIN } from '../constants/api';
import { AttendanceRecord, LabourEntry } from '../types';
import {
  OfflineQueue, QueueEntry, QueueTransport, ServerRecord, createFileStorage,
} from './offlineQueueCore';

export type { OfflineOpType, QueueEntry, EnqueueResult, FlushReport } from './offlineQueueCore';
export { shouldQueueAfterError, describeEntry, enqueueOutcome } from './offlineQueueCore';

/** Same file as earlier app versions, so their entries are migrated, not lost. */
const QUEUE_FILE = (FileSystem.documentDirectory ?? '') + 'offline_queue.json';

/** How often an automatic sync runs while something is waiting and the app is open. */
export const RETRY_INTERVAL_MS = 30_000;

const HEALTH_TIMEOUT_MS = 5000;

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

// Every request carries the entry's owner; the HTTP client refuses to send it
// with anyone else's session (src/api/client.ts). Same endpoints and bodies
// as src/api/labour.ts and src/api/attendance.ts.
function owned(entry: QueueEntry, extra: AxiosRequestConfig = {}): AxiosRequestConfig & QueuedRequestConfig {
  return { ...extra, queuedForUserId: entry.userId ?? '' };
}

const transport: QueueTransport = {
  async send(entry: QueueEntry) {
    const p = entry.payload;
    switch (entry.type) {
      case 'labour_create': {
        const { projectId, siteId, ...body } = (p['data'] ?? {}) as Record<string, unknown>;
        const res = await apiClient.post<{ entry: LabourEntry }>(
          `/projects/${str(projectId)}/sites/${str(siteId)}/labour`, body, owned(entry));
        return { serverId: res.data?.entry?.id };
      }
      case 'attendance_create': {
        const res = await apiClient.post<{ record: AttendanceRecord }>(
          `/projects/${str(p['projectId'])}/sites/${str(p['siteId'])}/attendance`, p['data'], owned(entry));
        return { serverId: res.data?.record?.id };
      }
      case 'attendance_self': {
        const res = await apiClient.post<{ record: AttendanceRecord }>(
          `/projects/${str(p['projectId'])}/sites/${str(p['siteId'])}/attendance/self`,
          p['checkInTime'] ? { checkInTime: str(p['checkInTime']) } : {}, owned(entry));
        return { serverId: res.data?.record?.id };
      }
    }
  },

  // The site's list filtered by date and worker: the same data the Labour and
  // Attendance screens show, under the same access rules.
  async findExisting(entry: QueueEntry): Promise<ServerRecord | null> {
    const p = entry.payload;
    const d = (p['data'] ?? {}) as Record<string, unknown>;
    if (entry.type === 'labour_create') {
      const res = await apiClient.get<{ entries: LabourEntry[] }>(
        `/projects/${str(d['projectId'])}/sites/${str(d['siteId'])}/labour`,
        owned(entry, { params: { date: d['date'], workerId: d['workerId'] } }),
      );
      const e = res.data.entries.find((x) => x.workerId === d['workerId'] && str(x.date).slice(0, 10) === d['date']);
      return e
        ? { id: e.id, recordedById: e.registeredById ?? null, fields: { ...e } as Record<string, unknown> }
        : null;
    }
    if (entry.type === 'attendance_create') {
      const res = await apiClient.get<{ records: AttendanceRecord[] }>(
        `/projects/${str(p['projectId'])}/sites/${str(p['siteId'])}/attendance`,
        owned(entry, { params: { date: d['date'], workerId: d['workerId'] } }),
      );
      const r = res.data.records.find((x) => x.workerId === d['workerId'] && str(x.date).slice(0, 10) === d['date']);
      return r
        ? { id: r.id, recordedById: r.recordedById ?? null, fields: { ...r } as Record<string, unknown> }
        : null;
    }
    return null;
  },

  // Any HTTP answer (even 503) means the server is reachable.
  async isServerReachable() {
    try {
      await axios.get(`${API_ORIGIN}/health`, { timeout: HEALTH_TIMEOUT_MS });
      return true;
    } catch (err) {
      return (err as AxiosError).response !== undefined;
    }
  },
};

export const offlineQueue = new OfflineQueue({
  storage: createFileStorage({
    exists: async (path) => (await FileSystem.getInfoAsync(path)).exists,
    read:   (path) => FileSystem.readAsStringAsync(path),
    write:  (path, contents) => FileSystem.writeAsStringAsync(path, contents),
    move:   (from, to) => FileSystem.moveAsync({ from, to }),
  }, QUEUE_FILE, Date.now),
  transport,
  now: Date.now,
  currentUserId: () => useAuthStore.getState().user?.id ?? null,
  warn: (message) => console.warn(message),
});
