/**
 * Labour register: entries can be edited (company_admin, project_manager,
 * site_supervisor) and deleted after a confirmation (company_admin,
 * project_manager), mirroring labour.routes.ts. The daily rate field appears
 * only when the API returned a rate, i.e. for callers with financial access.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mockList = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: Record<string, string[]>) {
      super(message);
    }
  }
  return {
    ApiError,
    labourApi: {
      list: (...a: unknown[]) => mockList(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      delete: (...a: unknown[]) => mockDelete(...a),
    },
  };
});

jest.mock('next/navigation', () => ({
  ...jest.requireActual('@/__mocks__/next/navigation'),
  useParams: jest.fn(() => ({ projectId: 'p1', siteId: 's1' })),
}));

import { ApiError } from '@/lib/api';
import type { AuthUser, LabourEntry, UserRole } from '@/lib/types';
import LabourPage from '@/app/(app)/projects/[projectId]/sites/[siteId]/labour/page';
import { canDeleteLabour, canEditLabour } from '@/components/workflows/LabourEntryDialogs';
import { useAuthStore } from '@/store/auth.store';

const asUser = (role: UserRole, canViewFinance = false) => {
  const user: AuthUser = {
    id: 'me', email: 'me@example.com', firstName: 'Me', lastName: 'User', role, companyId: 'c1',
    currency: 'KES', canViewFinance, defaultProjectId: null, defaultSiteId: null,
  };
  useAuthStore.setState({ user, accessToken: 't', isHydrated: true });
};

/** Without `finance`, the entry is shaped as the API sends it to non-finance callers (no rate). */
const entry = (o: Partial<LabourEntry> = {}, finance = false): LabourEntry => ({
  id: 'e1', companyId: 'c1', projectId: 'p1', siteId: 's1', workerId: 'w1', registeredById: 'me',
  date: '2026-11-05', hoursWorked: '8.00', notes: 'Formwork',
  createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z',
  worker: { id: 'w1', firstName: 'Juma', lastName: 'Otieno', trade: 'Mason' },
  registeredBy: { id: 'me', firstName: 'Me', lastName: 'User' },
  ...(finance ? { dailyRate: '1500.00', currency: 'KES' } : {}),
  ...o,
});

const apiError = (status: number, message: string, details?: Record<string, string[]>) =>
  new (ApiError as unknown as new (s: number, c: string, m: string, d?: Record<string, string[]>) => Error)(status, 'X', message, details);

beforeEach(() => {
  mockList.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
});

const EDIT = 'Edit entry for Juma Otieno';
const DEL  = 'Delete entry for Juma Otieno';

