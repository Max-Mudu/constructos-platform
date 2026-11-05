'use client';

import Link from 'next/link';
import { ArrowUpRight, Building2 } from 'lucide-react';

/** Compact dark top bar for the Daily Report screens. No sidebar. */
export function DailyTopBar() {
  return (
    <header
      className="sticky top-0 z-40 bg-sidebar text-sidebar-foreground"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-14 w-full max-w-screen-sm items-center gap-3 px-4 md:max-w-screen-md">
        <Link href="/daily" className="flex min-h-[44px] min-w-0 items-center gap-2.5" aria-label="Daily Report home">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <Building2 className="h-4 w-4 text-white" aria-hidden />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-[15px] font-semibold tracking-wide">ConstructOS</span>
            <span className="block text-xs text-sidebar-muted">Daily Report</span>
          </span>
        </Link>
        <Link
          href="/dashboard"
          className="ml-auto inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-sidebar-muted hover:bg-white/10 hover:text-white"
        >
          Full app
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </header>
  );
}
