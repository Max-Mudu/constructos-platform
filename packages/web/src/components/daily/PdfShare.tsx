'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, History, RotateCcw, Share2 } from 'lucide-react';
import { dailyReportApi } from '@/lib/daily-report-api';
import { LIMITS, type DailyReport } from '@/lib/daily-report-types';
import { formatReportDate, formatTimestamp, personName } from './dates';
import { dailyPaths } from './paths';
import { useReport } from './ReportContext';
import { describeError, type ErrorView } from './report-errors';
import { canShareFiles, downloadBlob, fallbackPdfName, pdfFilename, sharePdf } from './share';
import { Chip, DButton, DCard, Dialog, FieldLabel, Notice, TextArea } from './ui';

interface CachedPdf { blob: Blob; filename: string }

/** The revision a default PDF request returns: the current one when final, else the last finalised. */
export function latestFinalRevision(report: Pick<DailyReport, 'status' | 'revision' | 'revisions'>): number | null {
  if (report.status === 'final') return report.revision;
  const revs = report.revisions.map((r) => r.revision);
  return revs.length ? Math.max(...revs) : null;
}

function usePdf(report: DailyReport) {
  const { projectId, siteId, reportId } = useReport();
  const cache = useRef(new Map<number, CachedPdf>());
  const latest = latestFinalRevision(report);

  // A new finalisation invalidates nothing old (revisions are immutable), but the
  // "latest" pointer moves; cache entries are keyed by revision number.
  const get = useCallback(async (revision: number): Promise<CachedPdf> => {
    const hit = cache.current.get(revision);
    if (hit) return hit;
    const { blob, contentDisposition } = await dailyReportApi.pdf(projectId, siteId, reportId, revision);
    const filename = pdfFilename(contentDisposition, fallbackPdfName(report.displayNumber, revision));
    const entry = { blob, filename };
    cache.current.set(revision, entry);
    return entry;
  }, [projectId, siteId, reportId, report.displayNumber]);

  return { latest, get };
}

