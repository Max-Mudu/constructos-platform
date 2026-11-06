import { SiteModuleHub } from '@/components/workflows/SiteModuleHub';

// Sidebar entry point: opens the user's default site's schedules, or lets them pick a site.
export default function SchedulesHubPage() {
  return <SiteModuleHub module="schedules" subtitle="Schedules are planned per site" />;
}
