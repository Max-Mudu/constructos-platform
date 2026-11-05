'use client';

/**
 * Report state shared by the capture, review and share screens. Mounted in
 * [reportId]/layout.tsx, so it survives navigation between those screens and
 * pending saves keep running.
 *
 * Every write that carries expectedUpdatedAt goes through one serial queue,
 * so each request uses the updatedAt returned by the previous one. A 409
 * STALE_REPORT is resolved without losing anything the user typed: when the
 * field being saved is unchanged on the server, the save is retried with the
 * fresh updatedAt; otherwise the user chooses (their text stays on screen).
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dailyReportApi, missingFromError } from '@/lib/daily-report-api';
import type { DailyReport, DailyReportPhoto, SectionKey } from '@/lib/daily-report-types';
import { deepEqual, sanitizeContent, sanitizeSection } from './content';
import { clearNotesBackup, readNotesBackup, writeNotesBackup } from './notes-backup';
import { dailyKeys } from './paths';
import { describeError, errorCodeOf, type ErrorView } from './report-errors';
import { applyReviewAction, parseMissingSections, type ReviewAction } from './review-state';
import { resolveStale } from './save-conflict';

export const AUTOSAVE_DELAY_MS = 1500;
const PHOTO_REFRESH_THROTTLE_MS = 15_000;

export type NotesStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

export type ActionResult =
  | { ok: true }
  | { ok: false; error: ErrorView; conflict?: boolean; missing?: SectionKey[] };

interface ReportContextValue {
  projectId: string;
  siteId: string;
  reportId: string;
  report: DailyReport | null;
  loading: boolean;
  loadError: ErrorView | null;
  reload: () => Promise<DailyReport | null>;

  notes: string;
  notesStatus: NotesStatus;
  notesError: ErrorView | null;
  /** Server text when notes conflict with another device. */
  notesConflict: string | null;
  setNotes: (text: string) => void;
  flushNotes: () => Promise<boolean>;
  resolveNotesConflict: (choice: 'mine' | 'theirs') => void;

  /** Number of queued/in-flight writes. */
  pendingWrites: number;
  extracting: boolean;
  extract: () => Promise<ActionResult>;
  review: (action: ReviewAction) => Promise<ActionResult>;
  finalise: () => Promise<ActionResult>;
  reopen: (reason: string) => Promise<ActionResult>;

  addPhoto: (photo: DailyReportPhoto) => void;
  replacePhoto: (photo: DailyReportPhoto) => void;
  removePhoto: (photoId: string) => void;
  refreshPhotos: (force?: boolean) => void;
}

const Ctx = createContext<ReportContextValue | null>(null);

export function useReport(): ReportContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useReport must be used inside ReportProvider');
  return v;
}

const sortPhotos = (p: DailyReportPhoto[]) => [...p].sort((a, b) => a.sortOrder - b.sortOrder);

