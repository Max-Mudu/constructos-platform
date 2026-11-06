import { SiteModuleHub } from '@/components/workflows/SiteModuleHub';

// Sidebar entry point: opens the user's default site's deliveries, or lets them pick a site.
export default function DeliveriesHubPage() {
  return <SiteModuleHub module="deliveries" subtitle="Deliveries are received per site" />;
}
