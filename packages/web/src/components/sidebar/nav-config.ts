import { UserRole } from '@/lib/types';
import { SITE_MODULES } from '@/lib/workflows-site-hub';

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  /** null = visible to all authenticated users */
  roles: UserRole[] | null;
  /** if true, only shown when user.canViewFinance === true */
  requiresFinance: boolean;
  /**
   * if true, only shown to users with financial permission
   * (see hasFinancialNavPermission). Used for internal Invoices and Budget.
   */
  requiresFinancialPermission?: boolean;
  /** visual separator above this item */
  group?: string;
}

export const NAV_ITEMS: NavItem[] = [
  // ── Overview ──────────────────────────────────────────────────────────────
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: 'LayoutDashboard',
    roles: null,
    requiresFinance: false,
    group: 'Overview',
  },

  // ── Project Management ────────────────────────────────────────────────────
  {
    label: 'Projects',
    href: '/projects',
    icon: 'Building2',
    roles: null,
    requiresFinance: false,
    group: 'Projects',
  },

  // ── Site Operations ────────────────────────────────────────────────────────
  {
    // Daily Site Report (mobile-first, served by the (daily) route group).
    label: 'Daily Report',
    href: '/daily',
    icon: 'ClipboardPen',
    roles: ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'viewer', 'consultant'],
    requiresFinance: false,
    group: 'Site Operations',
  },
  {
    label: 'Labour',
    href: '/labour',
    icon: 'HardHat',
    roles: ['company_admin', 'project_manager', 'site_supervisor'],
    requiresFinance: false,
    group: 'Site Operations',
  },
  {
    label: 'Attendance',
    href: '/attendance',
    icon: 'ClipboardCheck',
    roles: ['company_admin', 'project_manager', 'site_supervisor', 'worker'],
    requiresFinance: false,
  },
  {
    label: 'Daily Targets',
    href: '/targets',
    icon: 'Target',
    roles: ['company_admin', 'project_manager', 'site_supervisor'],
    requiresFinance: false,
  },
  {
    label: 'Inventory',
    href: '/inventory',
    icon: 'Layers',
    roles: ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'],
    requiresFinance: false,
  },
  {
    label: 'Deliveries',
    href: '/deliveries',
    icon: 'Package',
    roles: ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'],
    requiresFinance: false,
  },
  {
    label: 'Schedules',
    href: '/schedules',
    icon: 'CalendarDays',
    roles: ['company_admin', 'project_manager', 'site_supervisor'],
    requiresFinance: false,
  },

  // ── People & Contracts ────────────────────────────────────────────────────
  {
    label: 'Workers',
    href: '/workers',
    icon: 'HardHat',
    roles: ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'],
    requiresFinance: false,
    group: 'People',
  },
  {
    label: 'Contractors',
    href: '/contractors',
    icon: 'Truck',
    roles: ['company_admin', 'project_manager', 'contractor'],
    requiresFinance: false,
  },
  {
    label: 'Consultants',
    href: '/consultants',
    icon: 'UserCheck',
    roles: ['company_admin', 'project_manager', 'consultant'],
    requiresFinance: false,
  },

  // ── Documents ─────────────────────────────────────────────────────────────
  {
    label: 'Drawings',
    href: '/drawings',
    icon: 'FileStack',
    roles: null,
    requiresFinance: false,
    group: 'Documents',
  },
  {
    label: 'Instructions',
    href: '/consultants/instructions',
    icon: 'ClipboardList',
    roles: ['company_admin', 'project_manager', 'site_supervisor', 'consultant', 'contractor'],
    requiresFinance: false,
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    label: 'Budget',
    href: '/budget',
    icon: 'PieChart',
    roles: ['company_admin', 'finance_officer', 'project_manager'],
    requiresFinance: false,
    requiresFinancialPermission: true,
    group: 'Finance',
  },
  {
    label: 'Invoices',
    href: '/invoices',
    icon: 'Receipt',
    roles: ['company_admin', 'finance_officer', 'project_manager'],
    requiresFinance: false,
    requiresFinancialPermission: true,
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: 'BarChart2',
    roles: ['company_admin', 'finance_officer', 'project_manager', 'site_supervisor', 'contractor', 'consultant'],
    requiresFinance: false,
    group: 'Reports',
  },

  {
    // PRIVATE — only company_admin and finance_officer with canViewFinance flag
    label: 'Client Finance',
    href: '/finance',
    icon: 'Lock',
    roles: ['company_admin', 'finance_officer'],
    requiresFinance: true,
    group: 'Private',
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  {
    label: 'Audit Logs',
    href: '/audit',
    icon: 'ScrollText',
    roles: ['company_admin'],
    requiresFinance: false,
    group: 'Admin',
  },
  {
    // Company user management (GET/POST /companies/me/users are
    // company_admin only). Hiding it is UX only; the API enforces.
    label: 'Team',
    href: '/settings/team',
    icon: 'Users',
    roles: ['company_admin'],
    requiresFinance: false,
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: 'Settings',
    roles: null,
    requiresFinance: false,
  },

  // ── Notifications (all roles) ─────────────────────────────────────────────
  {
    label: 'Notifications',
    href: '/notifications',
    icon: 'Bell',
    roles: null,
    requiresFinance: false,
    group: 'Account',
  },
];

