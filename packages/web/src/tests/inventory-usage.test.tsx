/**
 * Site inventory: "Record usage" posts to /inventory/:id/use, shows the API's
 * error (e.g. insufficient stock) and is offered only to the roles the API
 * accepts (company_admin, project_manager, site_supervisor).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockList = jest.fn();
const mockGet = jest.fn();
const mockUse = jest.fn();

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: Record<string, string[]>) {
      super(message);
    }
  }
  return {
    ApiError,
    inventoryApi: {
      list: (...a: unknown[]) => mockList(...a),
      get: (...a: unknown[]) => mockGet(...a),
      recordUsage: (...a: unknown[]) => mockUse(...a),
    },
  };
});

jest.mock('next/navigation', () => ({
  ...jest.requireActual('@/__mocks__/next/navigation'),
  useParams: jest.fn(() => ({ projectId: 'p1', siteId: 's1' })),
}));

import { ApiError } from '@/lib/api';
import type { AuthUser, SiteInventoryItem, UserRole } from '@/lib/types';
import InventoryPage from '@/app/(app)/projects/[projectId]/sites/[siteId]/inventory/page';
import { canRecordUsage, usageErrorMessage } from '@/components/workflows/RecordUsageDialog';
import { useAuthStore } from '@/store/auth.store';

const asUser = (role: UserRole) => {
  const user: AuthUser = {
    id: 'me', email: 'me@example.com', firstName: 'Me', lastName: 'User', role, companyId: 'c1',
    currency: 'KES', canViewFinance: false, defaultProjectId: null, defaultSiteId: null,
  };
  useAuthStore.setState({ user, accessToken: 't', isHydrated: true });
};

const item = (o: Partial<SiteInventoryItem> = {}): SiteInventoryItem => ({
  id: 'inv1', companyId: 'c1', siteId: 's1', materialName: 'Cement', unitOfMeasure: 'bags',
  currentQuantity: '40.000', lowStockThreshold: null,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  site: { id: 's1', name: 'North Yard' },
  ...o,
});

const apiError = (status: number, message: string) =>
  new (ApiError as unknown as new (s: number, c: string, m: string) => Error)(status, 'X', message);

beforeEach(() => {
  mockList.mockReset();
  mockGet.mockReset();
  mockUse.mockReset();
  mockGet.mockReturnValue(new Promise(() => {}));
});

async function openDialog() {
  render(<InventoryPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Record usage of Cement' }));
  return screen.getByRole('dialog');
}

describe('Record usage dialog', () => {
  it('submits the usage, closes and reloads the list', async () => {
    asUser('site_supervisor');
    mockList
      .mockResolvedValueOnce({ inventory: [item()] })
      .mockResolvedValueOnce({ inventory: [item({ currentQuantity: '35.000' })] });
    mockUse.mockResolvedValue({ item: { ...item({ currentQuantity: '35.000' }), isLowStock: false } });

    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Quantity used (bags)'), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Slab pour' } });
    fireEvent.change(within(dialog).getByLabelText('Work area'), { target: { value: 'Block B' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record usage' }));
    });

    expect(mockUse).toHaveBeenCalledWith('p1', 's1', 'inv1', { quantity: 5, usageReason: 'Slab pour', workArea: 'Block B' });
    expect(await screen.findByText('Usage of Cement recorded.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('35')).toBeInTheDocument();
  });

  it('shows the API error and keeps the dialog open', async () => {
    asUser('project_manager');
    mockList.mockResolvedValue({ inventory: [item()] });
    mockUse.mockRejectedValue(apiError(422, 'Insufficient stock: requested 10, available 8'));

    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Quantity used (bags)'), { target: { value: '10' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record usage' }));
    });

    expect(await within(dialog).findByText('Insufficient stock: requested 10, available 8')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Record usage' })).not.toBeDisabled();
  });

  it('refuses a quantity above the current stock without calling the API', async () => {
    asUser('company_admin');
    mockList.mockResolvedValue({ inventory: [item()] });

    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Quantity used (bags)'), { target: { value: '41' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Record usage' }));
    });

    expect(within(dialog).getByText('Only 40 bags in stock.')).toBeInTheDocument();
    expect(mockUse).not.toHaveBeenCalled();
  });

  it.each(['finance_officer', 'consultant', 'worker', 'contractor', 'viewer'] as UserRole[])(
    'is hidden for %s',
    async (role) => {
      asUser(role);
      mockList.mockResolvedValue({ inventory: [item()] });
      render(<InventoryPage />);
      expect(await screen.findByText('Cement')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Record usage/ })).not.toBeInTheDocument();
    },
  );

  it('matches the API role list', () => {
    expect(['company_admin', 'project_manager', 'site_supervisor'].every(canRecordUsage)).toBe(true);
    expect(['super_admin', 'finance_officer', 'consultant', 'worker', undefined].some((r) => canRecordUsage(r))).toBe(false);
  });

  it('words permission and missing-item errors', () => {
    expect(usageErrorMessage(apiError(403, 'Insufficient permissions'))).toMatch(/permission/);
    expect(usageErrorMessage(apiError(404, 'Not found'))).toMatch(/no longer exists/);
    expect(usageErrorMessage(new Error('boom'))).toBe('The usage could not be recorded.');
  });
});
