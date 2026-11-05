/**
 * Local backup of unsaved notes, so a dropped connection or a closed tab
 * never loses what the supervisor typed. `base` is the server rawInput the
 * text was typed against; on reload resolveStale() decides whether to
 * restore it silently, or ask.
 */
import { useAuthStore } from '@/store/auth.store';
import { DAILY_NOTES_PREFIX } from '@/lib/daily-notes-storage';

export interface NotesBackup {
  text: string;
  base: string;
  at: number;
}

// Backups are per user, so on a shared phone one person's unsaved notes are
// never restored into another person's report. All are cleared on logout.
const key = (reportId: string): string | null => {
  const userId = useAuthStore.getState().user?.id;
  return userId ? `${DAILY_NOTES_PREFIX}${userId}_${reportId}` : null;
};
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function readNotesBackup(reportId: string, now: number = Date.now()): NotesBackup | null {
  try {
    const k = key(reportId);
    if (!k) return null;
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<NotesBackup>;
    if (typeof v.text !== 'string' || typeof v.base !== 'string' || typeof v.at !== 'number') return null;
    if (now - v.at > MAX_AGE_MS) {
      localStorage.removeItem(k);
      return null;
    }
    return { text: v.text, base: v.base, at: v.at };
  } catch {
    return null;
  }
}

export function writeNotesBackup(reportId: string, text: string, base: string): void {
  try {
    const k = key(reportId);
    if (k) localStorage.setItem(k, JSON.stringify({ text, base, at: Date.now() }));
  } catch { /* quota / private mode */ }
}

export function clearNotesBackup(reportId: string): void {
  try {
    const k = key(reportId);
    if (k) localStorage.removeItem(k);
  } catch { /* ignore */ }
}
