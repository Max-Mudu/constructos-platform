/**
 * Site inventory: "Adjust stock" posts to /inventory/:id/adjust with a
 * direction, quantity, reason and note, shows the API's error, and is offered
 * only to the roles the API accepts (company_admin, project_manager).
 * Adjustments in the item history are labelled with their reason.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockList = jest.fn();
const mockGet = jest.fn();
const mockUse = jest.fn();
const mockAdjust = jest.fn();

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
      adjust: (...a: unknown[]) => mockAdjust(...a),
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
import {
  adjustErrorMessage,
  adjustmentReasonLabel,
  canAdjustStock,
} from '@/components/workflows/AdjustStockDialog';
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
  mockAdjust.mockReset();
  mockGet.mockReturnValue(new Promise(() => {}));
});

async function openDialog() {
  render(<InventoryPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Adjust stock of Cement' }));
  return screen.getByRole('dialog');
}

async function save(dialog: HTMLElement) {
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save adjustment' }));
  });
}

describe('Adjust stock dialog', () => {
  it('submits an adjustment, shows the new stock and reloads the list', async () => {
    asUser('project_manager');
    mockList
      .mockResolvedValueOnce({ inventory: [item()] })
      .mockResolvedValueOnce({ inventory: [item({ currentQuantity: '43.500' })] });
    mockAdjust.mockResolvedValue({ item: { ...item({ currentQuantity: '43.500' }), isLowStock: false } });

    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Direction'), { target: { value: 'in' } });
    fireEvent.change(within(dialog).getByLabelText('Quantity (bags)'), { target: { value: '3.5' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'found' } });
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: ' Behind the store ' } });
    await save(dialog);

    expect(mockAdjust).toHaveBeenCalledWith('p1', 's1', 'inv1', {
      direction: 'in', quantity: 3.5, reason: 'found', note: 'Behind the store',
    });
    expect(await screen.findByText('Stock of Cement adjusted to 43.5 bags.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('43.5')).toBeInTheDocument();
  });

  it('shows the API error and keeps the dialog open', async () => {
    asUser('company_admin');
    mockList.mockResolvedValue({ inventory: [item()] });
    mockAdjust.mockRejectedValue(apiError(422, 'Insufficient stock: requested 40, available 38'));

    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Quantity (bags)'), { target: { value: '40' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'damaged' } });
    await save(dialog);

    expect(mockAdjust).toHaveBeenCalledWith('p1', 's1', 'inv1', { direction: 'out', quantity: 40, reason: 'damaged' });
    expect(await within(dialog).findByText('Insufficient stock: requested 40, available 38')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save adjustment' })).not.toBeDisabled();
  });

  it('requires a reason, and a note for "Other", before calling the API', async () => {
    asUser('company_admin');
    mockList.mockResolvedValue({ inventory: [item()] });

    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Quantity (bags)'), { target: { value: '2' } });
    await save(dialog);
    expect(within(dialog).getByText('Choose a reason.')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'other' } });
    await save(dialog);
    expect(within(dialog).getByText('Add a note explaining the adjustment.')).toBeInTheDocument();
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it('refuses an out above the current stock without calling the API', async () => {
    asUser('project_manager');
    mockList.mockResolvedValue({ inventory: [item()] });

    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText('Quantity (bags)'), { target: { value: '41' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'damaged' } });
    await save(dialog);

    expect(within(dialog).getByText('Only 40 bags in stock.')).toBeInTheDocument();
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it('is offered next to Record usage for managers', async () => {
    asUser('project_manager');
    mockList.mockResolvedValue({ inventory: [item()] });
    render(<InventoryPage />);
    expect(await screen.findByRole('button', { name: 'Adjust stock of Cement' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record usage of Cement' })).toBeInTheDocument();
  });

  it.each(['site_supervisor', 'finance_officer', 'consultant', 'worker', 'contractor', 'viewer'] as UserRole[])(
    'is hidden for %s',
    async (role) => {
      asUser(role);
      mockList.mockResolvedValue({ inventory: [item()] });
      render(<InventoryPage />);
      expect(await screen.findByText('Cement')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Adjust stock/ })).not.toBeInTheDocument();
    },
  );

  it('labels adjustments and their reason in the item history', async () => {
    asUser('project_manager');
    mockList.mockResolvedValue({ inventory: [item()] });
    mockGet.mockResolvedValue({
      item: {
        ...item(),
        transactions: [
          {
            id: 't1', type: 'adjustment_out', quantity: '-2.000', unitOfMeasure: 'bags', note: 'Split bags',
            usageReason: 'damaged', createdAt: '2026-11-02T10:00:00.000Z', delivery: null,
            performedBy: { id: 'u1', firstName: 'Pat', lastName: 'Manager' },
          },
          {
            id: 't2', type: 'adjustment_in', quantity: '1.000', unitOfMeasure: 'bags', note: null,
            usageReason: 'stock_count_correction', createdAt: '2026-11-01T10:00:00.000Z', delivery: null,
            performedBy: null,
          },
        ],
      },
    });
    render(<InventoryPage />);
    fireEvent.click(await screen.findByText('Cement'));

    expect(await screen.findByText('Adjustment Out')).toBeInTheDocument();
    expect(screen.getByText('Adjustment In')).toBeInTheDocument();
    expect(screen.getByText('Reason: Damaged')).toBeInTheDocument();
    expect(screen.getByText('Reason: Stock count correction')).toBeInTheDocument();
    expect(screen.getByText('-2 bags')).toBeInTheDocument();
    expect(screen.getByText('+1 bags')).toBeInTheDocument();
    expect(screen.getByText('Split bags')).toBeInTheDocument();
  });

  it('matches the API role list', () => {
    expect(['company_admin', 'project_manager'].every(canAdjustStock)).toBe(true);
    expect(['super_admin', 'site_supervisor', 'finance_officer', 'consultant', 'contractor', 'worker', 'viewer', undefined]
      .some((r) => canAdjustStock(r))).toBe(false);
  });

  it('words permission and missing-item errors and reason labels', () => {
    expect(adjustErrorMessage(apiError(403, 'Insufficient permissions'))).toMatch(/permission/);
    expect(adjustErrorMessage(apiError(404, 'Not found'))).toMatch(/no longer exists/);
    expect(adjustErrorMessage(new Error('boom'))).toBe('The adjustment could not be saved.');
    expect(adjustmentReasonLabel('lost_or_stolen')).toBe('Lost or stolen');
    expect(adjustmentReasonLabel('weird')).toBe('weird');
    expect(adjustmentReasonLabel(null)).toBeNull();
  });
});
