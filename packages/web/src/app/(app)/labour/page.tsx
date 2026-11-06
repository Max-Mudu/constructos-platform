import { SiteModuleHub } from '@/components/workflows/SiteModuleHub';

// Sidebar entry point: opens the user's default site's labour, or lets them pick a site.
export default function LabourHubPage() {
  return <SiteModuleHub module="labour" subtitle="Labour entries are recorded per site" />;
}
