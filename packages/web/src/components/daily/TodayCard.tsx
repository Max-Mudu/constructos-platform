'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2 } from 'lucide-react';
import { dailyReportApi, reportIdFromError } from '@/lib/daily-report-api';
import { useAuthStore } from '@/store/auth.store';
import { roleCanEditDailyReports } from '@/lib/daily-report-types';
import { formatReportDate } from './dates';
import { useReportForDate } from './hooks';
import { dailyKeys, dailyPaths } from './paths';
import { describeError, type ErrorView } from './report-errors';
import { todayCardModel } from './today';
import { DButton, DCard, Notice, ReportStatusBadge, Skeleton } from './ui';

export function TodayCard({
  projectId, siteId, today, siteLabel,
}: {
  projectId: string; siteId: string; today: string; siteLabel?: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role ?? 'viewer');
  const canEdit = roleCanEditDailyReports(role);
  const q = useReportForDate(projectId, siteId, today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);

  const model = todayCardModel(q.data ?? null, canEdit);

  async function onCta() {
    setError(null);
    const existing = q.data;
    if (model.action === 'view' && existing) {
      router.push(dailyPaths.share(projectId, siteId, existing.id));
      return;
    }
    if (model.action === 'continue' && existing) {
      router.push(dailyPaths.capture(projectId, siteId, existing.id));
      return;
    }
    // create-or-open: POST returns the existing draft if one exists.
    setBusy(true);
    try {
      const { report } = await dailyReportApi.createOrOpen(projectId, siteId, today);
      void qc.invalidateQueries({ queryKey: dailyKeys.site(projectId, siteId) });
      router.push(dailyPaths.capture(projectId, siteId, report.id));
    } catch (err) {
      const finalId = reportIdFromError(err);
      if (finalId) {
        void qc.invalidateQueries({ queryKey: dailyKeys.site(projectId, siteId) });
        router.push(dailyPaths.share(projectId, siteId, finalId));
        return;
      }
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <DCard className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">Today&apos;s report</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{formatReportDate(today)}</h2>
          {siteLabel && <p className="mt-0.5 truncate text-sm text-muted-foreground">{siteLabel}</p>}
        </div>
        {q.isSuccess && <ReportStatusBadge status={model.status} />}
      </div>

      {q.isPending ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-[52px] w-full" />
        </div>
      ) : q.isError ? (
        <div className="mt-4">
          <Notice
            tone="danger"
            title={describeError(q.error).title}
            actions={<DButton variant="secondary" size="sm" onClick={() => void q.refetch()}>Try again</DButton>}
          >
            {describeError(q.error).message}
          </Notice>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-background p-3">
            <CalendarCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-foreground">{model.headline}</p>
              <p className="text-sm text-muted-foreground">{model.detail}</p>
            </div>
          </div>
          {error && (
            <Notice tone="danger" title={error.title} className="mt-3" live>{error.message}</Notice>
          )}
          {model.ctaLabel && (
            <DButton size="lg" block className="mt-4" loading={busy} onClick={() => void onCta()}>
              {model.ctaLabel}
            </DButton>
          )}
        </>
      )}
    </DCard>
  );
}
