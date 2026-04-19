import { ClipboardCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

export default function AttendancePage() {
  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Attendance"
        subtitle="Daily attendance records across all sites"
      />
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 mb-4">
          <ClipboardCheck className="h-7 w-7 text-primary" />
        </div>
        <p className="font-semibold text-foreground">Coming Soon</p>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">
          The global attendance overview will be available in a future update.
          Attendance records are available per-site under each project.
        </p>
      </div>
    </div>
  );
}
