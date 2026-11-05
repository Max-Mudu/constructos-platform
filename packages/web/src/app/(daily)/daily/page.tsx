'use client';

import { useState } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { SitePicker, type SiteSelection } from '@/components/daily/SitePicker';
import { TodayCard } from '@/components/daily/TodayCard';
import { useCompanyToday } from '@/components/daily/hooks';
import { dailyPaths } from '@/components/daily/paths';
import { PageContainer, buttonClass } from '@/components/daily/ui';

export default function DailyHomePage() {
  const user = useAuthStore((s) => s.user);
  const { today } = useCompanyToday();
  const [sel, setSel] = useState<SiteSelection | null>(null);

  return (
    <PageContainer className="space-y-4">
      <div className="px-1">
        <h1 className="text-xl font-semibold text-foreground">
          {user ? `Hello, ${user.firstName}` : 'Daily Report'}
        </h1>
        <p className="text-sm text-muted-foreground">Choose your site to start or continue today&apos;s report.</p>
      </div>

      <SitePicker onChange={setSel} />

      {sel && (
        <>
          <TodayCard
            key={`${sel.project.id}:${sel.site.id}:${today}`}
            projectId={sel.project.id}
            siteId={sel.site.id}
            today={today}
            siteLabel={`${sel.site.name} · ${sel.project.name}`}
          />
          <Link href={dailyPaths.site(sel.project.id, sel.site.id)} className={buttonClass('secondary', 'md', true)}>
            <History className="h-4 w-4" aria-hidden />
            Previous reports for this site
          </Link>
        </>
      )}
    </PageContainer>
  );
}
