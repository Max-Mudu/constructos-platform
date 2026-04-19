import { getVisibleNavItems, NAV_ITEMS } from '@/components/sidebar/nav-config';
import { UserRole } from '@/lib/types';

// ─── Helper ───────────────────────────────────────────────────────────────────

function labels(role: UserRole, canViewFinance = false): string[] {
  return getVisibleNavItems(role, canViewFinance).map((i) => i.label);
}

// ─── Roles that see everything (minus finance gate) ───────────────────────────

describe('getVisibleNavItems — company_admin', () => {
  it('sees Dashboard', () => {
    expect(labels('company_admin')).toContain('Dashboard');
  });

  it('sees Projects', () => {
    expect(labels('company_admin')).toContain('Projects');
  });

  it('sees Budget', () => {
    expect(labels('company_admin')).toContain('Budget');
  });

  it('sees Invoices', () => {
    expect(labels('company_admin')).toContain('Invoices');
  });

  it('sees Audit Logs', () => {
    expect(labels('company_admin')).toContain('Audit Logs');
  });

  it('sees Settings', () => {
    expect(labels('company_admin')).toContain('Settings');
  });

  it('does NOT see Client Finance when canViewFinance=false', () => {
    expect(labels('company_admin', false)).not.toContain('Client Finance');
  });

  it('DOES see Client Finance when canViewFinance=true', () => {
    expect(labels('company_admin', true)).toContain('Client Finance');
  });
});

// ─── finance_officer ──────────────────────────────────────────────────────────

describe('getVisibleNavItems — finance_officer', () => {
  it('sees Budget', () => {
    expect(labels('finance_officer')).toContain('Budget');
  });

  it('sees Invoices', () => {
    expect(labels('finance_officer')).toContain('Invoices');
  });

  it('does NOT see Client Finance without canViewFinance', () => {
    expect(labels('finance_officer', false)).not.toContain('Client Finance');
  });

  it('sees Client Finance with canViewFinance=true', () => {
    expect(labels('finance_officer', true)).toContain('Client Finance');
  });

  it('does NOT see Labour (site operations)', () => {
    expect(labels('finance_officer')).not.toContain('Labour');
  });

  it('does NOT see Audit Logs', () => {
    expect(labels('finance_officer')).not.toContain('Audit Logs');
  });

  it('does NOT see Settings', () => {
    expect(labels('finance_officer')).not.toContain('Settings');
  });
});

// ─── project_manager ──────────────────────────────────────────────────────────

describe('getVisibleNavItems — project_manager', () => {
  it('sees Dashboard, Projects, Labour, Attendance', () => {
    const v = labels('project_manager');
    expect(v).toContain('Dashboard');
    expect(v).toContain('Projects');
    expect(v).toContain('Labour');
    expect(v).toContain('Attendance');
  });

  it('sees Budget', () => {
    expect(labels('project_manager')).toContain('Budget');
  });

  it('does NOT see Client Finance regardless of canViewFinance', () => {
    // project_manager role is not in Client Finance's roles array
    expect(labels('project_manager', true)).not.toContain('Client Finance');
  });

  it('does NOT see Audit Logs', () => {
    expect(labels('project_manager')).not.toContain('Audit Logs');
  });

  it('does NOT see Settings', () => {
    expect(labels('project_manager')).not.toContain('Settings');
  });
});

// ─── site_supervisor ──────────────────────────────────────────────────────────

describe('getVisibleNavItems — site_supervisor', () => {
  it('sees Dashboard, Projects, Labour, Attendance, Daily Targets', () => {
    const v = labels('site_supervisor');
    expect(v).toContain('Dashboard');
    expect(v).toContain('Labour');
    expect(v).toContain('Attendance');
    expect(v).toContain('Daily Targets');
  });

  it('does NOT see Budget', () => {
    expect(labels('site_supervisor')).not.toContain('Budget');
  });

  it('does NOT see Invoices', () => {
    expect(labels('site_supervisor')).not.toContain('Invoices');
  });

  it('does NOT see Client Finance even with canViewFinance=true', () => {
    expect(labels('site_supervisor', true)).not.toContain('Client Finance');
  });

  it('does NOT see Contractors management', () => {
    expect(labels('site_supervisor')).not.toContain('Contractors');
  });
});

// ─── contractor ───────────────────────────────────────────────────────────────

describe('getVisibleNavItems — contractor', () => {
  it('sees Dashboard, Projects, Contractors, Invoices', () => {
    const v = labels('contractor');
    expect(v).toContain('Dashboard');
    expect(v).toContain('Projects');
    expect(v).toContain('Contractors');
    expect(v).toContain('Invoices');
  });

  it('does NOT see Labour', () => {
    expect(labels('contractor')).not.toContain('Labour');
  });

  it('does NOT see Budget', () => {
    expect(labels('contractor')).not.toContain('Budget');
  });

  it('does NOT see Client Finance', () => {
    expect(labels('contractor', true)).not.toContain('Client Finance');
  });

  it('does NOT see Audit Logs or Settings', () => {
    const v = labels('contractor');
    expect(v).not.toContain('Audit Logs');
    expect(v).not.toContain('Settings');
  });
});

