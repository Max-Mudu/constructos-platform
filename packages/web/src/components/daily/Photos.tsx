'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { Camera, ImageOff, Images, RotateCw, Trash2, X } from 'lucide-react';
import { dailyReportApi } from '@/lib/daily-report-api';
import { LIMITS, type DailyReportPhoto } from '@/lib/daily-report-types';
import { isAcceptedPhoto, resizeImageFile } from '@/lib/image-resize';
import { cn } from '@/lib/utils';
import { useReport } from './ReportContext';
import { describeError } from './report-errors';
import { nextQueued, photoSlotsLeft, uploadReducer, type UploadItem } from './upload-queue';
import { DButton, DCard, Notice, TextInput } from './ui';

let seq = 0;
const newId = () => `up-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// ─── Pending upload tile ─────────────────────────────────────────────────────

function PendingTile({ item, onRetry, onDismiss }: { item: UploadItem; onRetry: () => void; onDismiss: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!isAcceptedPhoto(item.file)) return;
    const url = URL.createObjectURL(item.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file]);

  const label =
    item.status === 'queued' ? 'Waiting…'
      : item.status === 'resizing' ? 'Preparing…'
        : item.status === 'uploading' ? `Uploading ${Math.round(item.progress * 100)}%`
          : 'Upload failed';

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-[4/3] bg-background">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className={cn('h-full w-full object-cover', item.status !== 'failed' && 'opacity-60')} />
        ) : (
          <div className="flex h-full items-center justify-center"><ImageOff className="h-6 w-6 text-[hsl(var(--text-tertiary))]" aria-hidden /></div>
        )}
        {item.status !== 'failed' && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-border/80">
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${item.status === 'uploading' ? Math.max(4, item.progress * 100) : 4}%` }}
            />
          </div>
        )}
      </div>
      <div className="space-y-2 p-2.5">
        <p className={cn('text-sm font-medium', item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')} aria-live="polite">
          {label}
        </p>
        {item.status === 'failed' && (
          <>
            {item.error && <p className="text-xs text-muted-foreground">{item.error}</p>}
            <div className="flex gap-2">
              {item.retryable && (
                <DButton size="sm" variant="secondary" className="flex-1" onClick={onRetry}>
                  <RotateCw className="h-4 w-4" aria-hidden /> Retry
                </DButton>
              )}
              <DButton size="sm" variant="ghost" aria-label="Remove" onClick={onDismiss}>
                <X className="h-4 w-4" aria-hidden />
              </DButton>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

// ─── Uploaded photo tile ─────────────────────────────────────────────────────

function PhotoTile({ photo, editable }: { photo: DailyReportPhoto; editable: boolean }) {
  const { projectId, siteId, reportId, replacePhoto, removePhoto, refreshPhotos } = useReport();
  const [caption, setCaption] = useState(photo.caption);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => { setCaption(photo.caption); }, [photo.caption]);
  useEffect(() => { setBroken(false); }, [photo.url]);

  async function saveCaption() {
    const next = caption.trim().slice(0, LIMITS.caption);
    if (next === photo.caption) return;
    setSaving(true);
    setError(null);
    try {
      const { photo: saved } = await dailyReportApi.updatePhoto(projectId, siteId, reportId, photo.id, { caption: next });
      replacePhoto(saved);
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    setDeleting(true);
    setError(null);
    try {
      await dailyReportApi.deletePhoto(projectId, siteId, reportId, photo.id);
      removePhoto(photo.id);
    } catch (err) {
      setError(describeError(err).message);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card">
      <a
        href={broken ? undefined : photo.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block aspect-[4/3] bg-background"
        aria-label={photo.caption ? `Open photo: ${photo.caption}` : 'Open photo'}
      >
        {broken ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-[hsl(var(--text-tertiary))]">
            <ImageOff className="h-6 w-6" aria-hidden /> Refreshing…
          </div>
        ) : (
          // Signed, short-lived URL (no bearer needed); refreshed before expiry.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt={photo.caption || 'Site photo'}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => { setBroken(true); refreshPhotos(); }}
          />
        )}
      </a>
      <div className="space-y-2 p-2.5">
        {editable ? (
          <>
            <label className="sr-only" htmlFor={`cap-${photo.id}`}>Caption</label>
            <TextInput
              id={`cap-${photo.id}`}
              value={caption}
              maxLength={LIMITS.caption}
              placeholder="Add a caption"
              onChange={(e) => setCaption(e.target.value)}
              onBlur={() => void saveCaption()}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="text-sm"
            />
            {saving && <p className="text-xs text-[hsl(var(--text-tertiary))]">Saving caption…</p>}
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            {confirmDelete ? (
              <div className="flex gap-2">
                <DButton size="sm" variant="danger" className="flex-1" loading={deleting} onClick={() => void doDelete()}>
                  Delete photo
                </DButton>
                <DButton size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Keep</DButton>
              </div>
            ) : (
              <DButton size="sm" variant="ghost" className="w-full justify-start text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </DButton>
            )}
          </>
        ) : (
          photo.caption && <p className="text-sm text-muted-foreground">{photo.caption}</p>
        )}
      </div>
    </li>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

export function PhotoGrid({ photos, editable }: { photos: DailyReportPhoto[]; editable: boolean }) {
  if (photos.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((p) => <PhotoTile key={p.id} photo={p} editable={editable} />)}
    </ul>
  );
}

/** Add photos (camera or gallery), resize to ≤1600 px JPEG, upload one at a time. */
export function PhotoSection() {
  const { report, projectId, siteId, reportId, addPhoto } = useReport();
  const [queue, dispatch] = useReducer(uploadReducer, []);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const photos = report?.photos ?? [];
  const editable = !!report && report.status === 'draft' && report.canEdit;
  const slots = photoSlotsLeft(photos.length, queue.length);

  // Sequential worker: one photo at a time.
  useEffect(() => {
    const item = nextQueued(queue);
    if (!item || busyRef.current) return;
    busyRef.current = true;
    void (async () => {
      dispatch({ type: 'start', id: item.id });
      try {
        if (!isAcceptedPhoto(item.file)) {
          dispatch({ type: 'fail', id: item.id, error: describeError({ code: 'UNSUPPORTED_FILE' }).message, retryable: false });
          return;
        }
        let upload: File;
        try {
          upload = (await resizeImageFile(item.file)).file;
        } catch {
          // Could not decode/resize (old browser, odd file): send the original if it is small enough.
          if (item.file.size > LIMITS.photoBytes) {
            dispatch({ type: 'fail', id: item.id, error: describeError({ code: 'FILE_TOO_LARGE' }).message, retryable: false });
            return;
          }
          upload = item.file;
        }
        if (upload.size > LIMITS.photoBytes) {
          dispatch({ type: 'fail', id: item.id, error: describeError({ code: 'FILE_TOO_LARGE' }).message, retryable: false });
          return;
        }
        dispatch({ type: 'resized', id: item.id });
        const { photo } = await dailyReportApi.uploadPhoto(projectId, siteId, reportId, upload, (f) =>
          dispatch({ type: 'progress', id: item.id, progress: f }));
        addPhoto(photo);
        dispatch({ type: 'done', id: item.id });
      } catch (err) {
        const v = describeError(err);
        const permanent = ['REPORT_FINAL', 'FORBIDDEN', 'NOT_FOUND', 'UNSUPPORTED_FILE', 'FILE_TOO_LARGE', 'VALIDATION_ERROR', 'UNAUTHORIZED'];
        dispatch({ type: 'fail', id: item.id, error: v.message, retryable: !permanent.includes(v.code) });
      } finally {
        busyRef.current = false;
      }
    })();
  }, [queue, projectId, siteId, reportId, addPhoto]);

  function onFiles(input: HTMLInputElement) {
    setNotice(null);
    const files = Array.from(input.files ?? []);
    input.value = ''; // allow picking the same photo again after a failure
    if (files.length === 0) return;
    const accepted = files.slice(0, slots);
    if (files.length > accepted.length) {
      setNotice(
        accepted.length === 0
          ? `This report already has the maximum of ${LIMITS.photosPerReport} photos.`
          : `Only ${accepted.length} more photo${accepted.length === 1 ? '' : 's'} can be added (limit ${LIMITS.photosPerReport}).`,
      );
    }
    if (accepted.length) dispatch({ type: 'add', items: accepted.map((file) => ({ id: newId(), file })) });
  }

  return (
    <DCard className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Photos</h2>
        <span className="text-xs text-[hsl(var(--text-tertiary))]">{photos.length} / {LIMITS.photosPerReport}</span>
      </div>

      {editable && (
        <>
          {/* capture="environment" opens the rear camera directly on Android;
              the second input (no capture) lets the user pick from the gallery. */}
          <input
            ref={inputRef}
            id="dr-photo-camera"
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            multiple
            className="sr-only"
            onChange={(e) => onFiles(e.target)}
            disabled={slots === 0}
          />
          <input
            id="dr-photo-gallery"
            type="file"
            accept="image/jpeg,image/png"
            multiple
            className="sr-only"
            onChange={(e) => onFiles(e.target)}
            disabled={slots === 0}
          />
          <div className="grid grid-cols-2 gap-2">
            <label
              htmlFor="dr-photo-camera"
              className={cn(
                'flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-accent/60 px-3 text-[15px] font-semibold text-accent-foreground transition-colors hover:bg-accent',
                slots === 0 && 'pointer-events-none opacity-50',
              )}
            >
              <Camera className="h-5 w-5" aria-hidden />
              Take photo
            </label>
            <label
              htmlFor="dr-photo-gallery"
              className={cn(
                'flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-[15px] font-semibold text-foreground transition-colors hover:bg-accent',
                slots === 0 && 'pointer-events-none opacity-50',
              )}
            >
              <Images className="h-5 w-5" aria-hidden />
              From gallery
            </label>
          </div>
          <p className="text-xs text-[hsl(var(--text-tertiary))]">
            Photos are made smaller before upload to save data, and sent one at a time.
          </p>
        </>
      )}

      {notice && <Notice tone="warning" live>{notice}</Notice>}

      {queue.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Uploads in progress">
          {queue.map((item) => (
            <PendingTile
              key={item.id}
              item={item}
              onRetry={() => dispatch({ type: 'retry', id: item.id })}
              onDismiss={() => dispatch({ type: 'dismiss', id: item.id })}
            />
          ))}
        </ul>
      )}

      <PhotoGrid photos={photos} editable={editable} />

      {!editable && photos.length === 0 && <p className="text-sm text-muted-foreground">No photos.</p>}
    </DCard>
  );
}
