/**
 * Site attendance register: a record can be corrected or checked out
 * (company_admin, project_manager, site_supervisor) and deleted after a
 * confirmation (company_admin, project_manager), mirroring
 * attendance.routes.ts WRITE_ROLES / DELETE_ROLES.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mockList = jest.fn();
const mockSummary = jest.fn();
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
    attendanceApi: {
      list: (...a: unknown[]) => mockList(...a),
      summary: (...a: unknown[]) => mockSummary(...a),
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
import type { AttendanceRecord, AttendanceSummary, AuthUser, UserRole } from '@/lib/types';
import AttendancePage from '@/app/(app)/projects/[projectId]/sites/[siteId]/attendance/page';
import { canDeleteAttendance, canEditAttendance } from '@/components/workflows/AttendanceRecordDialogs';
import { useAuthStore } from '@/store/auth.store';

const asUser = (role: UserRole) => {
  const user: AuthUser = {
    id: 'me', email: 'me@example.com', firstName: 'Me', lastName: 'User', role, companyId: 'c1',
    currency: 'KES', canViewFinance: false, defaultProjectId: null, defaultSiteId: null,
  };
  useAuthStore.setState({ user, accessToken: 't', isHydrated: true });
};

const record = (o: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id: 'r1', companyId: 'c1', projectId: 'p1', siteId: 's1', workerId: 'w1',
  date: '2026-11-10', status: 'present', checkInTime: '07:30', checkOutTime: null, notes: null,
  recordedById: 'me', createdAt: '2026-11-10T05:00:00.000Z', updatedAt: '2026-11-10T05:00:00.000Z',
  worker: { id: 'w1', firstName: 'Juma', lastName: 'Otieno', trade: 'Mason' },
  recordedBy: { id: 'me', firstName: 'Me', lastName: 'User' },
  ...o,
});

const summary = (o: Partial<AttendanceSummary> = {}): { summary: AttendanceSummary; date: string } => ({
  summary: { total: 1, present: 1, absent: 0, late: 0, half_day: 0, excused: 0, ...o } as AttendanceSummary,
  date: '2026-11-10',
});

const apiError = (status: number, message: string, details?: Record<string, string[]>) =>
  new (ApiError as unknown as new (s: number, c: string, m: string, d?: Record<string, string[]>) => Error)(status, 'X', message, details);

beforeEach(() => {
  mockList.mockReset();
  mockSummary.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockSummary.mockResolvedValue(summary());
});

const EDIT = 'Edit attendance for Juma Otieno';
const DEL  = 'Delete attendance for Juma Otieno';

/** The table row for the worker (the header row is skipped). */
const workerRow = () => screen.getByText('Juma Otieno').closest('tr') as HTMLElement;

