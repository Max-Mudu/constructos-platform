import { NAV_ITEMS, getVisibleNavItems } from '@/components/sidebar/nav-config';
import type { UserRole } from '@/lib/types';
import { roleCanEditDailyReports, roleCanViewDailyReports } from '@/lib/daily-report-types';

const labels = (role: UserRole, canViewFinance = false) => getVisibleNavItems(role, canViewFinance).map((i) => i.label);

describe('Daily Report nav item', () => {
  // consultant: read-only access approved 2026-11-06
  const allowed: UserRole[] = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'viewer', 'consultant'];
  const blocked: UserRole[] = ['contractor', 'worker'];

  it.each(allowed)('Daily Report is visible to %s', (role) => {
    expect(labels(role)).toContain('Daily Report');
    expect(labels(role, true)).toContain('Daily Report');
  });

  it.each(blocked)('Daily Report is hidden from %s', (role) => {
    expect(labels(role)).not.toContain('Daily Report');
    expect(labels(role, true)).not.toContain('Daily Report');
  });

  it('consultants pass the Daily Report screen gate but are never treated as editors', () => {
    expect(roleCanViewDailyReports('consultant')).toBe(true);
    expect(roleCanEditDailyReports('consultant')).toBe(false);
    for (const role of ['contractor', 'worker']) expect(roleCanViewDailyReports(role)).toBe(false);
  });

  it('Daily Report is a single /daily item, not finance-gated', () => {
    const items = NAV_ITEMS.filter((i) => i.href === '/daily');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: 'Daily Report', requiresFinance: false, icon: 'ClipboardPen' });
    expect(items[0].requiresFinancialPermission).toBeFalsy();
  });

  it('Daily Report sits at the top of the Site Operations group', () => {
    const idx = NAV_ITEMS.findIndex((i) => i.href === '/daily');
    expect(NAV_ITEMS[idx].group).toBe('Site Operations');
    expect(NAV_ITEMS[idx + 1].label).toBe('Labour');
  });
});
