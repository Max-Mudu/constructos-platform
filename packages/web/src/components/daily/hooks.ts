'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { companyApi, projectApi, siteApi } from '@/lib/api';
import { dailyReportApi } from '@/lib/daily-report-api';
import { todayIn } from './dates';
import { dailyKeys } from './paths';

/** Today's date in the company time zone (device time until it loads / if it fails). */
export function useCompanyToday(): { today: string; timeZone: string | null } {
  const q = useQuery({
    queryKey: ['company', 'me'],
    queryFn: () => companyApi.get(),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const tz = q.data?.company.timezone ?? null;
  return { today: todayIn(tz), timeZone: tz };
}

export function useDailyProjects() {
  return useQuery({
    queryKey: ['daily', 'projects'],
    queryFn: async () => (await projectApi.list()).projects.filter((p) => p.status !== 'archived'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDailySites(projectId: string | null) {
  return useQuery({
    queryKey: ['daily', 'sites', projectId],
    queryFn: async () => (await siteApi.list(projectId as string)).sites.filter((s) => s.isActive !== false),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSiteInfo(projectId: string, siteId: string) {
  return useQuery({
    queryKey: ['daily', 'site', projectId, siteId],
    queryFn: async () => {
      const [p, s] = await Promise.all([projectApi.get(projectId), siteApi.get(projectId, siteId)]);
      return { project: p.project, site: s.site };
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** The report for one date (0 or 1 rows: one report per site per date). */
export function useReportForDate(projectId: string | null, siteId: string | null, date: string) {
  return useQuery({
    queryKey: dailyKeys.today(projectId ?? '', siteId ?? '', date),
    queryFn: async ({ signal }) => {
      const res = await dailyReportApi.list(projectId as string, siteId as string, { date, limit: 1 }, signal);
      return res.reports.find((r) => r.reportDate === date) ?? null;
    },
    enabled: !!projectId && !!siteId,
    staleTime: 15_000,
  });
}

export const HISTORY_PAGE_SIZE = 20;

export function useReportHistory(projectId: string, siteId: string) {
  return useInfiniteQuery({
    queryKey: dailyKeys.history(projectId, siteId),
    queryFn: ({ pageParam, signal }) =>
      dailyReportApi.list(projectId, siteId, { cursor: pageParam, limit: HISTORY_PAGE_SIZE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });
}
