import { SiteModuleHub } from '@/components/workflows/SiteModuleHub';

// Sidebar entry point: opens the user's default site's inventory, or lets them pick a site.
export default function InventoryHubPage() {
  return <SiteModuleHub module="inventory" subtitle="Inventory is tracked per site" />;
}
