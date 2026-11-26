/**
 * Worker edit form and the reactivation rule: only a company admin can make a
 * worker who is not active active again (the API answers 403
 * WORKER_REACTIVATION_DENIED otherwise). The form sends the employment status
 * only when it was changed, so saving other details never changes it, and a
 * non-admin cannot choose Active for a worker who is not active.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';

const mockGet = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  }
  return {
    ApiError,
    workerApi: {
      get: (...a: unknown[]) => mockGet(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
    },
  };
});

jest.mock('next/navigation', () => ({
  ...jest.requireActual('@/__mocks__/next/navigation'),
  useParams: jest.fn(() => ({ workerId: 'w1' })),
}));

import type { AuthUser, UserRole, Worker } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import EditWorkerPage from '@/app/(app)/workers/[workerId]/edit/page';

const worker = (o: Partial<Worker> = {}): Worker => ({
  id: 'w1', companyId: 'c1', firstName: 'Juma', lastName: 'Otieno', email: null, phone: null, idNumber: null, trade: null,
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
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue({ worker: worker() });
});

async function open(w: Worker) {
  mockGet.mockResolvedValue({ worker: w });
  await act(async () => { render(<EditWorkerPage />); });
}

const statusSelect = () => screen.getByLabelText('Employment Status') as HTMLSelectElement;
const activeOption = () => Array.from(statusSelect().options).find((o) => o.value === 'active')!;

async function save() {
  await act(async () => {
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
  });
}

describe('worker edit form', () => {
  it('a project manager cannot choose Active for an inactive worker', async () => {
    asUser('project_manager');
    await open(worker({ isActive: false, employmentStatus: 'inactive' }));
    expect(activeOption().disabled).toBe(true);
    expect(screen.getByText('Only a company admin can reactivate this worker.')).toBeInTheDocument();
  });

  it('a company admin can choose Active for an inactive worker and the change is sent', async () => {
    asUser('company_admin');
    await open(worker({ isActive: false, employmentStatus: 'inactive' }));
    expect(activeOption().disabled).toBe(false);
    expect(screen.queryByText('Only a company admin can reactivate this worker.')).toBeNull();
    fireEvent.change(statusSelect(), { target: { value: 'active' } });
    await save();
    expect(mockUpdate).toHaveBeenCalledWith('w1', expect.objectContaining({ employmentStatus: 'active' }));
  });

  it('a project manager can still suspend an active worker', async () => {
    asUser('project_manager');
    await open(worker());
    expect(activeOption().disabled).toBe(false);
    fireEvent.change(statusSelect(), { target: { value: 'suspended' } });
    await save();
    expect(mockUpdate).toHaveBeenCalledWith('w1', expect.objectContaining({ employmentStatus: 'suspended' }));
  });

  it('saving other details does not send the status, so it cannot change it', async () => {
    asUser('project_manager');
    await open(worker({ isActive: false, employmentStatus: 'inactive' }));
    fireEvent.change(screen.getByLabelText(/Trade/i), { target: { value: 'Mason' } });
    await save();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('employmentStatus');
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ trade: 'Mason' });
  });
});
