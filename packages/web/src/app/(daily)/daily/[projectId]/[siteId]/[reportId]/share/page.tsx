'use client';

import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { SECTION_KEYS } from '@/lib/daily-report-types';
import { formatTimestamp, personName } from '@/components/daily/dates';
import { dailyPaths } from '@/components/daily/paths';
import { PdfShareActions, ReopenAction, RevisionList } from '@/components/daily/PdfShare';
import { PhotoGrid } from '@/components/daily/Photos';
import { useReport } from '@/components/daily/ReportContext';
import { SECTION_LABELS } from '@/components/daily/review-state';
import { SectionView } from '@/components/daily/SectionView';
import { DCard, Notice, PageContainer, ReportStatusBadge, buttonClass } from '@/components/daily/ui';

const NO_FLAGS = new Set<string>();

/**
 * SHARE / read-only view. Final reports: download and share the PDF, see
 * revisions, reopen (PM/admin). Viewers and finance officers only ever land
 * here (read-only + PDF).
 */
export default function SharePage() {
  const { report, projectId, siteId, reportId } = useReport();
  if (!report) return null;
  const editingDraft = report.status === 'draft' && report.canEdit;

  return (
    <PageContainer className="space-y-4">
      <DCard className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-mono text-sm text-muted-foreground">{report.displayNumber}</p>
            <p className="text-base font-semibold text-foreground">
              {report.status === 'final' ? 'Final report' : 'Draft — not finalised'}
            </p>
          </div>
          <ReportStatusBadge status={report.status} revision={report.revision} />
        </div>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-[hsl(var(--text-tertiary))]">Prepared by </dt><dd className="inline text-foreground">{personName(report.preparedBy)}</dd></div>
          {report.finalisedAt && report.finalisedBy && (
            <div>
              <dt className="inline text-[hsl(var(--text-tertiary))]">Finalised </dt>
              <dd className="inline text-foreground">{formatTimestamp(report.finalisedAt)} by {personName(report.finalisedBy)}</dd>
            </div>
          )}
          <div><dt className="inline text-[hsl(var(--text-tertiary))]">Photos </dt><dd className="inline text-foreground">{report.photoCount}</dd></div>
        </dl>

        {report.status === 'draft' && !report.canEdit && (
          <Notice tone="info">This report is still a draft and may change. You can read it here.</Notice>
        )}

        <PdfShareActions report={report} />

        {editingDraft && (
          <Link href={dailyPaths.capture(projectId, siteId, reportId)} className={buttonClass('secondary', 'lg', true)}>
            <Pencil className="h-4 w-4" aria-hidden /> Continue editing
          </Link>
        )}
        <ReopenAction report={report} />
      </DCard>

      <section aria-label="Report content" className="grid gap-4 md:grid-cols-2 md:items-start">
        {SECTION_KEYS.map((k) => (
          <DCard key={k} className="space-y-2">
            <h2 className="text-base font-semibold text-foreground">{SECTION_LABELS[k]}</h2>
            <SectionView section={k} value={report.content[k]} flagged={NO_FLAGS} emptyText="Not applicable" />
          </DCard>
        ))}
      </section>

      {report.photos.length > 0 && (
        <DCard className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Photos</h2>
          <PhotoGrid photos={report.photos} editable={false} />
        </DCard>
      )}

      <RevisionList report={report} />
    </PageContainer>
  );
}
