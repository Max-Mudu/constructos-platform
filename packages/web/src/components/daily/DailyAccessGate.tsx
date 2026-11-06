'use client';

import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { roleCanViewDailyReports } from '@/lib/daily-report-types';
import { DCard, PageContainer, buttonClass } from './ui';

/**
 * UX only: roles outside the Daily Report policy (contractor, worker) get a
 * clear message instead of a page of 403s. The API enforces
 * access on every route.
 */
export function DailyAccessGate({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (user && !roleCanViewDailyReports(user.role)) {
    return (
      <PageContainer>
        <DCard className="mt-6 text-center">
          <h1 className="text-lg font-semibold">Daily Report is not available for your role</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Daily site reports are prepared by site supervisors and project managers.
          </p>
          <Link href="/dashboard" className={buttonClass('primary', 'md', true) + ' mt-5'}>
            Go to the full app
          </Link>
        </DCard>
      </PageContainer>
    );
  }
  return <>{children}</>;
}
