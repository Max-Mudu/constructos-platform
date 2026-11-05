'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { dailyPaths } from './paths';
import { useReport } from './ReportContext';
import type { ErrorView } from './report-errors';
import { DButton, DCard, Notice } from './ui';

const STAGES = [
  'Reading your notes…',
  'Sorting them into the 9 report sections…',
  'Checking numbers against your notes…',
  'Almost done — this can take up to 40 seconds…',
];

/** Seconds elapsed while `active`, for the working state. */
function useElapsed(active: boolean): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) { setSecs(0); return; }
    const start = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);
  return secs;
}

export function ExtractPanel() {
  const { report, notes, extract, extracting, projectId, siteId, reportId } = useReport();
  const router = useRouter();
  const [error, setError] = useState<ErrorView | null>(null);
  const secs = useElapsed(extracting);

  if (!report) return null;
  const hasDraft = !!report.aiDraft;
  const noNotes = notes.trim().length === 0;
  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(secs / 10))];
  const reviewHref = dailyPaths.review(projectId, siteId, reportId);

  async function run() {
    setError(null);
    const res = await extract();
    if (res.ok) router.push(reviewHref);
    else setError(res.error);
  }

  return (
    <DCard className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">AI draft</h2>
      </div>

      {extracting ? (
        <div className="space-y-3" role="status" aria-live="polite">
          <p className="text-[15px] font-medium text-foreground">{stage}</p>
          <div className="h-2 overflow-hidden rounded-full bg-border">
            <div className="dr-indeterminate h-full w-2/5 rounded-full bg-primary" />
          </div>
          <p className="text-sm text-muted-foreground">
            {secs}s · Usually 10–40 seconds. Keep this screen open. Your notes are saved.
          </p>
        </div>
      ) : error ? (
        <Notice
          tone="warning"
          title={error.title}
          live
          actions={(
            <>
              {error.retryable && <DButton size="sm" onClick={() => void run()}>Try again</DButton>}
              <DButton size="sm" variant="secondary" onClick={() => router.push(reviewHref)}>Fill in manually</DButton>
            </>
          )}
        >
          {error.message}
        </Notice>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {hasDraft
              ? 'A draft is ready. Check each section on the Review screen — nothing is final until you finalise it.'
              : 'Turn your notes into the 9 report sections. You check every section before anything is final. Takes about 10–40 seconds.'}
          </p>
          {report.extractionStatus === 'failed' && !hasDraft && (
            <Notice tone="info">The last AI attempt did not work. You can try again, or fill in the report yourself.</Notice>
          )}
          <DButton
            size="lg"
            block
            variant={hasDraft ? 'secondary' : 'primary'}
            disabled={noNotes}
            onClick={() => void run()}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {hasDraft ? 'Generate a new draft' : 'Generate draft with AI'}
          </DButton>
          {noNotes && <p className="text-xs text-[hsl(var(--text-tertiary))]">Write some notes first.</p>}
          {!hasDraft && (
            <DButton variant="ghost" block onClick={() => router.push(reviewHref)}>
              Fill in manually instead
            </DButton>
          )}
        </>
      )}
    </DCard>
  );
}
