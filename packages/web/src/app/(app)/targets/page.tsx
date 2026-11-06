import { SiteModuleHub } from '@/components/workflows/SiteModuleHub';

// Sidebar entry point: opens the user's default site's targets, or lets them pick a site.
export default function TargetsHubPage() {
  return <SiteModuleHub module="targets" subtitle="Daily targets are set per site" />;
}
