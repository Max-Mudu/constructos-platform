/**
 * Site inventory: "Low-stock level" sets, changes or removes an item's
 * low-stock level through PATCH /inventory/:id, shows the API's error, and is
 * offered only to the roles the API accepts (inventory.routes.ts WRITE_ROLES:
 * company_admin, project_manager, site_supervisor).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mockList = jest.fn();
const mockGet = jest.fn();
const mockSetLevel = jest.fn();

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
      setLowStockLevel: (...a: unknown[]) => mockSetLevel(...a),
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
import { canSetLowStockLevel, lowStockLevelErrorMessage } from '@/components/workflows/LowStockLevelDialog';
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
  mockSetLevel.mockReset();
  mockGet.mockReturnValue(new Promise(() => {}));
});

const OPEN = 'Set low-stock level for Cement';
const FIELD = 'Low-stock level (bags)';

async function openDialog() {
  render(<InventoryPage />);
  fireEvent.click(await screen.findByRole('button', { name: OPEN }));
  return screen.getByRole('dialog');
}

describe('Set low-stock level', () => {
  it('saves a level, reports it and reloads the list so the item is flagged', async () => {
    asUser('site_supervisor');
    mockList
      .mockResolvedValueOnce({ inventory: [item()] })
      .mockResolvedValue({ inventory: [item({ lowStockThreshold: '50.000' })] });
    mockSetLevel.mockResolvedValue({ item: { ...item({ lowStockThreshold: '50.000' }), isLowStock: true } });

    const dialog = await openDialog();
    expect(within(dialog).getByText(/No level is set/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Remove level' })).not.toBeInTheDocument();
    expect(screen.queryByText('Low Stock')).not.toBeInTheDocument();
    // Opening the dialog from the row does not also open the item detail panel.
    expect(mockGet).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(FIELD), { target: { value: '50' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save level' }));
    });

    expect(mockSetLevel).toHaveBeenCalledWith('p1', 's1', 'inv1', 50);
    expect(await screen.findByText('Low-stock level for Cement set to 50 bags. It is now at or below that level.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Low Stock')).toBeInTheDocument();
    expect(screen.getByText(/1 item is at or below the low-stock threshold/)).toBeInTheDocument();
  });

  it('pre-fills the current level and accepts 0', async () => {
    asUser('project_manager');
    mockList.mockResolvedValue({ inventory: [item({ lowStockThreshold: '12.500' })] });
    mockSetLevel.mockResolvedValue({ item: { ...item({ lowStockThreshold: '0.000' }), isLowStock: false } });

    const dialog = await openDialog();
    const field = within(dialog).getByLabelText(FIELD);
    expect(field).toHaveValue(12.5);
    fireEvent.change(field, { target: { value: '0' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save level' }));
    });

    expect(mockSetLevel).toHaveBeenCalledWith('p1', 's1', 'inv1', 0);
    expect(await screen.findByText('Low-stock level for Cement set to 0 bags.')).toBeInTheDocument();
  });

  it('removes an existing level by sending null', async () => {
    asUser('company_admin');
    mockList.mockResolvedValue({ inventory: [item({ lowStockThreshold: '50.000' })] });
    mockSetLevel.mockResolvedValue({ item: { ...item(), isLowStock: false } });

    const dialog = await openDialog();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove level' }));
    });

    expect(mockSetLevel).toHaveBeenCalledWith('p1', 's1', 'inv1', null);
    expect(await screen.findByText('Low-stock level for Cement removed.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['', 'Enter a level of 0 or more.'],
    ['-1', 'Enter a level of 0 or more.'],
    ['1.2345', 'Use at most 3 decimal places.'],
    ['1000000000', 'The level is too large.'],
  ])('rejects "%s" without calling the API', async (value, message) => {
    asUser('site_supervisor');
    mockList.mockResolvedValue({ inventory: [item()] });

    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(FIELD), { target: { value } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save level' }));
    });

    expect(within(dialog).getByText(message)).toBeInTheDocument();
    expect(mockSetLevel).not.toHaveBeenCalled();
  });

  it('shows the message from the API when the request is refused and keeps the dialog open', async () => {
    asUser('site_supervisor');
    mockList.mockResolvedValue({ inventory: [item()] });
    mockSetLevel.mockRejectedValue(apiError(422, 'threshold must be 0 or greater'));

    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(FIELD), { target: { value: '5' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save level' }));
    });

    expect(within(dialog).getByText('threshold must be 0 or greater')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('Cancel closes without saving', async () => {
    asUser('project_manager');
    mockList.mockResolvedValue({ inventory: [item()] });

    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockSetLevel).not.toHaveBeenCalled();
  });
});

describe('Role gating', () => {
  it.each(['company_admin', 'project_manager', 'site_supervisor'] as UserRole[])('%s is offered the action', async (role) => {
    asUser(role);
    mockList.mockResolvedValue({ inventory: [item()] });
    render(<InventoryPage />);
    expect(await screen.findByRole('button', { name: OPEN })).toBeInTheDocument();
  });

  it('finance_officer sees the inventory without the action', async () => {
    asUser('finance_officer');
    mockList.mockResolvedValue({ inventory: [item()] });
    render(<InventoryPage />);
    expect(await screen.findByText('Cement')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: OPEN })).not.toBeInTheDocument();
  });

  it('helper matches the API role list', () => {
    expect(['company_admin', 'project_manager', 'site_supervisor'].every(canSetLowStockLevel)).toBe(true);
    expect(['super_admin', 'finance_officer', 'consultant', 'worker', 'contractor', 'viewer'].some(canSetLowStockLevel)).toBe(false);
    expect(canSetLowStockLevel(undefined)).toBe(false);
  });
});

describe('lowStockLevelErrorMessage', () => {
  it('maps refusals and missing items, and falls back for unknown errors', () => {
    expect(lowStockLevelErrorMessage(apiError(403, 'Insufficient permissions')))
      .toBe('You do not have permission to change the low-stock level on this site.');
    expect(lowStockLevelErrorMessage(apiError(404, 'Inventory item not found')))
      .toBe('This inventory item no longer exists. Refresh the list.');
    expect(lowStockLevelErrorMessage(new Error('boom'))).toBe('The low-stock level could not be saved.');
  });
});
