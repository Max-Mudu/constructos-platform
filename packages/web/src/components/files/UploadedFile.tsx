'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { describeFileError, fetchUploadedFile, type FetchUploadedFileDeps } from '@/lib/workflows-files';
import { cn } from '@/lib/utils';

/**
 * authApi.me() goes through the shared API client, which refreshes the
 * session on 401 and stores the new access token.
 */
const deps: FetchUploadedFileDeps = {
  getToken: () => useAuthStore.getState().accessToken,
  refresh: () => authApi.me().then(() => true, () => false),
};

/** Thumbnail of an uploaded image, loaded with the user's access token. */
export function UploadedImage({
  fileUrl, alt, mimeType, className,
}: { fileUrl: string; alt: string; mimeType?: string | null; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);
    fetchUploadedFile(fileUrl, deps, mimeType)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl, mimeType]);

  if (failed) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground', className)}>
        <ImageOff className="h-5 w-5" />
        Preview unavailable
      </div>
    );
  }
  if (!src) return <div className={cn('animate-pulse bg-muted', className)} aria-label="Loading image" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

/**
 * Button that downloads an uploaded file with the user's access token and
 * saves it under its original name. Errors are shown inline.
 */
export function UploadedFileLink({
  fileUrl, fileName, mimeType, className, children,
}: {
  fileUrl: string;
  fileName: string;
  mimeType?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const blob = await fetchUploadedFile(fileUrl, deps, mimeType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(describeFileError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        aria-busy={busy}
        className={cn('text-left disabled:opacity-60', className)}
      >
        {children}
      </button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
