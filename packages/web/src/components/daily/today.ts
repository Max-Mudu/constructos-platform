/** "Today's report" card model. Pure. */
import type { DailyReportSummary } from '@/lib/daily-report-types';

export type TodayStatus = 'not_started' | 'draft' | 'final';
export type TodayAction = 'create' | 'continue' | 'view' | null;

export interface TodayCardModel {
  status: TodayStatus;
  headline: string;
  detail: string;
  ctaLabel: string | null;
  action: TodayAction;
}

export function todayCardModel(report: DailyReportSummary | null | undefined, canEdit: boolean): TodayCardModel {
  if (!report) {
    return canEdit
      ? { status: 'not_started', headline: 'Not started', detail: 'Write down what happened on site and add photos. You can finish it later.', ctaLabel: "Start today's report", action: 'create' }
      : { status: 'not_started', headline: 'Not started', detail: 'No report has been started for today yet.', ctaLabel: null, action: null };
  }
  if (report.status === 'draft') {
    const reopened = report.revision > 0;
    return canEdit
      ? {
        status: 'draft',
        headline: reopened ? `Draft · reopened for correction (Rev ${report.revision})` : 'Draft in progress',
        detail: `${report.displayNumber} · ${report.photoCount} photo${report.photoCount === 1 ? '' : 's'}`,
        ctaLabel: "Continue today's report",
        action: 'continue',
      }
      : {
        status: 'draft',
        headline: 'Draft in progress',
        detail: `${report.displayNumber} · not finalised yet`,
        ctaLabel: 'View draft',
        action: 'view',
      };
  }
  return {
    status: 'final',
    headline: report.revision > 0 ? `Final · Rev ${report.revision}` : 'Final',
    detail: `${report.displayNumber} · ready to download and share`,
    ctaLabel: 'View & share',
    action: 'view',
  };
}
