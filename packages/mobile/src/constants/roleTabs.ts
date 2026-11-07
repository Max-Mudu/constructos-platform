import { UserRole } from '../types';

// ─── Which roles the API lets load a tab's data ──────────────────────────────
//
// These lists MIRROR the server's role gates. They decide only what the app
// shows; the API still enforces access on every call. Keep them in step with:
//
//   SCHEDULE_VIEW_ROLES   = VIEW_ROLES in packages/api/src/routes/schedule.routes.ts
//                           (GET .../schedule/tasks, the only data the Schedule tab loads)
//   ATTENDANCE_VIEW_ROLES = VIEW_ROLES in packages/api/src/routes/attendance.routes.ts
//                           (GET .../attendance, the list the non-worker Attendance view loads)
//   ATTENDANCE_SELF_ROLES = requireRole('worker') on POST .../attendance/self in the same file
//                           (the worker Attendance view is self check-in only)

export const SCHEDULE_VIEW_ROLES: readonly UserRole[] = [
  'company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'contractor', 'consultant',
];

export const ATTENDANCE_VIEW_ROLES: readonly UserRole[] = [
  'company_admin', 'project_manager', 'site_supervisor', 'finance_officer',
];

export const ATTENDANCE_SELF_ROLES: readonly UserRole[] = ['worker'];

export type TabName =
  | 'index' | 'dashboard' | 'projects' | 'labour' | 'deliveries' | 'inventory'
  | 'attendance' | 'schedule' | 'invoices' | 'instructions' | 'reports' | 'notifications' | 'profile';

/**
 * False when the API refuses the role the data a tab screen loads, so the tab
 * (and links into it) would only ever show a permissions error.
 */
export function roleCanLoadTab(role: UserRole, tab: TabName): boolean {
  switch (tab) {
    case 'schedule':
      return SCHEDULE_VIEW_ROLES.includes(role);
    case 'attendance':
      return ATTENDANCE_VIEW_ROLES.includes(role) || ATTENDANCE_SELF_ROLES.includes(role);
    default:
      return true;
  }
}

export type TabConfig = { name: TabName; title: string };

function baseTabsForRole(role: UserRole): TabConfig[] {
  switch (role) {
    case 'worker':
      return [
        { name: 'index',         title: 'My Day'     },
        { name: 'attendance',    title: 'Attendance' },
        { name: 'schedule',      title: 'Schedule'   },
        { name: 'notifications', title: 'Alerts'     },
        { name: 'profile',       title: 'Profile'    },
      ];

    case 'site_supervisor':
      return [
        { name: 'index',         title: 'Home'       },
        { name: 'labour',        title: 'Labour'     },
        { name: 'deliveries',    title: 'Deliveries' },
        { name: 'inventory',     title: 'Inventory'  },
        { name: 'attendance',    title: 'Attendance' },
        { name: 'schedule',      title: 'Schedule'   },
        { name: 'profile',       title: 'Profile'    },
      ];

    case 'project_manager':
      return [
        { name: 'dashboard',     title: 'Dashboard'  },
        { name: 'projects',      title: 'Projects'   },
        { name: 'labour',        title: 'Labour'     },
        { name: 'deliveries',    title: 'Deliveries' },
        { name: 'inventory',     title: 'Inventory'  },
        { name: 'schedule',      title: 'Schedule'   },
        { name: 'reports',       title: 'Reports'    },
        { name: 'notifications', title: 'Alerts'     },
        { name: 'profile',       title: 'Profile'    },
      ];

    case 'company_admin':
      return [
        { name: 'dashboard',     title: 'Dashboard'  },
        { name: 'projects',      title: 'Projects'   },
        { name: 'inventory',     title: 'Inventory'  },
        { name: 'schedule',      title: 'Schedule'   },
        { name: 'invoices',      title: 'Invoices'   },
        { name: 'reports',       title: 'Reports'    },
        { name: 'notifications', title: 'Alerts'     },
        { name: 'profile',       title: 'Profile'    },
      ];

    case 'finance_officer':
      return [
        { name: 'dashboard',     title: 'Dashboard'  },
        { name: 'deliveries',    title: 'Deliveries' },
        { name: 'inventory',     title: 'Inventory'  },
        { name: 'invoices',      title: 'Invoices'   },
        { name: 'reports',       title: 'Reports'    },
        { name: 'notifications', title: 'Alerts'     },
        { name: 'profile',       title: 'Profile'    },
      ];

    case 'consultant':
      return [
        { name: 'dashboard',      title: 'Dashboard'     },
        { name: 'projects',       title: 'Projects'      },
        { name: 'instructions',   title: 'Instructions'  },
        { name: 'notifications',  title: 'Alerts'        },
        { name: 'profile',        title: 'Profile'       },
      ];

    default: // contractor, viewer
      return [
        { name: 'dashboard',     title: 'Dashboard'  },
        { name: 'projects',      title: 'Projects'   },
        { name: 'schedule',      title: 'Schedule'   },
        { name: 'attendance',    title: 'Attendance' },
        { name: 'notifications', title: 'Alerts'     },
        { name: 'profile',       title: 'Profile'    },
      ];
  }
}

/** The tab bar for a role, minus any tab whose data the API refuses that role. */
export function tabsForRole(role: UserRole): TabConfig[] {
  return baseTabsForRole(role).filter((t) => roleCanLoadTab(role, t.name));
}
