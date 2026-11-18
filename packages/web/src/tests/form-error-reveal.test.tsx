/**
 * A refused save must be visible. The delivery, labour and attendance forms
 * show the API's refusal in a banner above the form while Save is at the
 * bottom; on a phone (and on the long delivery forms on any screen) the banner
 * was off-screen, so a refused save looked like a button that did nothing.
 * The banner is now scrolled into view and focused, and it is shown even when
 * the API only returned errors for fields rendered inline.
 *
 * The API refusals used here are the shapes the routes send: zod 422
 * `{ error: 'Validation failed', details }` and service errors with a message
 * only (ValidationError 422, ForbiddenError 403, ConflictError 409).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mockDeliveryCreate = jest.fn();
const mockDeliveryUpdate = jest.fn();
const mockDeliveryGet = jest.fn();
const mockAttendanceCreate = jest.fn();
const mockLabourCreate = jest.fn();
const mockSiteWorkers = jest.fn();
const mockAttendanceList = jest.fn();
const mockAttendanceUpdate = jest.fn();

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: Record<string, string[]>) {
      super(message);
    }
  }
  return {
    ApiError,
    deliveryApi: {
      create: (...a: unknown[]) => mockDeliveryCreate(...a),
      update: (...a: unknown[]) => mockDeliveryUpdate(...a),
      get: (...a: unknown[]) => mockDeliveryGet(...a),
    },
    supplierApi: { list: () => Promise.resolve({ suppliers: [] }) },
    attendanceApi: {
      create: (...a: unknown[]) => mockAttendanceCreate(...a),
      list: (...a: unknown[]) => mockAttendanceList(...a),
      summary: () => Promise.resolve({ summary: { total: 1, present: 1, absent: 0, late: 0, half_day: 0, excused: 0 }, date: '2026-11-18' }),
      update: (...a: unknown[]) => mockAttendanceUpdate(...a),
    },
    labourApi: { create: (...a: unknown[]) => mockLabourCreate(...a) },
    workerApi: { listSiteWorkers: (...a: unknown[]) => mockSiteWorkers(...a) },
  };
});

jest.mock('next/navigation', () => ({
  ...jest.requireActual('@/__mocks__/next/navigation'),
  useParams: jest.fn(() => ({ projectId: 'p1', siteId: 's1', deliveryId: 'd1' })),
}));

import { ApiError } from '@/lib/api';
import type { AuthUser, DeliveryRecord, UserRole, Worker } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import NewDeliveryPage from '@/app/(app)/projects/[projectId]/sites/[siteId]/deliveries/new/page';
import EditDeliveryPage from '@/app/(app)/projects/[projectId]/sites/[siteId]/deliveries/[deliveryId]/edit/page';
import NewAttendancePage from '@/app/(app)/projects/[projectId]/sites/[siteId]/attendance/new/page';
import NewLabourEntryPage from '@/app/(app)/projects/[projectId]/sites/[siteId]/labour/new/page';
import AttendancePage from '@/app/(app)/projects/[projectId]/sites/[siteId]/attendance/page';

const apiError = (status: number, message: string, details?: Record<string, string[]>) =>
  new (ApiError as unknown as new (s: number, c: string, m: string, d?: Record<string, string[]>) => Error)(
    status, status === 422 ? 'VALIDATION_ERROR' : 'X', message, details,
  );

const asUser = (role: UserRole) => {
  const user: AuthUser = {
    id: '11111111-1111-4111-8111-111111111111', email: 'me@example.com', firstName: 'Me', lastName: 'User', role,
    companyId: 'c1', currency: 'KES', canViewFinance: false, defaultProjectId: null, defaultSiteId: null,
  };
  useAuthStore.setState({ user, accessToken: 't', isHydrated: true });
};

const worker = { id: '22222222-2222-4222-8222-222222222222', firstName: 'Juma', lastName: 'Otieno', trade: 'Mason', dailyWage: null, currency: 'KES' } as unknown as Worker;

const delivery = (): DeliveryRecord => ({
  id: 'd1', supplierName: 'Bamburi', supplierContact: null, deliveryDate: '2026-11-17T00:00:00.000Z', deliveryTime: null,
  driverName: null, vehicleRegistration: null, purchaseOrderNumber: null, deliveryNoteNumber: null, invoiceNumber: null,
  itemDescription: 'Cement 50kg', unitOfMeasure: 'bags', quantityOrdered: '100', quantityDelivered: '100',
  conditionOnArrival: 'good', inspectionStatus: 'passed', acceptanceStatus: 'accepted', rejectionReason: null,
  discrepancyNotes: null, comments: null, receivedBy: { id: 'u1', firstName: 'Sam', lastName: 'Sup' },
  photos: [], documents: [], createdAt: '2026-11-17T08:00:00.000Z', updatedAt: '2026-11-17T08:00:00.000Z',
} as unknown as DeliveryRecord);

let scrolled: Element[];
beforeEach(() => {
  scrolled = [];
  // jsdom has no layout: record which element the page asks to bring into view.
  Element.prototype.scrollIntoView = jest.fn(function (this: Element) { scrolled.push(this); });
  [mockDeliveryCreate, mockDeliveryUpdate, mockDeliveryGet, mockAttendanceCreate, mockLabourCreate, mockSiteWorkers, mockAttendanceList, mockAttendanceUpdate]
    .forEach((m) => m.mockReset());
  mockSiteWorkers.mockResolvedValue({ workers: [worker] });
});

/** The banner with `text` was scrolled into view and holds the focus. */
function expectRevealed(text: string | RegExp) {
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(text);
  expect(scrolled.some((el) => el.contains(alert))).toBe(true);
  expect((document.activeElement as Element | null)?.contains(alert)).toBe(true);
}

