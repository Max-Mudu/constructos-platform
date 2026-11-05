/**
 * PDF share / download logic.
 *
 * On Android Chrome, navigator.share({ files }) opens the phone share sheet
 * (WhatsApp, Gmail, …). Where file sharing is not supported we fall back to a
 * normal download. The browser API and the download action are injected so
 * the decision logic is unit tested.
 */

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'retry';

export interface ShareEnv {
  navigator?: {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  } | null;
  download: (blob: Blob, filename: string) => void;
  makeFile?: (blob: Blob, filename: string) => File;
}

const defaultMakeFile = (blob: Blob, filename: string) =>
  new File([blob], filename, { type: 'application/pdf' });

/** True when this browser can share a PDF file through the system share sheet. */
export function canShareFiles(env: Pick<ShareEnv, 'navigator'>, file: File): boolean {
  const nav = env.navigator;
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [file] }) === true;
  } catch {
    return false;
  }
}

/**
 * Shares the PDF, or downloads it when file sharing is unavailable.
 * - user dismissed the share sheet → 'cancelled' (no download)
 * - share refused for lack of a recent tap (NotAllowedError) → 'retry': the
 *   PDF is already fetched, so the next tap shares immediately
 * - any other share failure → download fallback
 */
export async function sharePdf(
  input: { blob: Blob; filename: string; title?: string; text?: string },
  env: ShareEnv,
): Promise<ShareOutcome> {
  const file = (env.makeFile ?? defaultMakeFile)(input.blob, input.filename);
  if (!canShareFiles(env, file)) {
    env.download(input.blob, input.filename);
    return 'downloaded';
  }
  try {
    await env.navigator!.share!({ files: [file], title: input.title, text: input.text });
    return 'shared';
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') return 'retry';
    env.download(input.blob, input.filename);
    return 'downloaded';
  }
}

/** Triggers a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Picks a safe filename from Content-Disposition, else the fallback. */
export function pdfFilename(contentDisposition: string | null | undefined, fallback: string): string {
  const clean = (s: string) => s.replace(/[/\\?%*:|"<>\u0000-\u001f]/g, '').trim();
  if (contentDisposition) {
    const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(contentDisposition);
    if (star) {
      try {
        const v = clean(decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')));
        if (v) return v.toLowerCase().endsWith('.pdf') ? v : `${v}.pdf`;
      } catch { /* fall through */ }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
    if (plain) {
      const v = clean(plain[1]);
      if (v) return v.toLowerCase().endsWith('.pdf') ? v : `${v}.pdf`;
    }
  }
  return clean(fallback) || 'daily-report.pdf';
}

export function fallbackPdfName(displayNumber: string, revision: number): string {
  return `${displayNumber}-rev${revision}.pdf`;
}
