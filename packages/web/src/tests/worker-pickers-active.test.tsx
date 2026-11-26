/**
 * The attendance and labour forms offer only active workers: the API refuses
 * to record either for a worker who is not active (422 WORKER_INACTIVE). The
 * site worker list itself still returns inactive workers (the site page shows
 * them), so the forms filter it.
 */
import type { ComponentType } from 'react';
import { act, render, screen, within } from '@testing-library/react';

const mockSiteWorkers = jest.fn();

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  }
  return {
    ApiError,
    attendanceApi: { create: jest.fn() },
    labourApi: { create: jest.fn() },
    workerApi: { listSiteWorkers: (...a: unknown[]) => mockSiteWorkers(...a) },
  };
});

jest.mock('next/navigation', () => ({
  ...jest.requireActual('@/__mocks__/next/navigation'),
  useParams: jest.fn(() => ({ projectId: 'p1', siteId: 's1' })),
}));

import type { AuthUser, Worker } from '@/lib/types';
import { bookableWorkers } from '@/lib/worker-filters';
import { useAuthStore } from '@/store/auth.store';
import NewAttendancePage from '@/app/(app)/projects/[projectId]/sites/[siteId]/attendance/new/page';
import NewLabourEntryPage from '@/app/(app)/projects/[projectId]/sites/[siteId]/labour/new/page';

const worker = (id: string, firstName: string, o: Partial<Worker> = {}): Worker => ({
  id, companyId: 'c1', firstName, lastName: 'Test', email: null, phone: null, idNumber: null, trade: null,
  employmentStatus: 'active', isActive: true, emergencyContactName: null, emergencyContactPhone: null,
  notes: null, photoUrl: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  dailyWage: '1500', currency: 'KES',
  ...o,
});

const ACTIVE    = worker('w-active', 'Amani');
const INACTIVE  = worker('w-inactive', 'Baraka', { isActive: false, employmentStatus: 'inactive' });
const SUSPENDED = worker('w-suspended', 'Chege', { isActive: false, employmentStatus: 'suspended' });
// Registered with a non-active status: isActive was left true.
const REGISTERED_INACTIVE = worker('w-registered', 'Daudi', { isActive: true, employmentStatus: 'inactive' });

beforeEach(() => {
  mockSiteWorkers.mockReset();
  const user: AuthUser = {
    id: 'me', email: 'me@example.com', firstName: 'Me', lastName: 'User', role: 'site_supervisor', companyId: 'c1',
    currency: 'KES', canViewFinance: false, defaultProjectId: null, defaultSiteId: null,
  };
  useAuthStore.setState({ user, accessToken: 't', isHydrated: true });
});

async function renderPage(Page: ComponentType) {
  await act(async () => { render(<Page />); });
}

function workerOptions(): string[] {
  const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
  return within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value).filter(Boolean);
}

describe('bookableWorkers', () => {
  it('keeps only workers that are active with an active employment status', () => {
    expect(bookableWorkers([ACTIVE, INACTIVE, SUSPENDED, REGISTERED_INACTIVE]).map((w) => w.id)).toEqual(['w-active']);
  });

  it('does not hide a worker whose status fields are missing (the API still decides)', () => {
    expect(bookableWorkers([{ id: 'partial' } as Partial<Worker>])).toHaveLength(1);
  });
});

describe.each([
  ['attendance', NewAttendancePage],
  ['labour', NewLabourEntryPage],
] as const)('new %s form', (_name, Page) => {
  it('offers the active worker and not the inactive, suspended or registered-inactive ones', async () => {
    mockSiteWorkers.mockResolvedValue({ workers: [INACTIVE, ACTIVE, SUSPENDED, REGISTERED_INACTIVE] });
    await renderPage(Page);
    expect(mockSiteWorkers).toHaveBeenCalledWith('p1', 's1');
    expect(workerOptions()).toEqual(['w-active']);
    expect(screen.queryByText(/Baraka|Chege|Daudi/)).toBeNull();
  });

  it('says so when every assigned worker is inactive', async () => {
    mockSiteWorkers.mockResolvedValue({ workers: [INACTIVE, SUSPENDED] });
    await renderPage(Page);
    expect(workerOptions()).toEqual([]);
    expect(screen.getByText(/No active workers are assigned to this site/)).toBeInTheDocument();
  });

  it('keeps the usual message when no worker is assigned at all', async () => {
    mockSiteWorkers.mockResolvedValue({ workers: [] });
    await renderPage(Page);
    expect(screen.getByText(/No workers are assigned to this site yet/)).toBeInTheDocument();
    expect(screen.queryByText(/No active workers/)).toBeNull();
  });
});