export function PdfShareActions({ report }: { report: DailyReport }) {
  const { latest, get } = usePdf(report);
  const [busy, setBusy] = useState<'share' | 'download' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'info' | 'danger'; text: string } | null>(null);
  const [shareable, setShareable] = useState(false);

  useEffect(() => {
    try {
      const probe = new File([new Blob(['%PDF-1.4'], { type: 'application/pdf' })], 'probe.pdf', { type: 'application/pdf' });
      setShareable(canShareFiles({ navigator: typeof navigator === 'undefined' ? null : navigator }, probe));
    } catch {
      setShareable(false);
    }
  }, []);

  // Fetch the PDF ahead of time so tapping Share opens the share sheet straight
  // away (browsers only allow share() shortly after a tap).
  useEffect(() => {
    if (latest !== null && shareable) void get(latest).catch(() => undefined);
  }, [latest, shareable, get]);

  if (latest === null) {
    return (
      <Notice tone="info" title="No PDF yet">
        A PDF is created when the report is finalised.
      </Notice>
    );
  }

  const title = `${report.displayNumber} — ${report.site.name} — ${formatReportDate(report.reportDate)}`;

  async function onShare() {
    setBusy('share');
    setMessage(null);
    try {
      const pdf = await get(latest as number);
      const outcome = await sharePdf(
        { blob: pdf.blob, filename: pdf.filename, title, text: `Daily site report ${title}` },
        { navigator, download: downloadBlob },
      );
      if (outcome === 'downloaded') setMessage({ tone: 'info', text: 'Sharing is not available here, so the PDF was downloaded. Send it from your Downloads.' });
      if (outcome === 'retry') setMessage({ tone: 'info', text: 'The PDF is ready. Tap Share again to open the share sheet.' });
      if (outcome === 'shared') setMessage({ tone: 'success', text: 'Shared.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: describeError(err).message });
    } finally {
      setBusy(null);
    }
  }

  async function onDownload() {
    setBusy('download');
    setMessage(null);
    try {
      const pdf = await get(latest as number);
      downloadBlob(pdf.blob, pdf.filename);
      setMessage({ tone: 'success', text: `Downloaded ${pdf.filename}.` });
    } catch (err) {
      setMessage({ tone: 'danger', text: describeError(err).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {report.status === 'draft' && (
        <p className="text-sm text-muted-foreground">This report is being corrected. The PDF below is the last final version (Rev {latest}).</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {shareable && (
          <DButton size="lg" block loading={busy === 'share'} disabled={busy !== null} onClick={() => void onShare()}>
            <Share2 className="h-4 w-4" aria-hidden /> Share PDF
          </DButton>
        )}
        <DButton
          size="lg"
          block
          variant={shareable ? 'secondary' : 'primary'}
          loading={busy === 'download'}
          disabled={busy !== null}
          onClick={() => void onDownload()}
        >
          <FileDown className="h-4 w-4" aria-hidden /> Download PDF
        </DButton>
      </div>
      {shareable ? (
        <p className="text-xs text-[hsl(var(--text-tertiary))]">Share opens your phone&apos;s share options — WhatsApp, email and more.</p>
      ) : (
        <p className="text-xs text-[hsl(var(--text-tertiary))]">Download the PDF, then attach it in WhatsApp or email.</p>
      )}
      {message && <Notice tone={message.tone} live>{message.text}</Notice>}
    </div>
  );
}

export function RevisionList({ report }: { report: DailyReport }) {
  const { get } = usePdf(report);
  const [busyRev, setBusyRev] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (report.revisions.length === 0) return null;
  const revs = [...report.revisions].sort((a, b) => b.revision - a.revision);

  async function download(rev: number) {
    setBusyRev(rev);
    setError(null);
    try {
      const pdf = await get(rev);
      downloadBlob(pdf.blob, pdf.filename);
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusyRev(null);
    }
  }

  return (
    <DCard className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <History className="h-4 w-4 text-[hsl(var(--text-tertiary))]" aria-hidden /> Revisions
      </h2>
      <ul className="divide-y divide-border">
        {revs.map((r) => (
          <li key={r.revision} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">Rev {r.revision}</span>
                {r.reopenedAt ? <Chip tone="neutral">Reopened</Chip> : <Chip tone="success">Current</Chip>}
              </div>
              <p className="text-muted-foreground">Finalised {formatTimestamp(r.finalisedAt)} by {personName(r.finalisedBy)}</p>
              {r.reopenedAt && (
                <p className="text-muted-foreground">
                  Reopened {formatTimestamp(r.reopenedAt)}{r.reopenReason ? <>: <span className="italic">&ldquo;{r.reopenReason}&rdquo;</span></> : null}
                </p>
              )}
            </div>
            <DButton size="sm" variant="secondary" loading={busyRev === r.revision} disabled={busyRev !== null}
              aria-label={`Download PDF for revision ${r.revision}`} onClick={() => void download(r.revision)}>
              <FileDown className="h-4 w-4" aria-hidden /> PDF
            </DButton>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </DCard>
  );
}

export function ReopenAction({ report }: { report: DailyReport }) {
  const { reopen, projectId, siteId, reportId } = useReport();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  if (!(report.canReopen && report.status === 'final')) return null;

  const trimmed = reason.trim();
  const valid = trimmed.length >= LIMITS.reopenReasonMin && trimmed.length <= LIMITS.reopenReasonMax;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await reopen(trimmed);
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setReason('');
      router.push(dailyPaths.capture(projectId, siteId, reportId));
    } else {
      setError(res.error);
    }
  }

  return (
    <>
      <DButton variant="secondary" block onClick={() => { setError(null); setOpen(true); }}>
        <RotateCcw className="h-4 w-4" aria-hidden /> Reopen for correction
      </DButton>
      <Dialog
        open={open}
        onClose={() => { if (!busy) setOpen(false); }}
        title="Reopen for correction"
        footer={(
          <>
            <DButton variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</DButton>
            <DButton loading={busy} disabled={!valid} onClick={() => void submit()}>Reopen report</DButton>
          </>
        )}
      >
        <p>The report goes back to draft as Rev {report.revision + 1}. The current PDF stays in the revision history.</p>
        <div className="mt-4 text-left">
          <FieldLabel htmlFor="dr-reopen-reason">What needs correcting?</FieldLabel>
          <TextArea
            id="dr-reopen-reason"
            rows={3}
            value={reason}
            maxLength={LIMITS.reopenReasonMax}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Wrong number of steel fixers recorded"
          />
          <p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">
            {trimmed.length < LIMITS.reopenReasonMin
              ? `At least ${LIMITS.reopenReasonMin} characters.`
              : `${trimmed.length} / ${LIMITS.reopenReasonMax}`}
          </p>
        </div>
        {error && <Notice tone="danger" title={error.title} className="mt-3 text-left" live>{error.message}</Notice>}
      </Dialog>
    </>
  );
}