describe('Edit attendance record', () => {
  it('checks a worker out, corrects the status and notes, and refreshes the row and totals', async () => {
    asUser('site_supervisor');
    mockList.mockResolvedValue({ records: [record()] });
    mockUpdate.mockResolvedValue({
      record: record({ status: 'half_day', checkOutTime: '12:45', notes: 'Left at lunch' }),
    });

    render(<AttendancePage />);
    fireEvent.click(await screen.findByRole('button', { name: EDIT }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Juma Otieno · 10 Nov 2026/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Status')).toHaveValue('present');
    expect(within(dialog).getByLabelText('Check-in time')).toHaveValue('07:30');
    expect(within(dialog).getByLabelText('Check-out time')).toHaveValue('');

    mockSummary.mockResolvedValue(summary({ present: 0, half_day: 1 }));
    fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'half_day' } });
    fireEvent.change(within(dialog).getByLabelText('Check-out time'), { target: { value: '12:45' } });
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: '  Left at lunch ' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    });

    expect(mockUpdate).toHaveBeenCalledWith('p1', 's1', 'r1', {
      status: 'half_day', checkInTime: '07:30', checkOutTime: '12:45', notes: 'Left at lunch',
    });
    expect(await screen.findByText('Attendance record updated.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const row = workerRow();
    expect(within(row).getByText('Half Day')).toBeInTheDocument();
    expect(within(row).getByText('12:45')).toBeInTheDocument();
    expect(within(row).getByText('Left at lunch')).toBeInTheDocument();
    // The day totals are read again after the change (once on load, once after saving).
    expect(mockSummary).toHaveBeenCalledTimes(2);
  });

  it('sends null for a cleared time and for empty notes', async () => {
    asUser('project_manager');
    mockList.mockResolvedValue({ records: [record({ status: 'absent', notes: 'Sick' })] });
    mockUpdate.mockResolvedValue({ record: record({ status: 'absent', checkInTime: null, notes: null }) });

    render(<AttendancePage />);
    fireEvent.click(await screen.findByRole('button', { name: EDIT }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Check-in time'), { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    });

    expect(mockUpdate).toHaveBeenCalledWith('p1', 's1', 'r1', {
      status: 'absent', checkInTime: null, checkOutTime: null, notes: null,
    });
  });

  it('shows the API validation error and keeps the dialog open', async () => {
    asUser('company_admin');
    mockList.mockResolvedValue({ records: [record()] });
    mockUpdate.mockRejectedValue(apiError(422, 'Validation failed', { checkOutTime: ['Must be HH:MM'] }));

    render(<AttendancePage />);
    fireEvent.click(await screen.findByRole('button', { name: EDIT }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    });

    expect(within(dialog).getByText(/Check-out: Must be HH:MM/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Attendance record updated.')).not.toBeInTheDocument();
  });

  it('shows a refusal from the API and leaves the row unchanged', async () => {
    asUser('site_supervisor');
    mockList.mockResolvedValue({ records: [record()] });
    mockUpdate.mockRejectedValue(apiError(403, 'Insufficient permissions'));

    render(<AttendancePage />);
    fireEvent.click(await screen.findByRole('button', { name: EDIT }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'late' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    });

    expect(within(dialog).getByText('You do not have permission to change attendance records on this site.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(workerRow()).getByText('Present')).toBeInTheDocument();
    expect(mockSummary).toHaveBeenCalledTimes(1);
  });
});

describe('Delete attendance record', () => {
  it('asks for confirmation, deletes and removes the row', async () => {
    asUser('project_manager');
    mockList.mockResolvedValue({ records: [record()] });
    mockDelete.mockResolvedValue(undefined);

    render(<AttendancePage />);
    fireEvent.click(await screen.findByRole('button', { name: DEL }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();

    mockSummary.mockResolvedValue(summary({ total: 0, present: 0 }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete record' }));
    });

    expect(mockDelete).toHaveBeenCalledWith('p1', 's1', 'r1');
    expect(await screen.findByText('Attendance record deleted.')).toBeInTheDocument();
    expect(screen.queryByText('Juma Otieno')).not.toBeInTheDocument();
    expect(mockSummary).toHaveBeenCalledTimes(2);
  });

  it('Cancel closes without deleting', async () => {
    asUser('company_admin');
    mockList.mockResolvedValue({ records: [record()] });

    render(<AttendancePage />);
    fireEvent.click(await screen.findByRole('button', { name: DEL }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Juma Otieno')).toBeInTheDocument();
  });

  it('shows the API error and keeps the record', async () => {
    asUser('company_admin');
    mockList.mockResolvedValue({ records: [record()] });
    mockDelete.mockRejectedValue(apiError(404, 'Attendance record not found'));

    render(<AttendancePage />);
    fireEvent.click(await screen.findByRole('button', { name: DEL }));
    const dialog = screen.getByRole('alertdialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete record' }));
    });

    expect(within(dialog).getByText('This attendance record no longer exists. Refresh the list.')).toBeInTheDocument();
    expect(screen.getByText('Juma Otieno')).toBeInTheDocument();
  });
});

describe('Role gating', () => {
  it('site_supervisor can edit but not delete', async () => {
    asUser('site_supervisor');
    mockList.mockResolvedValue({ records: [record()] });
    render(<AttendancePage />);
    expect(await screen.findByRole('button', { name: EDIT })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DEL })).not.toBeInTheDocument();
  });

  it('finance_officer sees the register with no edit or delete actions', async () => {
    asUser('finance_officer');
    mockList.mockResolvedValue({ records: [record()] });
    render(<AttendancePage />);
    expect(await screen.findByText('Juma Otieno')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EDIT })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DEL })).not.toBeInTheDocument();
  });

  it('helpers match the API role lists', () => {
    expect(['company_admin', 'project_manager', 'site_supervisor'].every(canEditAttendance)).toBe(true);
    expect(['super_admin', 'finance_officer', 'consultant', 'worker', 'contractor', 'viewer'].some(canEditAttendance)).toBe(false);
    expect(['company_admin', 'project_manager'].every(canDeleteAttendance)).toBe(true);
    expect(['site_supervisor', 'super_admin', 'finance_officer', 'consultant', 'worker', 'contractor', 'viewer'].some(canDeleteAttendance)).toBe(false);
    expect(canEditAttendance(undefined)).toBe(false);
    expect(canDeleteAttendance(null)).toBe(false);
  });
});