async function submit(container: HTMLElement) {
  await act(async () => {
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  });
}

describe('New delivery', () => {
  it('brings a refused save into view (message-only refusal)', async () => {
    asUser('site_supervisor');
    mockDeliveryCreate.mockRejectedValue(apiError(403, 'receivedById must be a user in your company'));
    const { container } = render(<NewDeliveryPage />);
    await submit(container);
    expectRevealed('receivedById must be a user in your company');
  });

  it('lists a 422 detail for a field without an inline error, and reveals it', async () => {
    asUser('site_supervisor');
    mockDeliveryCreate.mockRejectedValue(apiError(422, 'Validation failed', { quantityOrdered: ['Number must be greater than 0'] }));
    const { container } = render(<NewDeliveryPage />);
    await submit(container);
    expectRevealed('Quantity ordered: Number must be greater than 0');
  });

  it('shows and reveals a banner when the only errors are inline ones', async () => {
    asUser('site_supervisor');
    mockDeliveryCreate.mockRejectedValue(apiError(422, 'Validation failed', { supplierName: ['String must contain at most 255 character(s)'] }));
    const { container } = render(<NewDeliveryPage />);
    await submit(container);
    expect(screen.getByText('String must contain at most 255 character(s)')).toBeInTheDocument();
    expectRevealed('Please correct the highlighted fields below.');
  });
});

describe('Edit delivery', () => {
  it('reveals a refusal of the acceptance change (e.g. rejecting a delivery already accepted into stock)', async () => {
    asUser('project_manager');
    mockDeliveryGet.mockResolvedValue({ delivery: delivery() });
    mockDeliveryUpdate.mockRejectedValue(apiError(409, 'This delivery has already been accepted into stock and cannot be rejected'));
    const { container } = render(<EditDeliveryPage />);
    await screen.findByText('Edit Delivery Record');
    await submit(container);
    expect(mockDeliveryUpdate).toHaveBeenCalledTimes(1);
    expectRevealed('already been accepted into stock');
  });

  it('reveals the error again when the same refusal repeats on a second save', async () => {
    asUser('project_manager');
    mockDeliveryGet.mockResolvedValue({ delivery: delivery() });
    mockDeliveryUpdate.mockRejectedValue(apiError(422, 'Validation failed', { quantityDelivered: ['Number must be greater than or equal to 0'] }));
    const { container } = render(<EditDeliveryPage />);
    await screen.findByText('Edit Delivery Record');
    await submit(container);
    expectRevealed('Quantity delivered: Number must be greater than or equal to 0');
    scrolled = [];
    (document.activeElement as HTMLElement | null)?.blur();
    await submit(container);
    expect(mockDeliveryUpdate).toHaveBeenCalledTimes(2);
    expectRevealed('Quantity delivered: Number must be greater than or equal to 0');
  });
});

