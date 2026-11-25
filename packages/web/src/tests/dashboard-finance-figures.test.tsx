/**
 * Dashboard and Invoices money figures:
 *  - no inflow / Net Position figure is shown (inflows are not recorded in the
 *    product), even if an older API build still sends one;
 *  - "Outstanding" counts only invoices that are owed (not draft, not
 *    cancelled, not disputed); disputed balances are shown separately as
 *    "In Dispute"; every money figure is shown per currency, never one sum
 *    across currencies or in a hard-coded "$".
 */
import { render, screen } from '@testing-library/react';

const api = {
  dashboardGet: jest.fn(),
  activityList: jest.fn(),
  invoiceList:  jest.fn(),
};

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  }
  return {
    ApiError,
    dashboardApi: { get:  (...a: unknown[]) => api.dashboardGet(...a) },
    activityApi:  { list: (...a: unknown[]) => api.activityList(...a) },
    invoiceApi:   { list: (...a: unknown[]) => api.invoiceList(...a) },
  };
});

jest.mock('@/hooks/useSSEEvent', () => ({ useSSEEvent: jest.fn() }));

import type { AuthUser, DashboardStats, InvoiceListItem, InvoiceStatus } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { formatMoney } from '@/lib/utils';
import DashboardPage from '@/app/(app)/dashboard/page';
import InvoicesPage from '@/app/(app)/invoices/page';

const COMPACT: Intl.NumberFormatOptions = { notation: 'compact', maximumFractionDigits: 1 };
const money = (v: number, c: string) => formatMoney(v, c, COMPACT);

function signIn(role: AuthUser['role'] = 'company_admin') {
  const user: AuthUser = {
    id: 'me', email: 'me@example.com', firstName: 'Me', lastName: 'User', role, companyId: 'c1',
    currency: 'KES', canViewFinance: true, defaultProjectId: null, defaultSiteId: null,
  };
  useAuthStore.setState({ user, accessToken: 't', isHydrated: true });
}

/** The value element rendered just above a KPI label (MiniStat / StatCard). */
function valueAbove(label: HTMLElement): string {
  return (label.previousElementSibling as HTMLElement | null)?.textContent ?? '';
}

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.activityList.mockResolvedValue({ activities: [] });
  signIn();
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

function dashboardStats(): DashboardStats & { finance?: unknown } {
  return {
    projects:   { total: 1, active: 1, onHold: 0, planning: 0, completed: 0, archived: 0, recent: [] },
    workers:    { total: 0, active: 0 },
    attendance: { todayTotal: 0, todayPresent: 0, todayRate: 0 },
    labour:     { thisWeekHours: 0, thisMonthCost: 0, thisMonthCostByCurrency: [] },
    invoices: {
      total: 10, totalValue: 255000, totalPaid: 136500, outstanding: 52000, inDispute: 64000, overdueCount: 1, pendingApproval: 1,
      byCurrency: [
        { currency: 'KES', totalValue: 255000, totalPaid: 136500, outstanding: 52000, inDispute: 64000 },
        { currency: 'USD', totalValue: 350,    totalPaid: 0,      outstanding: 300,   inDispute: 0 },
      ],
    },
    budget:        { totalBudgeted: 0, totalSpent: 0, totalRemaining: 0, budgetsCount: 0, overspendCount: 0 },
    deliveries:    { thisMonthCount: 0, pendingInspectionCount: 0, totalCount: 0 },
    contractors:   { total: 0, activeSchedules: 0 },
    instructions:  { open: 0, critical: 0 },
    notifications: { unread: 0 },
    // What an older API build sends: it must not be shown.
    finance: { totalInflows: 500000, inflowsThisMonth: 500000, netPosition: 383850 },
  } as DashboardStats & { finance?: unknown };
}