export function ReportProvider({
  projectId, siteId, reportId, children,
}: {
  projectId: string; siteId: string; reportId: string; children: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ErrorView | null>(null);
  const [notes, setNotesText] = useState('');
  const [notesStatus, setNotesStatus] = useState<NotesStatus>('saved');
  const [notesError, setNotesError] = useState<ErrorView | null>(null);
  const [notesConflict, setNotesConflict] = useState<string | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [extracting, setExtracting] = useState(false);

  const reportRef = useRef<DailyReport | null>(null);
  const notesRef = useRef('');
  const syncedNotesRef = useRef('');
  const conflictRef = useRef<string | null>(null);
  const notesInitRef = useRef(false);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPhotoRefreshRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const apply = useCallback((r: DailyReport) => {
    const next = { ...r, photos: sortPhotos(r.photos ?? []), content: sanitizeContent(r.content) };
    reportRef.current = next;
    if (mountedRef.current) setReport(next);
  }, []);

  const invalidateLists = useCallback(() => {
    void qc.invalidateQueries({ queryKey: dailyKeys.site(projectId, siteId) });
  }, [qc, projectId, siteId]);

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    setPendingWrites((n) => n + 1);
    const run = queueRef.current.then(fn, fn);
    queueRef.current = run.catch(() => undefined);
    return run.finally(() => { if (mountedRef.current) setPendingWrites((n) => Math.max(0, n - 1)); });
  }, []);

  const fetchFresh = useCallback(async (): Promise<DailyReport> => {
    const { report: fresh } = await dailyReportApi.get(projectId, siteId, reportId);
    apply(fresh);
    return reportRef.current as DailyReport;
  }, [apply, projectId, siteId, reportId]);

  /** Sets notes from the server (first load / after reopen), restoring any unsaved local backup. */
  const initNotes = useCallback((r: DailyReport) => {
    const server = r.rawInput ?? '';
    syncedNotesRef.current = server;
    conflictRef.current = null;
    setNotesConflict(null);
    setNotesError(null);
    const editable = r.canEdit && r.status === 'draft' && r.rawInput !== undefined;
    const backup = editable ? readNotesBackup(r.id) : null;
    if (backup && backup.text !== server) {
      const res = resolveStale({ base: backup.base, server, mine: backup.text });
      if (res === 'retry') {
        notesRef.current = backup.text;
        setNotesText(backup.text);
        setNotesStatus('pending');
        return true; // caller schedules the save
      }
      if (res === 'conflict') {
        notesRef.current = backup.text;
        setNotesText(backup.text);
        conflictRef.current = server;
        setNotesConflict(server);
        setNotesStatus('conflict');
        return false;
      }
    }
    if (backup) clearNotesBackup(r.id);
    notesRef.current = server;
    setNotesText(server);
    setNotesStatus('saved');
    return false;
  }, []);

  // ── Notes autosave ────────────────────────────────────────────────────────

  const saveNotesNow = useCallback(async (attempt = 0): Promise<boolean> => {
    const mine = notesRef.current;
    if (conflictRef.current !== null) return false;
    if (mine === syncedNotesRef.current) {
      if (mountedRef.current) setNotesStatus('saved');
      clearNotesBackup(reportId);
      return true;
    }
    const r = reportRef.current;
    if (!r || r.status !== 'draft' || !r.canEdit) return false;
    if (mountedRef.current) { setNotesStatus('saving'); setNotesError(null); }
    try {
      const { report: saved } = await dailyReportApi.update(projectId, siteId, reportId, {
        rawInput: mine, expectedUpdatedAt: r.updatedAt,
      });
      apply(saved);
      syncedNotesRef.current = mine;
      if (notesRef.current === mine) {
        clearNotesBackup(reportId);
        if (mountedRef.current) setNotesStatus('saved');
      } else {
        writeNotesBackup(reportId, notesRef.current, mine);
        if (mountedRef.current) setNotesStatus('pending');
      }
      return true;
    } catch (err) {
      const code = errorCodeOf(err);
      if (code === 'STALE_REPORT' && attempt < 2) {
        try {
          const fresh = await fetchFresh();
          if (fresh.status !== 'draft') {
            if (mountedRef.current) { setNotesStatus('error'); setNotesError(describeError({ code: 'REPORT_FINAL' })); }
            return false;
          }
          const server = fresh.rawInput ?? '';
          const res = resolveStale({ base: syncedNotesRef.current, server, mine });
          if (res === 'noop') {
            syncedNotesRef.current = server;
            return saveNotesNow(attempt + 1); // saves anything typed meanwhile, or marks saved
          }
          if (res === 'retry') return saveNotesNow(attempt + 1);
          conflictRef.current = server;
          writeNotesBackup(reportId, notesRef.current, syncedNotesRef.current);
          if (mountedRef.current) { setNotesConflict(server); setNotesStatus('conflict'); }
          return false;
        } catch (e2) {
          if (mountedRef.current) { setNotesStatus('error'); setNotesError(describeError(e2)); }
          return false;
        }
      }
      if (code === 'REPORT_FINAL') void fetchFresh().catch(() => undefined);
      if (mountedRef.current) { setNotesStatus('error'); setNotesError(describeError(err)); }
      return false;
    }
  }, [apply, fetchFresh, projectId, siteId, reportId]);

  const flushNotes = useCallback(async (): Promise<boolean> => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    if (conflictRef.current !== null) return false;
    const r = reportRef.current;
    if (!r || !r.canEdit || r.status !== 'draft') return true; // nothing the user can save
    if (notesRef.current === syncedNotesRef.current) return true;
    return enqueue(() => saveNotesNow(0));
  }, [enqueue, saveNotesNow]);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void flushNotes();
    }, AUTOSAVE_DELAY_MS);
  }, [flushNotes]);

  const setNotes = useCallback((text: string) => {
    notesRef.current = text;
    setNotesText(text);
    writeNotesBackup(reportId, text, syncedNotesRef.current);
    if (conflictRef.current !== null) return; // paused until the user resolves the conflict
    setNotesStatus(text === syncedNotesRef.current ? 'saved' : 'pending');
    scheduleSave();
  }, [reportId, scheduleSave]);

  const resolveNotesConflict = useCallback((choice: 'mine' | 'theirs') => {
    const server = conflictRef.current;
    if (server === null) return;
    conflictRef.current = null;
    setNotesConflict(null);
    syncedNotesRef.current = server;
    if (choice === 'theirs') {
      notesRef.current = server;
      setNotesText(server);
      clearNotesBackup(reportId);
      setNotesStatus('saved');
      return;
    }
    setNotesStatus('pending');
    void flushNotes();
  }, [flushNotes, reportId]);

  // ── Load ──────────────────────────────────────────────────────────────────

  const reload = useCallback(async (): Promise<DailyReport | null> => {
    try {
      const fresh = await fetchFresh();
      setLoadError(null);
      if (!notesInitRef.current) {
        notesInitRef.current = true;
        if (initNotes(fresh)) scheduleSave();
      }
      return fresh;
    } catch (err) {
      if (!reportRef.current) setLoadError(describeError(err));
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchFresh, initNotes, scheduleSave]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, siteId, reportId]);

  // Save when the phone goes to the background; retry when back online;
  // warn before closing the tab with unsaved notes.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flushNotes(); };
    const onOnline = () => { void flushNotes(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (notesRef.current !== syncedNotesRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flushNotes]);

  // Flush pending notes when leaving the report entirely.
  useEffect(() => () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      if (notesRef.current !== syncedNotesRef.current && conflictRef.current === null) void saveNotesNow(0);
    }
  }, [saveNotesNow]);

  // ── AI extraction ─────────────────────────────────────────────────────────

  const extract = useCallback(async (): Promise<ActionResult> => {
    const saved = await flushNotes();
    if (!saved) {
      return {
        ok: false,
        error: {
          code: 'NOTES_NOT_SAVED',
          title: 'Notes not saved yet',
          message: 'Your notes have not been saved, so the AI cannot read them yet. Check your connection and try again.',
          retryable: true,
          ai: true,
        },
      };
    }
    setExtracting(true);
    try {
      return await enqueue(async () => {
        try {
          const { report: r } = await dailyReportApi.extract(projectId, siteId, reportId);
          apply(r);
          return { ok: true } as const;
        } catch (err) {
          // The server may have recorded extractionStatus=failed; refresh quietly.
          void fetchFresh().catch(() => undefined);
          return { ok: false, error: describeError(err, 'extract') } as const;
        }
      });
    } finally {
      if (mountedRef.current) setExtracting(false);
    }
  }, [apply, enqueue, fetchFresh, flushNotes, projectId, siteId, reportId]);

  // ── Review (content PATCH) ────────────────────────────────────────────────

  const doReview = useCallback(async (action: ReviewAction, attempt: number): Promise<ActionResult> => {
    const r = reportRef.current;
    if (!r) return { ok: false, error: describeError({ code: 'NOT_FOUND' }) };
    const base = r.content;
    const next = applyReviewAction(base, action);
    try {
      const { report: saved } = await dailyReportApi.update(projectId, siteId, reportId, {
        content: sanitizeContent(next), expectedUpdatedAt: r.updatedAt,
      });
      apply(saved);
      return { ok: true };
    } catch (err) {
      const code = errorCodeOf(err);
      if (code === 'STALE_REPORT' && attempt < 2) {
        try {
          const fresh = await fetchFresh();
          if (fresh.status !== 'draft') return { ok: false, error: describeError({ code: 'REPORT_FINAL' }) };
          const s = action.section;
          const untouched = deepEqual(sanitizeSection(s, fresh.content[s]), sanitizeSection(s, base[s]));
          // Someone changed other sections only: re-apply this change on the fresh content.
          if (untouched) return doReview(action, attempt + 1);
          return {
            ok: false,
            conflict: true,
            error: {
              code: 'STALE_REPORT',
              title: 'This section was changed on another device',
              message: 'The latest version is now shown. Save yours to replace it, or keep the other version.',
              retryable: true,
              ai: false,
            },
          };
        } catch (e2) {
          return { ok: false, error: describeError(e2) };
        }
      }
      if (code === 'REPORT_FINAL') void fetchFresh().catch(() => undefined);
      return { ok: false, error: describeError(err) };
    }
  }, [apply, fetchFresh, projectId, siteId, reportId]);

  const review = useCallback(
    (action: ReviewAction) => enqueue(() => doReview(action, 0)),
    [doReview, enqueue],
  );

  // ── Finalise / reopen ─────────────────────────────────────────────────────

  const finalise = useCallback(async (): Promise<ActionResult> => {
    const saved = await flushNotes();
    if (!saved) {
      return {
        ok: false,
        error: {
          code: 'NOTES_NOT_SAVED', title: 'Notes not saved yet',
          message: 'Your latest notes have not been saved. Open "Notes & photos", check the message there, then finalise.',
          retryable: true, ai: false,
        },
      };
    }
    return enqueue(async () => {
      const r = reportRef.current;
      if (!r) return { ok: false, error: describeError({ code: 'NOT_FOUND' }) } as const;
      try {
        const { report: fin } = await dailyReportApi.finalise(projectId, siteId, reportId, r.updatedAt);
        apply(fin);
        clearNotesBackup(reportId);
        invalidateLists();
        return { ok: true } as const;
      } catch (err) {
        const code = errorCodeOf(err);
        if (code === 'REVIEW_INCOMPLETE') {
          void fetchFresh().catch(() => undefined);
          return { ok: false, error: describeError(err), missing: parseMissingSections(missingFromError(err)) } as const;
        }
        if (code === 'STALE_REPORT') {
          await fetchFresh().catch(() => undefined);
          return {
            ok: false,
            error: {
              code, title: 'Report changed on another device',
              message: 'The latest version has been loaded. Check it, then finalise again.',
              retryable: true, ai: false,
            },
          } as const;
        }
        if (code === 'REPORT_FINAL') { await fetchFresh().catch(() => undefined); invalidateLists(); }
        return { ok: false, error: describeError(err) } as const;
      }
    });
  }, [apply, enqueue, fetchFresh, flushNotes, invalidateLists, projectId, siteId, reportId]);

  const reopen = useCallback((reason: string): Promise<ActionResult> => enqueue(async () => {
    const r = reportRef.current;
    if (!r) return { ok: false, error: describeError({ code: 'NOT_FOUND' }) } as const;
    try {
      const { report: opened } = await dailyReportApi.reopen(projectId, siteId, reportId, reason, r.updatedAt);
      apply(opened);
      initNotes(reportRef.current as DailyReport);
      invalidateLists();
      return { ok: true } as const;
    } catch (err) {
      const code = errorCodeOf(err);
      if (code === 'STALE_REPORT' || code === 'REPORT_NOT_FINAL') await fetchFresh().catch(() => undefined);
      return { ok: false, error: describeError(err) } as const;
    }
  }), [apply, enqueue, fetchFresh, initNotes, invalidateLists, projectId, siteId, reportId]);

  // ── Photos ────────────────────────────────────────────────────────────────

  const mutatePhotos = useCallback((fn: (p: DailyReportPhoto[]) => DailyReportPhoto[]) => {
    const r = reportRef.current;
    if (!r) return;
    const photos = sortPhotos(fn(r.photos));
    apply({ ...r, photos, photoCount: photos.length });
  }, [apply]);

  const addPhoto = useCallback((photo: DailyReportPhoto) => {
    mutatePhotos((p) => [...p.filter((x) => x.id !== photo.id), photo]);
    invalidateLists();
  }, [invalidateLists, mutatePhotos]);
  const replacePhoto = useCallback((photo: DailyReportPhoto) => {
    mutatePhotos((p) => p.map((x) => (x.id === photo.id ? photo : x)));
  }, [mutatePhotos]);
  const removePhoto = useCallback((photoId: string) => {
    mutatePhotos((p) => p.filter((x) => x.id !== photoId));
    invalidateLists();
  }, [invalidateLists, mutatePhotos]);

  /** Re-fetches signed photo URLs (they expire after ~5 min). Merges photos only. */
  const refreshPhotos = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastPhotoRefreshRef.current < PHOTO_REFRESH_THROTTLE_MS) return;
    lastPhotoRefreshRef.current = now;
    void dailyReportApi.get(projectId, siteId, reportId).then(({ report: fresh }) => {
      const r = reportRef.current;
      if (!r) return;
      const photos = sortPhotos(fresh.photos ?? []);
      apply({ ...r, photos, photoCount: photos.length });
    }).catch(() => undefined);
  }, [apply, projectId, siteId, reportId]);

  // Refresh signed URLs shortly before the earliest one expires.
  useEffect(() => {
    if (!report || report.photos.length === 0) return;
    const times = report.photos.map((p) => Date.parse(p.urlExpiresAt)).filter((t) => Number.isFinite(t));
    if (times.length === 0) return;
    const delay = Math.max(5_000, Math.min(...times) - Date.now() - 45_000);
    const t = setTimeout(() => refreshPhotos(true), delay);
    return () => clearTimeout(t);
  }, [report, refreshPhotos]);

  const value = useMemo<ReportContextValue>(() => ({
    projectId, siteId, reportId, report, loading, loadError, reload,
    notes, notesStatus, notesError, notesConflict, setNotes, flushNotes, resolveNotesConflict,
    pendingWrites, extracting, extract, review, finalise, reopen,
    addPhoto, replacePhoto, removePhoto, refreshPhotos,
  }), [
    projectId, siteId, reportId, report, loading, loadError, reload,
    notes, notesStatus, notesError, notesConflict, setNotes, flushNotes, resolveNotesConflict,
    pendingWrites, extracting, extract, review, finalise, reopen,
    addPhoto, replacePhoto, removePhoto, refreshPhotos,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