describe('Edit labour entry', () => {
  it('saves hours and notes and updates the row (no rate field without finance access)', async () => {
    asUser('site_supervisor');
    mockList.mockResolvedValue({ entries: [entry()] });
    mockUpdate.mockResolvedValue({ entry: entry({ hoursWorked: '6.00', notes: 'Half day' }) });

    render(<LabourPage />);
    fireEvent.click(await screen.findByRole('button', { name: EDIT }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(/Daily rate/)).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Hours worked'), { target: { value: '6' } });
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Half day' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    });

    expect(mockUpdate).toHaveBeenCalledWith('p1', 's1', 'e1', { hoursWorked: 6, notes: 'Half day' });
    expect(await screen.findByText('Labour entry updated.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('6h')).toBeInTheDocument();
    expect(screen.getByText('Half day')).toBeInTheDocument();
    // No wage figures for a caller without financial access.
    expect(screen.queryByText(/KES/)).not.toBeInTheDocument();
  });

  it('offers the daily rate to a finance-capable editor and sends only a changed rate', async () => {
    asUser('company_admin', true);
    mockList.mockResolvedValue({ entries: [entry({}, true)] });
    mockUpdate.mockResolvedValue({ entry: entry({ dailyRate: '1800.00' }, true) });

    render(<LabourPage />);
    fireEvent.click(await screen.findByRole('button', { name: EDIT }));
    const dialog = screen.getByRole('dialog');
    const rate = within(dialog).getByLabelText('Daily rate (KES)');
    expect(rate).toHaveValue(1500);
    fireEvent.change(rate, { target: { value: '1800' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    });

    expect(mockUpdate).toHaveBeenCalledWith('p1', 's1', 'e1', { hoursWorked: 8, notes: 'Formwork', dailyRate: 1800 });
  });

  it('shows the API validation error and keeps the dialog open', async () => {
    asUser('project_manager');
    mockList.mockResolvedValue({ entries: [entry()] });
    mockUpdate.mockRejectedValue(apiError(422, 'Validation failed', { notes: ['String must contain at most 2000 character(s)'] }));

    render(<LabourPage />);
    fireEvent.click(await screen.findByRole('button', { name: EDIT }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    });

    expect(within(dialog).getByText(/Notes: String must contain at most 2000/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('rejects hours outside 0–24 without calling the API', async () => {
    asUser('site_supervisor');
    mockList.mockResolvedValue({ entries: [entry()] });

    render(<LabourPage />);
    fireEvent.click(await screen.findByRole('button', { name: EDIT }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Hours worked'), { target: { value: '25' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    });

    expect(within(dialog).getByText('Enter hours greater than 0 and no more than 24.')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('Delete labour entry', () => {
  it('asks for confirmation, deletes and removes the row', async () => {
    asUser('project_manager');
    mockList.mockResolvedValue({ entries: [entry()] });
    mockDelete.mockResolvedValue(undefined);

    render(<LabourPage />);
    fireEvent.click(await screen.findByRole('button', { name: DEL }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete entry' }));
    });

    expect(mockDelete).toHaveBeenCalledWith('p1', 's1', 'e1');
    expect(await screen.findByText('Labour entry deleted.')).toBeInTheDocument();
    expect(screen.queryByText('Juma Otieno')).not.toBeInTheDocument();
  });

  it('Cancel closes without deleting', async () => {
    asUser('company_admin', true);
    mockList.mockResolvedValue({ entries: [entry({}, true)] });

    render(<LabourPage />);
    fireEvent.click(await screen.findByRole('button', { name: DEL }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Juma Otieno')).toBeInTheDocument();
  });

  it('shows the API error and keeps the entry', async () => {
    asUser('company_admin', true);
    mockList.mockResolvedValue({ entries: [entry({}, true)] });
    mockDelete.mockRejectedValue(apiError(404, 'Labour entry not found'));

    render(<LabourPage />);
    fireEvent.click(await screen.findByRole('button', { name: DEL }));
    const dialog = screen.getByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete entry' }));
    });

    expect(within(dialog).getByText('This labour entry no longer exists. Refresh the list.')).toBeInTheDocument();
    expect(screen.getByText('Juma Otieno')).toBeInTheDocument();
  });
});

describe('Role gating', () => {
  it('site_supervisor can edit but not delete', async () => {
    asUser('site_supervisor');
    mockList.mockResolvedValue({ entries: [entry()] });
    render(<LabourPage />);
    expect(await screen.findByRole('button', { name: EDIT })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DEL })).not.toBeInTheDocument();
  });

  it('finance_officer sees the register with no edit or delete actions', async () => {
    asUser('finance_officer');
    mockList.mockResolvedValue({ entries: [entry({}, true)] });
    render(<LabourPage />);
    expect(await screen.findByText('Juma Otieno')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EDIT })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DEL })).not.toBeInTheDocument();
  });

  it('helpers match the API role lists', () => {
    expect(['company_admin', 'project_manager', 'site_supervisor'].every(canEditLabour)).toBe(true);
    expect(['super_admin', 'finance_officer', 'consultant', 'worker', 'contractor', 'viewer'].some(canEditLabour)).toBe(false);
    expect(['company_admin', 'project_manager'].every(canDeleteLabour)).toBe(true);
    expect(['site_supervisor', 'super_admin', 'finance_officer', 'consultant', 'worker'].some(canDeleteLabour)).toBe(false);
  });
});
