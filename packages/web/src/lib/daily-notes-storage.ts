/**
 * localStorage prefix for unsaved Daily Report notes. Kept dependency-free so
 * the auth store can clear backups on logout without importing UI modules.
 */
export const DAILY_NOTES_PREFIX = 'constructos_daily_notes_';

/** Removes every unsaved-notes backup on this device (logout / session expiry). */
export function clearAllDailyNotesBackups(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(DAILY_NOTES_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
}