describe('Add attendance record', () => {
  async function fillAndSubmit(container: HTMLElement) {
    await screen.findByRole('option', { name: /Juma Otieno/ });
    fireEvent.change(container.querySelector('select') as HTMLSelectElement, { target: { value: worker.id } });
    await submit(container);
  }

  it('reveals a check-out-before-check-in refusal sent as a service message', async () => {
    asUser('site_supervisor');
    mockAttendanceCreate.mockRejectedValue(apiError(422, 'Check-out time must be later than check-in time'));
    const { container } = render(<NewAttendancePage />);
    await fillAndSubmit(container);
    expectRevealed('Check-out time must be later than check-in time');
  });

  it('reveals the same refusal sent as a zod field detail', async () => {
    asUser('site_supervisor');
    mockAttendanceCreate.mockRejectedValue(apiError(422, 'Validation failed', { checkOutTime: ['Check-out must be after check-in'] }));
    const { container } = render(<NewAttendancePage />);
    await fillAndSubmit(container);
    expectRevealed('Check out time: Check-out must be after check-in');
  });

  it('reveals a duplicate-record refusal (403 from the service)', async () => {
    asUser('project_manager');
    mockAttendanceCreate.mockRejectedValue(apiError(403, 'Attendance record already exists for this worker on this date'));
    const { container } = render(<NewAttendancePage />);
    await fillAndSubmit(container);
    expectRevealed('Attendance record already exists for this worker on this date');
  });
});

describe('Log labour entry', () => {
  it('reveals a refusal for a worker with no wage on record', async () => {
    asUser('site_supervisor');
    mockLabourCreate.mockRejectedValue(apiError(422, 'This worker has no daily wage on record. Ask a finance user to set it.'));
    const { container } = render(<NewLabourEntryPage />);
    await screen.findByRole('option', { name: /Juma Otieno/ });
    await submit(container);
    expectRevealed('This worker has no daily wage on record');
  });

  it('shows and reveals a banner when the only error is an inline one', async () => {
    asUser('site_supervisor');
    mockLabourCreate.mockRejectedValue(apiError(422, 'Validation failed', { hoursWorked: ['Number must be less than or equal to 24'] }));
    const { container } = render(<NewLabourEntryPage />);
    await screen.findByRole('option', { name: /Juma Otieno/ });
    await submit(container);
    expect(screen.getByText('Number must be less than or equal to 24')).toBeInTheDocument();
    expectRevealed('Please correct the highlighted fields below.');
  });
});

describe('Edit attendance dialog', () => {
  it('shows a check-out-before-check-in refusal sent as a service message and keeps the dialog open', async () => {
    asUser('site_supervisor');
    mockAttendanceList.mockResolvedValue({ records: [{
      id: 'r1', companyId: 'c1', projectId: 'p1', siteId: 's1', workerId: worker.id, date: '2026-11-18T00:00:00.000Z',
      status: 'present', checkInTime: '07:30', checkOutTime: null, notes: null, recordedById: 'u1',
      createdAt: '2026-11-18T05:00:00.000Z', updatedAt: '2026-11-18T05:00:00.000Z',
      worker: { id: worker.id, firstName: 'Juma', lastName: 'Otieno', trade: 'Mason' },
      recordedBy: { id: 'u1', firstName: 'Sam', lastName: 'Sup' },
    }] });
    mockAttendanceUpdate.mockRejectedValue(apiError(422, 'Check-out time must be later than check-in time'));
    render(<AttendancePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit attendance for Juma Otieno' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Check-out time'), { target: { value: '06:00' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' })); });
    expect(mockAttendanceUpdate).toHaveBeenCalledWith('p1', 's1', 'r1', { checkOutTime: '06:00' });
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Check-out time must be later than check-in time');
  });
});
