'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { formatReportDate } from './dates';
import { useReport } from './ReportContext';
import { canFinalise, reviewProgress } from './review-state';
import type { ActionResult } from './ReportContext';
import { BottomBar, DButton, Dialog } from './ui';

/**
 * Sticky bottom bar. Finalise stays disabled until all 9 sections are
 * reviewed, and always asks for confirmation — the report is never
 * finalised automatically.
 */
export function FinaliseBar({ onResult }: { onResult: (res: ActionResult) => void }) {
  const { report, finalise, pendingWrites, notesConflict } = useReport();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!report) return null;

  const progress = reviewProgress(report.content);
  const enabled = canFinalise(report, { busy: busy || pendingWrites > 0, conflict: notesConflict !== null });

  async function confirm() {
    setBusy(true);
    const res = await finalise();
    setBusy(false);
    setOpen(false);
    onResult(res);
  }

  return (
    <>
      <BottomBar>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{progress.reviewed} of {progress.total} reviewed</p>
          <div className="mt-1 h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-border" aria-hidden>
            <div
              className={progress.complete ? 'h-full bg-success' : 'h-full bg-primary'}
              style={{ width: `${(progress.reviewed / progress.total) * 100}%` }}
            />
          </div>
          {pendingWrites > 0 && <p className="mt-1 text-xs text-[hsl(var(--text-tertiary))]">Saving…</p>}
        </div>
        <DButton
          size="lg"
          disabled={!enabled}
          onClick={() => setOpen(true)}
          aria-describedby="dr-finalise-hint"
        >
          <Lock className="h-4 w-4" aria-hidden />
          Finalise
        </DButton>
        <span id="dr-finalise-hint" className="sr-only">
          {progress.complete ? 'All sections reviewed.' : `${progress.total - progress.reviewed} sections still to review.`}
        </span>
      </BottomBar>

      <Dialog
        open={open}
        onClose={() => { if (!busy) setOpen(false); }}
        title={`Finalise ${report.displayNumber}?`}
        footer={(
          <>
            <DButton variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Not yet</DButton>
            <DButton loading={busy} onClick={() => void confirm()}>Finalise report</DButton>
          </>
        )}
      >
        <p>
          The report for {formatReportDate(report.reportDate)} at {report.site.name} will be locked and a PDF created
          for sharing. A project manager can reopen it later for corrections.
        </p>
      </Dialog>
    </>
  );
}
