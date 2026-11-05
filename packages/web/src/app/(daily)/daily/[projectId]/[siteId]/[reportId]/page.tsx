'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { ExtractPanel } from '@/components/daily/ExtractPanel';
import { NotesInput } from '@/components/daily/NotesInput';
import { PhotoSection } from '@/components/daily/Photos';
import { dailyPaths } from '@/components/daily/paths';
import { useReport } from '@/components/daily/ReportContext';
import { reviewProgress } from '@/components/daily/review-state';
import { BottomBar, DButton, PageContainer } from '@/components/daily/ui';

/** CAPTURE: notes (autosaved), photos, AI draft. */
export default function CapturePage() {
  const { report, flushNotes, extracting, projectId, siteId, reportId, notesConflict } = useReport();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  if (!report) return null;
  const progress = reviewProgress(report.content);

  async function goReview() {
    setLeaving(true);
    // Save first when we can; the review screen also works with unsaved notes
    // (they stay in memory and on this phone), so never block on it.
    await flushNotes();
    router.push(dailyPaths.review(projectId, siteId, reportId));
  }

  return (
    <>
      <PageContainer withBottomBar className="space-y-4">
        <NotesInput />
        <PhotoSection />
        <ExtractPanel />
      </PageContainer>
      <BottomBar>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-foreground">{progress.reviewed} of {progress.total} sections reviewed</p>
          <p className="truncate text-xs text-[hsl(var(--text-tertiary))]">
            {notesConflict !== null ? 'Choose a version of your notes first' : 'Check each section, then finalise'}
          </p>
        </div>
        <DButton size="lg" loading={leaving} disabled={extracting} onClick={() => void goReview()}>
          Review report
          <ArrowRight className="h-4 w-4" aria-hidden />
        </DButton>
      </BottomBar>
    </>
  );
}
