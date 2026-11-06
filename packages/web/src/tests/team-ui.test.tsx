/**
 * /settings/team behaviour: admin-only gating, list states, form validation,
 * server error wording, and the one-time setup link (shown once, never
 * persisted, logged or put in the URL).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockList = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/lib/team-api', () => ({
  ...jest.requireActual('@/lib/team-api'),
  teamApi: {
    list: (...a: unknown[]) => mockList(...a),
    create: (...a: unknown[]) => mockCreate(...a),
  },
}));

const mockProjects = jest.fn();
const mockSites = jest.fn();
jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: Record<string, string[]>) {
      super(message);
    }
  }
  return {
    ApiError,
    authApi: { me: jest.fn(), updateDefaults: jest.fn() },
    projectApi: { list: (...a: unknown[]) => mockProjects(...a) },
    siteApi: { list: (...a: unknown[]) => mockSites(...a) },
  };
});

import { ApiError } from '@/lib/api';
import type { AuthUser, UserRole } from '@/lib/types';
import type { TeamMember } from '@/lib/team-api';
import { TeamManagement } from '@/components/team/TeamManagement';
import SettingsPage from '@/app/(app)/settings/page';
import { useAuthStore } from '@/store/auth.store';

const SECRET_LINK = 'http://localhost:3000/reset-password?token=SECRET-ONE-TIME-TOKEN-1234567890';

const member = (o: Partial<TeamMember> = {}): TeamMember => ({
  id: 'u1',
  email: 'zelda@example.com',
  firstName: 'Zelda',
  lastName: 'Okafor',
  phone: null,
  role: 'site_supervisor',
  consultantType: null,
  isActive: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  defaultProject: { id: 'p1', name: 'Tower A' },
  defaultSite: { id: 's1', name: 'North Yard' },
  projectMemberships: [{ projectId: 'p1', projectName: 'Tower A', siteId: 's1', siteName: 'North Yard', assignedAt: '2026-11-01T00:00:00.000Z' }],
  ...o,
});

const listResponse = (users: TeamMember[]) => ({ users, total: users.length, limit: 200, offset: 0 });

beforeEach(() => {
  mockList.mockReset();
  mockCreate.mockReset();
  mockProjects.mockReset().mockResolvedValue({ projects: [{ id: 'p1', name: 'Tower A' }] });
  mockSites.mockReset().mockResolvedValue({ sites: [{ id: 's1', name: 'North Yard' }] });
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => jest.restoreAllMocks());

// ─── Gating ──────────────────────────────────────────────────────────────────

describe('admin-only gating', () => {
  it.each(['finance_officer', 'project_manager', 'site_supervisor', 'contractor', 'consultant', 'worker', 'viewer', 'super_admin'] as UserRole[])(
    'shows the admin-only state to %s and never calls the API',
    (role) => {
      render(<TeamManagement role={role} />);
      expect(screen.getByText('Only company admins can manage the team')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /add team member/i })).not.toBeInTheDocument();
      expect(mockList).not.toHaveBeenCalled();
    },
  );

  it('shows the admin-only state when the API answers 403', async () => {
    mockList.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Insufficient permissions'));
    render(<TeamManagement role="company_admin" />);
    expect(await screen.findByText('Only company admins can manage the team')).toBeInTheDocument();
  });

  function setUser(role: UserRole) {
    const user: AuthUser = {
      id: 'me', email: 'me@example.com', firstName: 'Me', lastName: 'Admin', role,
      companyId: 'c1', currency: 'USD', canViewFinance: false, defaultProjectId: null, defaultSiteId: null,
    };
    act(() => { useAuthStore.setState({ user, accessToken: 'T' }); });
  }

  it('shows the Team card on /settings only to company_admin', async () => {
    setUser('company_admin');
    const { unmount } = render(<SettingsPage />);
    expect(await screen.findByRole('link', { name: /team members/i })).toHaveAttribute('href', '/settings/team');
    unmount();

    setUser('project_manager');
    render(<SettingsPage />);
    await waitFor(() => expect(mockProjects).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /team members/i })).not.toBeInTheDocument();
  });
});

// ─── List states ─────────────────────────────────────────────────────────────

describe('team list', () => {
  it('shows a loading state, then members with role, status and default workspace', async () => {
    let resolve!: (v: unknown) => void;
    mockList.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<TeamManagement role="company_admin" />);
    expect(screen.getByLabelText('Loading team')).toBeInTheDocument();

    await act(async () => {
      resolve(listResponse([
        member(),
        member({ id: 'u2', firstName: 'Musa', lastName: 'K', email: 'musa@example.com', role: 'finance_officer', isActive: false, defaultProject: null, defaultSite: null, projectMemberships: [] }),
      ]));
    });

    const zelda = screen.getByText('Zelda Okafor').closest('tr')!;
    expect(within(zelda).getByText('Site supervisor')).toBeInTheDocument();
    expect(within(zelda).getByText('Active')).toBeInTheDocument();
    // Default workspace column and project access column
    expect(within(zelda).getAllByText('Tower A · North Yard')).toHaveLength(2);

    const musa = screen.getByText('Musa K').closest('tr')!;
    expect(within(musa).getByText('Finance officer')).toBeInTheDocument();
    expect(within(musa).getByText('Inactive')).toBeInTheDocument();
    expect(within(musa).getByText('All projects')).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockList.mockResolvedValue(listResponse([]));
    render(<TeamManagement role="company_admin" />);
    expect(await screen.findByText('No team members yet')).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    mockList.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'Server unavailable'));
    render(<TeamManagement role="company_admin" />);
    expect(await screen.findByText('Server unavailable')).toBeInTheDocument();

    mockList.mockResolvedValueOnce(listResponse([member()]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Zelda Okafor')).toBeInTheDocument();
  });

  it('passes the status filter to the API', async () => {
    mockList.mockResolvedValue(listResponse([]));
    render(<TeamManagement role="company_admin" />);
    await screen.findByText('No team members yet');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ isActive: false }), expect.anything()));
  });
});

// ─── Add member ──────────────────────────────────────────────────────────────

async function openFormAndFill(role: string) {
  mockList.mockResolvedValue(listResponse([member()]));
  const view = render(<TeamManagement role="company_admin" />);
  await screen.findByText('Zelda Okafor');
  fireEvent.click(screen.getByRole('button', { name: /add team member/i }));
  await screen.findByRole('option', { name: 'Tower A' });
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ana' } });
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lee' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } });
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: role } });
  return view;
}

describe('add member form', () => {
  it('offers exactly the assignable roles', async () => {
    mockList.mockResolvedValue(listResponse([]));
    render(<TeamManagement role="company_admin" />);
    await screen.findByText('No team members yet');
    fireEvent.click(screen.getAllByRole('button', { name: /add team member/i })[0]);
    await screen.findByRole('option', { name: 'Tower A' });
    const options = within(screen.getByLabelText('Role')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['', 'company_admin', 'finance_officer', 'project_manager', 'site_supervisor', 'contractor', 'consultant', 'viewer']);
  });

  it('shows consultant type only for consultants', async () => {
    await openFormAndFill('viewer');
    expect(screen.queryByLabelText(/consultant type/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'consultant' } });
    expect(screen.getByLabelText(/consultant type/i)).toBeInTheDocument();
  });

  it('blocks a project-scoped role without project and site', async () => {
    await openFormAndFill('site_supervisor');
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect(await screen.findByText(/a project is required/i)).toBeInTheDocument();
    expect(screen.getByText(/a site is required/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('sends project and site for a project-scoped role', async () => {
    mockCreate.mockResolvedValue({ user: { email: 'ana@example.com' }, setupEmailSent: true });
    await openFormAndFill('site_supervisor');
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    await waitFor(() => expect(mockSites).toHaveBeenCalledWith('p1'));
    await screen.findByRole('option', { name: 'North Yard' });
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 's1' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add member' })); });
    expect(mockCreate).toHaveBeenCalledWith({
      email: 'ana@example.com', firstName: 'Ana', lastName: 'Lee', role: 'site_supervisor',
      defaultProjectId: 'p1', defaultSiteId: 's1',
    });
  });

  it('explains a duplicate email (409) and keeps the form', async () => {
    mockCreate.mockRejectedValue(new ApiError(409, 'CONFLICT', 'An account with this email already exists'));
    await openFormAndFill('finance_officer');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add member' })); });
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('ana@example.com');
  });

  it('shows the server 422 message', async () => {
    mockCreate.mockRejectedValue(new ApiError(422, 'VALIDATION_ERROR', "Both defaultProjectId and defaultSiteId are required for role 'finance_officer'"));
    await openFormAndFill('finance_officer');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add member' })); });
    expect(await screen.findByText(/required for role 'finance_officer'/)).toBeInTheDocument();
  });
});

// ─── One-time setup link ─────────────────────────────────────────────────────

describe('one-time setup link', () => {
  it('is shown once, never persisted, logged or put in the URL, and gone after closing', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map((m) => jest.spyOn(console, m as 'log').mockImplementation(() => {}));
    const urlBefore = window.location.href;

    mockCreate.mockResolvedValue({
      user: { id: 'n1', email: 'ana@example.com' },
      setupLink: SECRET_LINK,
      setupEmailSent: false,
    });
    await openFormAndFill('finance_officer');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add member' })); });

    const panel = await screen.findByRole('region', { name: 'New team member access' });
    expect(within(panel).getByText(/one-time setup link — share privately, expires in 60 minutes/i)).toBeInTheDocument();
    expect(within(panel).getByLabelText('One-time setup link')).toHaveValue(SECRET_LINK);
    // Rendered as text, not as a clickable link
    expect(within(panel).queryByRole('link')).not.toBeInTheDocument();
    expect(within(panel).getByText(/No setup email was sent/)).toBeInTheDocument();

    // Copy button
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: /copy/i })); });
    expect(writeText).toHaveBeenCalledWith(SECRET_LINK);
    expect(within(panel).getByRole('button', { name: /copied/i })).toBeInTheDocument();

    // Not persisted, logged or in the URL
    for (const call of setItem.mock.calls) expect(String(call[1])).not.toContain('SECRET-ONE-TIME-TOKEN');
    expect(JSON.stringify({ ...localStorage })).not.toContain('SECRET-ONE-TIME-TOKEN');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('SECRET-ONE-TIME-TOKEN');
    for (const spy of logs) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain('SECRET-ONE-TIME-TOKEN');
    expect(window.location.href).toBe(urlBefore);

    // Close: gone for good
    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('region', { name: 'New team member access' })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('SECRET-ONE-TIME-TOKEN');

    // Re-opening the form does not resurrect it
    fireEvent.click(screen.getByRole('button', { name: /add team member/i }));
    expect(document.body.innerHTML).not.toContain('SECRET-ONE-TIME-TOKEN');
  });

  it('is cleared when "Add team member" is pressed again while it is showing', async () => {
    mockCreate.mockResolvedValue({ user: { id: 'n1', email: 'ana@example.com' }, setupLink: SECRET_LINK, setupEmailSent: false });
    await openFormAndFill('finance_officer');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add member' })); });
    await screen.findByLabelText('One-time setup link');
    fireEvent.click(screen.getByRole('button', { name: /add team member/i }));
    expect(screen.queryByLabelText('One-time setup link')).not.toBeInTheDocument();
  });

  it('is gone after the page unmounts (navigation)', async () => {
    mockCreate.mockResolvedValue({ user: { id: 'n1', email: 'ana@example.com' }, setupLink: SECRET_LINK, setupEmailSent: false });
    const view = await openFormAndFill('finance_officer');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add member' })); });
    await screen.findByLabelText('One-time setup link');

    // Navigating away unmounts the page; coming back renders fresh state.
    view.unmount();
    expect(document.body.textContent).not.toContain('SECRET-ONE-TIME-TOKEN');
    mockList.mockResolvedValue(listResponse([member()]));
    render(<TeamManagement role="company_admin" />);
    await screen.findByText('Zelda Okafor');
    expect(screen.queryByLabelText('One-time setup link')).not.toBeInTheDocument();
  });

  it('says an email was sent and shows no link when the API returns none (production)', async () => {
    mockCreate.mockResolvedValue({ user: { id: 'n1', email: 'ana@example.com' }, setupEmailSent: true });
    await openFormAndFill('finance_officer');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add member' })); });
    expect(await screen.findByText('A setup email was sent to ana@example.com.')).toBeInTheDocument();
    expect(screen.queryByLabelText('One-time setup link')).not.toBeInTheDocument();
  });
});
