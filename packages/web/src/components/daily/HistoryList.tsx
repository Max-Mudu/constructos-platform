'use client';

import Link from 'next/link';
import { Camera, ChevronRight } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { roleCanEditDailyReports, type DailyReportSummary } from '@/lib/daily-report-types';
import { personName, relativeReportDate } from './dates';
import { useReportHistory } from './hooks';
import { reportHref } from './paths';
import { describeError } from './report-errors';
import { DButton, DCard, Notice, ReportStatusBadge, Skeleton } from './ui';

function Row({ r, href, today }: { r: DailyReportSummary; href: string; today: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60 active:bg-accent"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-foreground">{relativeReportDate(r.reportDate, today)}</span>
            <ReportStatusBadge status={r.status} revision={r.revision} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span className="font-mono text-[13px]">{r.displayNumber}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Camera className="h-3.5 w-3.5" aria-hidden />
              {r.photoCount}
              <span className="sr-only"> photos</span>
            </span>
            {r.preparedBy && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{personName(r.preparedBy)}</span>
              </>
            )}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-[hsl(var(--text-tertiary))]" aria-hidden />
      </Link>
    </li>
  );
}

export function HistoryList({ projectId, siteId, today }: { projectId: string; siteId: string; today: string }) {
  const role = useAuthStore((s) => s.user?.role ?? 'viewer');
  const canEdit = roleCanEditDailyReports(role);
  const q = useReportHistory(projectId, siteId);
  const rows = q.data?.pages.flatMap((p) => p.reports) ?? [];

  return (
    <section aria-labelledby="dr-history-title">
      <h2 id="dr-history-title" className="mb-2 px-1 text-sm font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
        Previous reports
      </h2>
      {q.isPending ? (
        <DCard className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </DCard>
      ) : q.isError ? (
        <Notice tone="danger" title={describeError(q.error).title}
          actions={<DButton variant="secondary" size="sm" onClick={() => void q.refetch()}>Try again</DButton>}>
          {describeError(q.error).message}
        </Notice>
      ) : rows.length === 0 ? (
        <DCard><p className="text-sm text-muted-foreground">No reports for this site yet.</p></DCard>
      ) : (
        <DCard className="overflow-hidden p-0">
          <ul className="divide-y divide-border">
            {rows.map((r) => <Row key={r.id} r={r} today={today} href={reportHref(projectId, siteId, r, canEdit)} />)}
          </ul>
        </DCard>
      )}
      {q.hasNextPage && (
        <DButton
          variant="secondary"
          block
          className="mt-3"
          loading={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          Load more
        </DButton>
      )}
      {q.isFetchNextPageError && (
        <p className="mt-2 text-center text-sm text-destructive">Could not load more reports. Try again.</p>
      )}
    </section>
  );
}
