'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { HistoryList } from '@/components/daily/HistoryList';
import { TodayCard } from '@/components/daily/TodayCard';
import { useCompanyToday, useSiteInfo } from '@/components/daily/hooks';
import { dailyPaths } from '@/components/daily/paths';
import { PageContainer, Skeleton } from '@/components/daily/ui';

export default function DailySitePage({ params }: { params: { projectId: string; siteId: string } }) {
  const { projectId, siteId } = params;
  const { today } = useCompanyToday();
  const info = useSiteInfo(projectId, siteId);
  const siteLabel = info.data ? `${info.data.site.name} · ${info.data.project.name}` : undefined;

  return (
    <PageContainer className="space-y-5">
      <div className="flex items-center gap-1">
        <Link
          href={dailyPaths.home()}
          className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Sites
        </Link>
      </div>
      <div className="px-1">
        {info.isPending ? (
          <Skeleton className="h-6 w-48" />
        ) : (
          <h1 className="text-xl font-semibold text-foreground">{info.data?.site.name ?? 'Site'}</h1>
        )}
        {info.data && <p className="text-sm text-muted-foreground">{info.data.project.name}</p>}
      </div>

      <TodayCard projectId={projectId} siteId={siteId} today={today} siteLabel={siteLabel} />
      <HistoryList projectId={projectId} siteId={siteId} today={today} />
    </PageContainer>
  );
}
