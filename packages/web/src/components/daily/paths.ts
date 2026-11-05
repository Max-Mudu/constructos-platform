/** URL builders for the /daily route group. */
const seg = encodeURIComponent;

export const dailyPaths = {
  home: () => '/daily',
  site: (projectId: string, siteId: string) => `/daily/${seg(projectId)}/${seg(siteId)}`,
  capture: (projectId: string, siteId: string, reportId: string) => `/daily/${seg(projectId)}/${seg(siteId)}/${seg(reportId)}`,
  review: (projectId: string, siteId: string, reportId: string) => `/daily/${seg(projectId)}/${seg(siteId)}/${seg(reportId)}/review`,
  share: (projectId: string, siteId: string, reportId: string) => `/daily/${seg(projectId)}/${seg(siteId)}/${seg(reportId)}/share`,
};

/** Where a report row should open: editors go to capture for drafts, everyone else to the read-only view. */
export function reportHref(
  projectId: string, siteId: string,
  r: { id: string; status: 'draft' | 'final' },
  canEdit: boolean,
): string {
  return r.status === 'draft' && canEdit
    ? dailyPaths.capture(projectId, siteId, r.id)
    : dailyPaths.share(projectId, siteId, r.id);
}

export type ReportScreen = 'capture' | 'review' | 'share';

/** Which report screen a pathname is. */
export function screenOf(pathname: string): ReportScreen {
  if (/\/review\/?$/.test(pathname)) return 'review';
  if (/\/share\/?$/.test(pathname)) return 'share';
  return 'capture';
}

/**
 * Capture and review are for editing a draft. A final report, or a reader
 * without edit rights (viewer, finance_officer), is sent to the read-only
 * share screen. Returns the screen to redirect to, or null to stay.
 */
export function guardScreen(
  screen: ReportScreen,
  report: { status: 'draft' | 'final'; canEdit: boolean },
): ReportScreen | null {
  if (screen === 'share') return null;
  if (report.status !== 'draft' || !report.canEdit) return 'share';
  return null;
}

/** Query keys shared by the daily screens. */
export const dailyKeys = {
  all: ['daily-reports'] as const,
  site: (projectId: string, siteId: string) => ['daily-reports', projectId, siteId] as const,
  today: (projectId: string, siteId: string, date: string) => ['daily-reports', projectId, siteId, 'date', date] as const,
  history: (projectId: string, siteId: string) => ['daily-reports', projectId, siteId, 'history'] as const,
};
