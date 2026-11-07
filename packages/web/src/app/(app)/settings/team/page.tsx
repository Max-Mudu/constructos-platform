'use client';

import { useAuthStore } from '@/store/auth.store';
import { TeamManagement } from '@/components/team/TeamManagement';

/**
 * /settings/team — company team management (company_admin).
 *
 * The role check here is UX only; every /companies/me/users endpoint enforces
 * company_admin on the server. The page lives under the (app) layout, so
 * AuthGuard has already hydrated the session before this renders.
 */
export default function TeamSettingsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id);
  return <TeamManagement role={role} currentUserId={userId} />;
}
