'use client';

import { ReportProvider } from '@/components/daily/ReportContext';
import { ReportShell } from '@/components/daily/ReportShell';

/**
 * Holds one report's state for the capture, review and share screens, so
 * pending saves survive moving between them.
 */
export default function ReportLayout({
  params, children,
}: {
  params: { projectId: string; siteId: string; reportId: string };
  children: React.ReactNode;
}) {
  return (
    <ReportProvider projectId={params.projectId} siteId={params.siteId} reportId={params.reportId}>
      <ReportShell>{children}</ReportShell>
    </ReportProvider>
  );
}
