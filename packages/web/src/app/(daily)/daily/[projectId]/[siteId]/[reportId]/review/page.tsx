'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SECTION_KEYS, type SectionKey } from '@/lib/daily-report-types';
import { FinaliseBar } from '@/components/daily/FinaliseBar';
import { dailyPaths } from '@/components/daily/paths';
import { useReport, type ActionResult } from '@/components/daily/ReportContext';
import type { ErrorView } from '@/components/daily/report-errors';
import { SECTION_LABELS } from '@/components/daily/review-state';
import { SectionCard } from '@/components/daily/SectionCard';
import { UNSUPPORTED_CHIP_LABEL } from '@/components/daily/unsupported-numbers';
import { Notice, PageContainer } from '@/components/daily/ui';

/** REVIEW: section-by-section check, then finalise. */
export default function ReviewPage() {
  const { report, notes, projectId, siteId, reportId } = useReport();
  const router = useRouter();
  const [missing, setMissing] = useState<SectionKey[]>([]);
  const [error, setError] = useState<ErrorView | null>(null);
  const refs = useRef<Partial<Record<SectionKey, HTMLDivElement | null>>>({});
  if (!report) return null;

  const editable = report.status === 'draft' && report.canEdit;
  const aiDraft = report.aiDraft ?? null;
  const flaggedTotal = aiDraft?.unsupportedNumbers.length ?? 0;

  function onResult(res: ActionResult) {
    if (res.ok) {
      setMissing([]);
      setError(null);
      router.push(dailyPaths.share(projectId, siteId, reportId));
      return;
    }
    setError(res.error);
    const m = res.missing ?? [];
    setMissing(m);
    if (m.length) {
      refs.current[m[0]]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  return (
    <>
      <PageContainer withBottomBar className="space-y-4">
        {aiDraft ? (
          <Notice tone="info" title="AI draft ready — check each section">
            Accept a suggestion, edit it, or mark the section as not applicable.
            {flaggedTotal > 0 && <> Amber &ldquo;{UNSUPPORTED_CHIP_LABEL}&rdquo; marks a number the AI could not find in your notes.</>}
          </Notice>
        ) : (
          <Notice tone="info" title="Fill in each section">
            Edit each section, or mark it as not applicable. Your notes are on the{' '}
            <Link href={dailyPaths.capture(projectId, siteId, reportId)} className="font-semibold text-primary underline-offset-2 hover:underline">
              Notes &amp; photos
            </Link>{' '}
            screen.
          </Notice>
        )}

        {error && (
          <Notice tone={missing.length ? 'warning' : 'danger'} title={error.title} live>
            {error.message}
            {missing.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {missing.map((k) => (
                  <li key={k}>
                    <button
                      type="button"
                      className="min-h-[36px] rounded-full border border-warning/30 bg-card px-3 text-sm font-medium text-warning"
                      onClick={() => refs.current[k]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    >
                      {SECTION_LABELS[k]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Notice>
        )}

        {editable && notes.trim() !== '' && (
          <details className="rounded-2xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">Your notes</summary>
            <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">{notes}</p>
          </details>
        )}

        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          {SECTION_KEYS.map((k) => (
            <SectionCard
              key={k}
              ref={(el) => { refs.current[k] = el; }}
              section={k}
              content={report.content}
              aiDraft={aiDraft}
              editable={editable}
              highlight={missing.includes(k)}
            />
          ))}
        </div>
      </PageContainer>
      {editable && <FinaliseBar onResult={onResult} />}
    </>
  );
}
