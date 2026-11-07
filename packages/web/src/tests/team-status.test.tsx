/**
 * /settings/team — deactivate / reactivate actions and project-access links.
 *
 * The API is the authority (self and last-admin are refused with 409); the UI
 * hides the action on the admin's own row, asks for confirmation explaining
 * the immediate sign-out, and shows the server's 409 message verbatim.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockList = jest.fn();
const mockCreate = jest.fn();
const mockSetStatus = jest.fn();
jest.mock('@/lib/team-api', () => ({
  ...jest.requireActual('@/lib/team-api'),
  teamApi: {
    list: (...a: unknown[]) => mockList(...a),
    create: (...a: unknown[]) => mockCreate(...a),
    setStatus: (...a: unknown[]) => mockSetStatus(...a),
  },
}));

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: Record<string, string[]>) {
      super(message);
    }
  }
  return {
    ApiError,
    authApi: { me: jest.fn(), updateDefaults: jest.fn() },
    projectApi: { list: jest.fn().mockResolvedValue({ projects: [] }) },
    siteApi: { list: jest.fn().mockResolvedValue({ sites: [] }) },
  };
});

import { ApiError } from '@/lib/api';
import type { AuthUser, UserRole } from '@/lib/types';
import type { TeamMember } from '@/lib/team-api';
import { TeamManagement, statusNotice } from '@/components/team/TeamManagement';
import { statusErrorMessage } from '@/components/team/MemberStatusDialog';
import TeamSettingsPage from '@/app/(app)/settings/team/page';
import { useAuthStore } from '@/store/auth.store';

const ME = 'admin-me';

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
  projectMemberships: [
    { projectId: 'p1', projectName: 'Tower A', siteId: 's1', siteName: 'North Yard', assignedAt: '2026-11-01T00:00:00.000Z' },
    { projectId: 'p2', projectName: 'Depot', siteId: null, siteName: null, assignedAt: '2026-11-02T00:00:00.000Z' },
  ],
  ...o,
});

const self = member({
  id: ME, email: 'me@example.com', firstName: 'Ada', lastName: 'Admin', role: 'company_admin',
  defaultProject: null, defaultSite: null, projectMemberships: [],
});
const inactive = member({
  id: 'u2', email: 'musa@example.com', firstName: 'Musa', lastName: 'K', isActive: false,
  projectMemberships: [],
});

const listResponse = (users: TeamMember[]) => ({ users, total: users.length, limit: 200, offset: 0 });
const statusResponse = (m: TeamMember, isActive: boolean, changed = true) => ({
  user: { id: m.id, email: m.email, firstName: m.firstName, lastName: m.lastName, role: m.role, isActive },
  changed, refreshTokensRevoked: changed && !isActive ? 2 : 0, setupTokensInvalidated: 0,
});

beforeEach(() => {
  mockList.mockReset().mockResolvedValue(listResponse([self, member(), inactive]));
  mockCreate.mockReset();
  mockSetStatus.mockReset();
});

async function renderTeam() {
  render(<TeamManagement role="company_admin" currentUserId={ME} />);
  await screen.findByText('Zelda Okafor');
}

const row = (name: string) => screen.getByText(name).closest('tr')!;

describe('status actions in the list', () => {
  it('offers Deactivate for active members, Reactivate for inactive ones, and nothing on the admin\'s own row', async () => {
    await renderTeam();

    expect(within(row('Zelda Okafor')).getByRole('button', { name: 'Deactivate Zelda Okafor' })).toBeInTheDocument();
    expect(within(row('Musa K')).getByRole('button', { name: 'Reactivate Musa K' })).toBeInTheDocument();

    const mine = row('Ada Admin');
    expect(within(mine).queryByRole('button')).not.toBeInTheDocument();
    expect(within(mine).getByText('You')).toBeInTheDocument();
  });

  it('shows no list (and so no actions) to non-admins', () => {
    for (const role of ['project_manager', 'finance_officer', 'viewer'] as UserRole[]) {
      const { unmount } = render(<TeamManagement role={role} currentUserId={ME} />);
      expect(screen.queryByRole('button', { name: /deactivate|reactivate/i })).not.toBeInTheDocument();
      unmount();
    }
    expect(mockList).not.toHaveBeenCalled();
  });

  it('the settings page passes the signed-in user id so their own row is protected', async () => {
    const user: AuthUser = {
      id: ME, email: 'me@example.com', firstName: 'Ada', lastName: 'Admin', role: 'company_admin',
      companyId: 'c1', currency: 'USD', canViewFinance: true, defaultProjectId: null, defaultSiteId: null,
    };
    act(() => { useAuthStore.setState({ user, accessToken: 'T' }); });
    render(<TeamSettingsPage />);
    await screen.findByText('Ada Admin');
    expect(within(row('Ada Admin')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(row('Zelda Okafor')).getByRole('button', { name: /deactivate/i })).toBeInTheDocument();
  });
});

describe('deactivate', () => {
  it('asks for confirmation explaining the immediate sign-out; Cancel changes nothing', async () => {
    await renderTeam();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Zelda Okafor' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Deactivate Zelda Okafor?' });
    expect(within(dialog).getByText(/signs them out everywhere immediately/i)).toBeInTheDocument();
    expect(mockSetStatus).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it('Escape also cancels', async () => {
    await renderTeam();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Zelda Okafor' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it('confirming calls the API once, updates the row, reloads and confirms', async () => {
    const zelda = member();
    mockSetStatus.mockResolvedValue(statusResponse(zelda, false));
    await renderTeam();
    expect(mockList).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Zelda Okafor' }));
    mockList.mockResolvedValue(listResponse([self, { ...zelda, isActive: false }, inactive]));
    const confirm = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate and sign out' });
    fireEvent.click(confirm);
    fireEvent.click(confirm); // a double click must not send twice

    expect(await screen.findByText('Zelda Okafor was deactivated and signed out everywhere.')).toBeInTheDocument();
    expect(mockSetStatus).toHaveBeenCalledTimes(1);
    expect(mockSetStatus).toHaveBeenCalledWith('u1', false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(await within(row('Zelda Okafor')).findByRole('button', { name: 'Reactivate Zelda Okafor' })).toBeInTheDocument();
    expect(within(row('Zelda Okafor')).getByText('Inactive')).toBeInTheDocument();
  });

  it('shows the server\'s 409 message (last active admin) in the dialog and keeps the member active', async () => {
    const peer = member({ id: 'a2', firstName: 'Peer', lastName: 'Admin', email: 'peer@example.com', role: 'company_admin', projectMemberships: [] });
    mockList.mockResolvedValue(listResponse([self, peer]));
    mockSetStatus.mockRejectedValue(new ApiError(409, 'CONFLICT', 'The last active company admin cannot be deactivated'));
    render(<TeamManagement role="company_admin" currentUserId={ME} />);
    await screen.findByText('Peer Admin');

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Peer Admin' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate and sign out' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByText('The last active company admin cannot be deactivated')).toBeInTheDocument();
    expect(within(row('Peer Admin')).getByText('Active')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('shows the self-deactivation 409 message when the server refuses it', async () => {
    // e.g. the session's user id was not known to the page
    mockList.mockResolvedValue(listResponse([self]));
    mockSetStatus.mockRejectedValue(new ApiError(409, 'CONFLICT', 'You cannot deactivate your own account'));
    render(<TeamManagement role="company_admin" currentUserId={null} />);
    await screen.findByText('Ada Admin');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Ada Admin' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate and sign out' }));
    expect(await screen.findByText('You cannot deactivate your own account')).toBeInTheDocument();
  });
});

describe('reactivate', () => {
  it('explains what comes back, then calls the API with isActive true', async () => {
    mockSetStatus.mockResolvedValue(statusResponse(inactive, true));
    await renderTeam();

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate Musa K' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Reactivate Musa K?' });
    expect(within(dialog).getByText(/projects they were removed from stay removed/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));
    expect(await screen.findByText('Musa K was reactivated and can sign in again.')).toBeInTheDocument();
    expect(mockSetStatus).toHaveBeenCalledWith('u2', true);
  });
});

describe('project access links', () => {
  it('links each membership to that project\'s members page', async () => {
    await renderTeam();
    const zelda = row('Zelda Okafor');
    expect(within(zelda).getByRole('link', { name: 'Tower A · North Yard' })).toHaveAttribute('href', '/projects/p1/members');
    expect(within(zelda).getByRole('link', { name: 'Depot (all sites)' })).toHaveAttribute('href', '/projects/p2/members');
    expect(within(row('Musa K')).getByText('No project access')).toBeInTheDocument();
    expect(within(row('Ada Admin')).getByText('All projects')).toBeInTheDocument();
  });
});

describe('wording helpers', () => {
  it('maps API errors to readable messages', () => {
    expect(statusErrorMessage(new ApiError(409, 'CONFLICT', 'The last active company admin cannot be deactivated')))
      .toBe('The last active company admin cannot be deactivated');
    expect(statusErrorMessage(new ApiError(404, 'NOT_FOUND', 'User not found'))).toMatch(/no longer in your company/);
    expect(statusErrorMessage(new ApiError(403, 'FORBIDDEN', 'Insufficient permissions'))).toMatch(/active company admin/);
    expect(statusErrorMessage(new ApiError(0, 'NETWORK', 'Network error'))).toMatch(/connection/);
    expect(statusErrorMessage(new Error('boom'))).toBe('The change could not be saved.');
  });

  it('describes unchanged results too', () => {
    const m = member();
    expect(statusNotice(statusResponse(m, false, false))).toBe('Zelda Okafor is already deactivated.');
    expect(statusNotice(statusResponse(m, true, false))).toBe('Zelda Okafor is already active.');
  });
});