describe('Dashboard', () => {
  it('shows no inflow or Net Position figure, even when the API sends one', async () => {
    api.dashboardGet.mockResolvedValue({ stats: dashboardStats() });
    render(<DashboardPage />);
    await screen.findByText('Invoices');

    expect(screen.queryByText('Net Position')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Inflows')).not.toBeInTheDocument();
    expect(screen.queryByText('Client Finance')).not.toBeInTheDocument();
    expect(screen.queryByText(money(383850, 'KES'))).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/finance"]')).toBeNull();
  });

  it('shows invoice Total, Paid and Outstanding per currency', async () => {
    api.dashboardGet.mockResolvedValue({ stats: dashboardStats() });
    render(<DashboardPage />);
    await screen.findByText('Invoices');

    expect(valueAbove(screen.getByText('Outstanding'))).toBe(`${money(52000, 'KES')} + ${money(300, 'USD')}`);
    expect(valueAbove(screen.getByText('In Dispute'))).toBe(`${money(64000, 'KES')} + ${money(0, 'USD')}`);
    expect(valueAbove(screen.getByText('Paid'))).toBe(`${money(136500, 'KES')} + ${money(0, 'USD')}`);
    // A collection rate across two currencies would mix them: not shown.
    expect(screen.queryByText('Collection rate')).not.toBeInTheDocument();
  });

  it('keeps the single company-currency figure when the API sends no breakdown', async () => {
    const stats = dashboardStats();
    delete (stats.invoices as { byCurrency?: unknown }).byCurrency;
    api.dashboardGet.mockResolvedValue({ stats });
    render(<DashboardPage />);
    await screen.findByText('Invoices');

    expect(valueAbove(screen.getByText('Outstanding'))).toBe(money(52000, 'KES'));
    expect(valueAbove(screen.getByText('In Dispute'))).toBe(money(64000, 'KES'));
    expect(screen.getByText('Collection rate')).toBeInTheDocument();
  });

  it('still shows no invoice money to a user the API withholds it from', async () => {
    signIn('project_manager');
    const stats = dashboardStats();
    stats.invoices = {
      total: null, totalValue: null, totalPaid: null, outstanding: null, inDispute: null,
      overdueCount: null, pendingApproval: null, byCurrency: null,
    } as unknown as DashboardStats['invoices'];
    delete (stats as { finance?: unknown }).finance;
    api.dashboardGet.mockResolvedValue({ stats });
    render(<DashboardPage />);
    await screen.findByText('Projects');

    expect(screen.queryByText('Outstanding')).not.toBeInTheDocument();
    expect(screen.queryByText('In Dispute')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoices')).not.toBeInTheDocument();
  });
});

// ─── Invoices page KPI strip ─────────────────────────────────────────────────

let seq = 0;
function invoice(status: InvoiceStatus, total: number, paid: number, currency: string): InvoiceListItem {
  seq += 1;
  return {
    id: `inv-${seq}`, companyId: 'c1', projectId: 'p1', invoiceNumber: `INV-${seq}`,
    vendorType: 'contractor', vendorName: 'Vendor', totalAmount: total.toFixed(2), paidAmount: paid.toFixed(2),
    currency, issueDate: '2026-11-01', dueDate: '2099-12-31', status, createdAt: '2026-11-01T00:00:00.000Z',
    project: { id: 'p1', name: 'Tower', code: null }, site: null, contractor: null, supplier: null,
    payments: [], _count: { lineItems: 0 },
  };
}

describe('Invoices page KPIs', () => {
  const invoices = [
    invoice('draft',            1000,      0, 'KES'),
    invoice('cancelled',        2000,    500, 'KES'),
    invoice('submitted',        4000,      0, 'KES'),
    invoice('approved',         8000,      0, 'KES'),
    invoice('partially_paid',  16000,   6000, 'KES'),
    invoice('overdue',         32000,   2000, 'KES'),
    invoice('disputed',        64000,      0, 'KES'),
    invoice('paid',           128000, 128000, 'KES'),
    invoice('approved',          300,      0, 'USD'),
    invoice('draft',              50,      0, 'USD'),
  ];

  it('Outstanding counts owed invoices only and In Dispute is separate, one figure per currency', async () => {
    api.invoiceList.mockResolvedValue({ invoices });
    render(<InvoicesPage />);
    await screen.findByText('INV-1');

    const kpi = (label: string) => valueAbove(screen.getAllByText(label)[0]);
    expect(kpi('Outstanding')).toBe(`${money(52000, 'KES')} + ${money(300, 'USD')}`);
    expect(kpi('In Dispute')).toBe(`${money(64000, 'KES')} + ${money(0, 'USD')}`);
    expect(kpi('Total Value')).toBe(`${money(255000, 'KES')} + ${money(350, 'USD')}`);
    expect(kpi('Total Paid')).toBe(`${money(136500, 'KES')} + ${money(0, 'USD')}`);
    expect(document.body.textContent).not.toMatch(/\$0\.\dM/);
  });

  it('a single-currency list shows that currency, not "$"', async () => {
    api.invoiceList.mockResolvedValue({ invoices: [invoice('approved', 2_500_000, 0, 'KES')] });
    render(<InvoicesPage />);
    await screen.findByText(/^INV-/);

    expect(valueAbove(screen.getAllByText('Outstanding')[0])).toBe(money(2_500_000, 'KES'));
  });
});