/**
 * Financial permission for internal finance navigation (Invoices, Budget).
 * Mirrors the backend rule: super_admin, company_admin and finance_officer
 * always; project_manager only when canViewFinance === true; all other roles
 * never (the canViewFinance flag does not grant it to them).
 */
export function hasFinancialNavPermission(
  role: UserRole,
  canViewFinance: boolean,
): boolean {
  switch (role) {
    case 'super_admin':
    case 'company_admin':
    case 'finance_officer':
      return true;
    case 'project_manager':
      return canViewFinance === true;
    default:
      return false;
  }
}

/**
 * Filters NAV_ITEMS to what the given user is allowed to see.
 * This is pure logic — no React, no side effects — so it is fully testable.
 *
 * NOTE: hiding navigation is a UX convenience, NOT an authorization control.
 * The backend enforces access on every route; never rely on this for security.
 */
export function getVisibleNavItems(
  role: UserRole,
  canViewFinance: boolean,
): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    // Finance-gated items: role must be allowed AND canViewFinance must be true
    if (item.requiresFinance && !canViewFinance) return false;

    // Internal finance items (Invoices, Budget): financial permission required
    if (item.requiresFinancialPermission && !hasFinancialNavPermission(role, canViewFinance)) {
      return false;
    }

    // Role check: null means all roles are allowed
    if (item.roles === null) return true;

    return item.roles.includes(role);
  });
}

/**
 * Site-scoped workflow pages live under /projects/:projectId/sites/:siteId/<module>.
 * The sidebar links each module to its top-level hub (/attendance, /inventory, ...),
 * which opens the user's default site or a site picker, so a site-scoped page
 * must still highlight its module's item rather than "Projects".
 */
const SITE_MODULE_PATH = new RegExp(
  `^/projects/[^/]+/sites/[^/]+/(${SITE_MODULES.join('|')})(?:/|$)`,
);

/**
 * The single nav href to mark active for `pathname`: the module hub for a
 * site-scoped workflow page, otherwise the longest href that equals or
 * prefixes the path (so /consultants/instructions highlights Instructions,
 * not Consultants too). /dashboard only matches exactly.
 */
export function activeNavHref(hrefs: readonly string[], pathname: string): string | null {
  const site = SITE_MODULE_PATH.exec(pathname);
  if (site && hrefs.includes(`/${site[1]}`)) return `/${site[1]}`;

  let best: string | null = null;
  for (const href of hrefs) {
    const matches = pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'));
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