// ─── consultant ───────────────────────────────────────────────────────────────

describe('getVisibleNavItems — consultant', () => {
  it('sees Dashboard, Projects, Consultants, Drawings', () => {
    const v = labels('consultant');
    expect(v).toContain('Dashboard');
    expect(v).toContain('Projects');
    expect(v).toContain('Consultants');
    expect(v).toContain('Drawings');
  });

  it('does NOT see Labour or Attendance', () => {
    const v = labels('consultant');
    expect(v).not.toContain('Labour');
    expect(v).not.toContain('Attendance');
  });

  it('does NOT see Client Finance', () => {
    expect(labels('consultant', true)).not.toContain('Client Finance');
  });
});

// ─── worker ───────────────────────────────────────────────────────────────────

describe('getVisibleNavItems — worker', () => {
  it('sees Dashboard, Attendance', () => {
    const v = labels('worker');
    expect(v).toContain('Dashboard');
    expect(v).toContain('Attendance');
  });

  it('does NOT see Labour registration', () => {
    expect(labels('worker')).not.toContain('Labour');
  });

  it('does NOT see Budget, Invoices, or Finance', () => {
    const v = labels('worker');
    expect(v).not.toContain('Budget');
    expect(v).not.toContain('Invoices');
    expect(v).not.toContain('Client Finance');
  });
});

// ─── viewer ───────────────────────────────────────────────────────────────────

describe('getVisibleNavItems — viewer', () => {
  it('sees Dashboard and Projects', () => {
    const v = labels('viewer');
    expect(v).toContain('Dashboard');
    expect(v).toContain('Projects');
  });

  it('does NOT see operational or finance items', () => {
    const v = labels('viewer');
    expect(v).not.toContain('Labour');
    expect(v).not.toContain('Budget');
    expect(v).not.toContain('Invoices');
    expect(v).not.toContain('Client Finance');
    expect(v).not.toContain('Settings');
  });
});

// ─── Finance gate is role-AND-flag ────────────────────────────────────────────

describe('Client Finance gate — requiresFinance enforcement', () => {
  const financeRoles: UserRole[] = ['company_admin', 'finance_officer'];
  const nonFinanceRoles: UserRole[] = [
    'project_manager', 'site_supervisor', 'contractor',
    'consultant', 'worker', 'viewer',
  ];

  it.each(financeRoles)(
    '%s with canViewFinance=true sees Client Finance',
    (role) => {
      expect(labels(role, true)).toContain('Client Finance');
    },
  );

  it.each(financeRoles)(
    '%s with canViewFinance=false does NOT see Client Finance',
    (role) => {
      expect(labels(role, false)).not.toContain('Client Finance');
    },
  );

  it.each(nonFinanceRoles)(
    '%s NEVER sees Client Finance even with canViewFinance=true',
    (role) => {
      expect(labels(role, true)).not.toContain('Client Finance');
    },
  );
});

// ─── Reports nav item ────────────────────────────────────────────────────────

describe('getVisibleNavItems — Reports', () => {
  const rolesWithReports: UserRole[] = [
    'company_admin', 'finance_officer', 'project_manager',
    'site_supervisor', 'contractor', 'consultant',
  ];
  const rolesWithoutReports: UserRole[] = ['worker', 'viewer'];

  it.each(rolesWithReports)(
    '%s sees Reports',
    (role) => {
      expect(labels(role)).toContain('Reports');
    },
  );

  it.each(rolesWithoutReports)(
    '%s does NOT see Reports',
    (role) => {
      expect(labels(role)).not.toContain('Reports');
    },
  );

  it('Reports is not finance-gated', () => {
    const reportsItem = NAV_ITEMS.find((i) => i.label === 'Reports');
    expect(reportsItem).toBeDefined();
    expect(reportsItem!.requiresFinance).toBe(false);
  });
});

// ─── Structural invariants ────────────────────────────────────────────────────

describe('NAV_ITEMS structural invariants', () => {
  it('every item has label, href, icon, and defined requiresFinance', () => {
    for (const item of NAV_ITEMS) {
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.href).toMatch(/^\//);
      expect(typeof item.icon).toBe('string');
      expect(typeof item.requiresFinance).toBe('boolean');
    }
  });

  it('items with requiresFinance=true also restrict to finance-capable roles', () => {
    const financeGated = NAV_ITEMS.filter((i) => i.requiresFinance);
    for (const item of financeGated) {
      // Must have explicit roles — null would mean all roles could see it (wrong)
      expect(item.roles).not.toBeNull();
      // Every allowed role must be company_admin or finance_officer
      for (const role of item.roles!) {
        expect(['company_admin', 'finance_officer']).toContain(role);
      }
    }
  });

  it('hrefs are unique', () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
