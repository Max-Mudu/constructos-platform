/**
 * Pages whose primary data load used to fail silently (an empty dropdown or
 * page with no message) now show an inline error, and Retry loads again.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = {
  projectList:    jest.fn(),
  siteList:       jest.fn(),
  drawingList:    jest.fn(),
  dashboardGet:   jest.fn(),
  activityList:   jest.fn(),
  reportGet:      jest.fn(),
};

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  }
  const never = () => new Promise(() => {});
  return {
    ApiError,
    projectApi:     { list: (...a: unknown[]) => api.projectList(...a) },
    siteApi:        { list: (...a: unknown[]) => api.siteList(...a) },
    drawingApi:     { list: (...a: unknown[]) => api.drawingList(...a), create: never },
    budgetApi:      { create: never },
    invoiceApi:     { create: never },
    instructionApi: { create: never },
    dashboardApi:   { get: (...a: unknown[]) => api.dashboardGet(...a) },
    activityApi:    { list: (...a: unknown[]) => api.activityList(...a) },
    reportApi:      { get: (...a: unknown[]) => api.reportGet(...a), download: never },
  };
});

jest.mock('@/hooks/useSSEEvent', () => ({ useSSEEvent: jest.fn() }));

import { ApiError } from '@/lib/api';
import type { AuthUser } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { useSearchParams } from 'next/navigation';
import NewBudgetPage from '@/app/(app)/budget/new/page';
import NewInvoicePage from '@/app/(app)/invoices/new/page';
import NewDrawingPage from '@/app/(app)/drawings/new/page';
import NewInstructionPage from '@/app/(app)/consultants/instructions/new/page';
import DashboardPage from '@/app/(app)/dashboard/page';
import ReportsPage from '@/app/(app)/reports/page';

const pending = () => new Promise(() => {});
const serverError = () => new (ApiError as unknown as new (s: number, c: string, m: string) => Error)(500, 'INTERNAL', 'Server unavailable');
const projects = { projects: [{ id: 'p1', name: 'Riverside Towers', code: 'RT' }] };

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  (useSearchParams as jest.Mock).mockImplementation(() => new URLSearchParams());
  const user: AuthUser = {
    id: 'me', email: 'me@example.com', firstName: 'Me', lastName: 'User', role: 'company_admin', companyId: 'c1',
    currency: 'KES', canViewFinance: true, defaultProjectId: null, defaultSiteId: null,
  };
  useAuthStore.setState({ user, accessToken: 't', isHydrated: true });
});

describe.each([
  ['New Budget', NewBudgetPage],
  ['New Invoice', NewInvoicePage],
  ['New Drawing', NewDrawingPage],
  ['New Instruction', NewInstructionPage],
])('%s: project list', (_name, Page) => {
  it('shows the load error and Retry reloads the projects', async () => {
    api.projectList.mockRejectedValueOnce(serverError()).mockResolvedValueOnce(projects);
    render(<Page />);

    expect(await screen.findByText('Could not load projects: Server unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('option', { name: /Riverside Towers/ })).toBeInTheDocument();
    expect(screen.queryByText(/Could not load projects/)).not.toBeInTheDocument();
    expect(api.projectList).toHaveBeenCalledTimes(2);
  });

  it('a network failure gets a plain message', async () => {
    api.projectList.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<Page />);
    expect(await screen.findByText('Could not load projects. Check your connection and retry.')).toBeInTheDocument();
  });
});

describe('New Instruction: optional site and drawing links', () => {
  it('reports a failed drawing list instead of hiding the field, and Retry reloads both', async () => {
    (useSearchParams as jest.Mock).mockImplementation(() => new URLSearchParams('projectId=p1'));
    api.projectList.mockResolvedValue(projects);
    api.siteList.mockResolvedValue({ sites: [{ id: 's1', name: 'Block A' }] });
    api.drawingList
      .mockRejectedValueOnce(serverError())
      .mockResolvedValueOnce({ drawings: [{ id: 'd1', drawingNumber: 'A-001', title: 'Ground floor' }] });
    render(<NewInstructionPage />);

    expect(await screen.findByText('Could not load sites and drawings for this project: Server unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('option', { name: 'A-001 — Ground floor' })).toBeInTheDocument();
    expect(screen.queryByText(/Could not load sites and drawings/)).not.toBeInTheDocument();
    expect(api.siteList).toHaveBeenCalledTimes(2);
  });
});

describe('Dashboard', () => {
  it('shows the load error and Retry fetches the dashboard again', async () => {
    api.dashboardGet.mockRejectedValueOnce(serverError()).mockImplementationOnce(pending);
    render(<DashboardPage />);

    expect(await screen.findByText('Server unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(api.dashboardGet).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Server unavailable')).not.toBeInTheDocument();
  });
});

describe('Reports', () => {
  it('reports a failed project filter list, and Retry loads it', async () => {
    api.reportGet.mockImplementation(pending);
    api.projectList.mockRejectedValueOnce(serverError()).mockResolvedValueOnce(projects);
    render(<ReportsPage />);

    expect(await screen.findByText('Could not load projects for the filters: Server unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('option', { name: 'Riverside Towers' })).toBeInTheDocument();
    expect(screen.queryByText(/Could not load projects/)).not.toBeInTheDocument();
  });

  it('a failed report load offers Retry, which runs the report again', async () => {
    api.projectList.mockResolvedValue(projects);
    api.reportGet.mockRejectedValueOnce(serverError()).mockImplementationOnce(pending);
    render(<ReportsPage />);

    expect(await screen.findByText('Server unavailable')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });

    expect(api.reportGet).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Server unavailable')).not.toBeInTheDocument();
  });
});
