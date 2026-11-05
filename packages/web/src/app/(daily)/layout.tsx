import type { Metadata, Viewport } from 'next';
import { AuthBootstrap } from '@/components/AuthBootstrap';
import { AuthGuard } from '@/components/AuthGuard';
import { DailyAccessGate } from '@/components/daily/DailyAccessGate';
import { DailyProviders } from '@/components/daily/DailyProviders';
import { DailyTopBar } from '@/components/daily/DailyTopBar';
import './daily.css';

export const metadata: Metadata = {
  title: 'Daily Report · ConstructOS',
  description: 'Daily site report',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#121826',
};

/**
 * Focused, phone-first shell for the Daily Site Report. Same auth wiring as
 * the (app) layout, a scoped light theme, a compact top bar and no sidebar.
 */
export default function DailyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-daily min-h-screen bg-background text-foreground antialiased">
      <AuthBootstrap />
      <AuthGuard>
        <DailyProviders>
          <DailyTopBar />
          <main className="min-h-[calc(100vh-3.5rem)]">
            <DailyAccessGate>{children}</DailyAccessGate>
          </main>
        </DailyProviders>
      </AuthGuard>
    </div>
  );
}
