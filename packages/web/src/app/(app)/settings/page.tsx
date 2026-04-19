import { Settings } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

export default function SettingsPage() {
  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Settings"
        subtitle="Platform and company configuration"
      />
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 mb-4">
          <Settings className="h-7 w-7 text-primary" />
        </div>
        <p className="font-semibold text-foreground">Coming Soon</p>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">
          Platform settings will be available in a future update.
        </p>
      </div>
    </div>
  );
}
