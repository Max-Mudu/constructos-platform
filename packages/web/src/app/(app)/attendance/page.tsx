import { SiteModuleHub } from '@/components/workflows/SiteModuleHub';

// Sidebar entry point: opens the user's default site's attendance, or lets them pick a site.
export default function AttendanceHubPage() {
  return <SiteModuleHub module="attendance" subtitle="Daily attendance is recorded per site" />;
}
