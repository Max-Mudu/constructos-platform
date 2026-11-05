'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatReportDate } from './dates';
import { dailyPaths, guardScreen, screenOf, type ReportScreen } from './paths';
import { useReport } from './ReportContext';
import { DButton, Notice, PageContainer, ReportStatusBadge, Skeleton } from './ui';

const STEPS: { screen: ReportScreen; label: string }[] = [
  { screen: 'capture', label: 'Notes & photos' },
  { screen: 'review', label: 'Review' },
  { screen: 'share', label: 'Share' },
];

/** Report header, step tabs, loading/error states and screen guards. */
export function ReportShell({ children }: { children: React.ReactNode }) {
  const { report, loading, loadError, reload, projectId, siteId, reportId } = useReport();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const screen = screenOf(pathname);
  const redirect = report ? guardScreen(screen, report) : null;

  useEffect(() => {
    if (redirect) router.replace(dailyPaths[redirect](projectId, siteId, reportId));
  }, [redirect, router, projectId, siteId, reportId]);

  const back = (
    <Link
      href={dailyPaths.site(projectId, siteId)}
      className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden />
      {report ? report.site.name : 'Site'}
    </Link>
  );

  if (loading && !report) {
    return (
      <PageContainer className="space-y-4">
        {back}
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </PageContainer>
    );
  }
  if (!report) {
    return (
      <PageContainer className="space-y-4">
        {back}
        <Notice
          tone="danger"
          title={loadError?.title ?? 'Could not load this report'}
          actions={<DButton variant="secondary" size="sm" onClick={() => void reload()}>Try again</DButton>}
        >
          {loadError?.message ?? 'Please try again.'}
        </Notice>
      </PageContainer>
    );
  }
  if (redirect) return <PageContainer>{back}<Skeleton className="mt-4 h-40 w-full" /></PageContainer>;

  const editing = report.status === 'draft' && report.canEdit;

  return (
    <>
      <PageContainer className="pb-0 md:pb-0">
        {back}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <h1 className="text-xl font-semibold text-foreground">{formatReportDate(report.reportDate)}</h1>
          <ReportStatusBadge status={report.status} revision={report.revision} />
        </div>
        <p className="px-1 text-sm text-muted-foreground">
          <span className="font-mono text-[13px]">{report.displayNumber}</span> · {report.site.name} · {report.project.name}
        </p>
        {editing && (
          <nav aria-label="Report steps" className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-border/50 p-1">
            {STEPS.map((s) => (
              <Link
                key={s.screen}
                href={dailyPaths[s.screen](projectId, siteId, reportId)}
                aria-current={screen === s.screen ? 'page' : undefined}
                className={cn(
                  'flex min-h-[44px] items-center justify-center rounded-lg px-1 text-center text-sm font-medium transition-colors',
                  screen === s.screen ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        )}
      </PageContainer>
      {children}
    </>
  );
}
