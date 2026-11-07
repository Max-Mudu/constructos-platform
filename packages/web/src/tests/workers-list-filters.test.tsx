/**
 * /workers list — Trade filter (options from the loaded workers) and the
 * "N of M shown" subtitle while any filter is active.
 */
import { fireEvent, render, screen } from '@testing-library/react';

const mockList = jest.fn();
jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  }
  return { ApiError, workerApi: { list: (...a: unknown[]) => mockList(...a) } };
});

import type { AuthUser, UserRole, Worker } from '@/lib/types';
import WorkersPage from '@/app/(app)/workers/page';
import { tradeOptions } from '@/lib/worker-filters';
import { useAuthStore } from '@/store/auth.store';

const worker = (id: string, firstName: string, trade: string | null, o: Partial<Worker> = {}): Worker => ({
  id, companyId: 'c1', firstName, lastName: 'Test', email: null, phone: null, idNumber: null, trade,
  employmentStatus: 'active', isActive: true, emergencyContactName: null, emergencyContactPhone: null,
  notes: null, photoUrl: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  ...o,
});

const asUser = (role: UserRole) => {
  const user: AuthUser = {
    id: 'me', email: 'me@example.com', firstName: 'Me', lastName: 'User', role, companyId: 'c1',
    currency: 'KES', canViewFinance: false, defaultProjectId: null, defaultSiteId: null,
  };
  useAuthStore.setState({ user, accessToken: 't', isHydrated: true });
};

beforeEach(() => {
  mockList.mockReset();
  asUser('company_admin');
});

describe('tradeOptions', () => {
  it('returns distinct, trimmed, case-insensitively sorted trades and skips blanks', () => {
    expect(tradeOptions([
      { trade: 'Welder' }, { trade: ' mason ' }, { trade: null }, { trade: '' }, { trade: 'Welder' }, { trade: 'Carpenter' },
    ])).toEqual([
      { label: 'Carpenter', value: 'Carpenter' },
      { label: 'mason', value: 'mason' },
      { label: 'Welder', value: 'Welder' },
    ]);
  });
});

describe('workers list Trade filter', () => {
  it('filters by trade and shows how many of the total are shown', async () => {
    mockList.mockResolvedValue({ workers: [
      worker('w1', 'Amina', 'Mason'),
      worker('w2', 'Baraka', 'Welder'),
      worker('w3', 'Chege', 'Mason'),
      worker('w4', 'Dida', null),
    ] });
    render(<WorkersPage />);
    await screen.findByText('Amina Test');
    expect(screen.getByText('4 registered')).toBeInTheDocument();

    const select = screen.getByRole('combobox', { name: 'Trade' });
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'Mason', 'Welder']);

    fireEvent.change(select, { target: { value: 'Mason' } });
    expect(screen.getByText('Amina Test')).toBeInTheDocument();
    expect(screen.getByText('Chege Test')).toBeInTheDocument();
    expect(screen.queryByText('Baraka Test')).not.toBeInTheDocument();
    expect(screen.queryByText('Dida Test')).not.toBeInTheDocument();
    expect(screen.getByText('2 of 4 shown')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: '' } });
    expect(screen.getByText('Dida Test')).toBeInTheDocument();
    expect(screen.getByText('4 registered')).toBeInTheDocument();
  });

  it('combines with the status filter and shows the no-match state without the Add action', async () => {
    mockList.mockResolvedValue({ workers: [
      worker('w1', 'Amina', 'Mason'),
      worker('w2', 'Baraka', 'Welder', { employmentStatus: 'suspended', isActive: false }),
    ] });
    render(<WorkersPage />);
    await screen.findByText('Amina Test');

    fireEvent.change(screen.getByRole('combobox', { name: 'Trade' }), { target: { value: 'Mason' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'suspended' } });
    expect(screen.getByText('No workers match your filter')).toBeInTheDocument();
    expect(screen.getByText('0 of 2 shown')).toBeInTheDocument();
    // Only the header action; the empty state offers no "Add Worker" while filtering.
    expect(screen.getAllByRole('link', { name: /add worker/i })).toHaveLength(1);
  });

  it('hides the Trade filter when no worker has a trade', async () => {
    mockList.mockResolvedValue({ workers: [worker('w1', 'Amina', null)] });
    render(<WorkersPage />);
    await screen.findByText('Amina Test');
    expect(screen.queryByRole('combobox', { name: 'Trade' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  });
});
