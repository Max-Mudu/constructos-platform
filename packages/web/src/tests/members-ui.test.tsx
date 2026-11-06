/**
 * Project members page and the project page's management entry points.
 *
 *  - company_admin: lists members (with site scope), adds an existing company
 *    user with an optional site (POST { userId, siteId? }), removes a member
 *    after a confirmation step.
 *  - project_manager: read-only list; the company user list (admin-only
 *    endpoint) is never requested.
 *  - other roles: no member list request at all (the API would 403).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockMembersList = jest.fn();
const mockMembersAdd = jest.fn();
const mockMembersRemove = jest.fn();
jest.mock('@/lib/members-api', () => ({
  ...jest.requireActual('@/lib/members-api'),
  membersApi: {
    list: (...a: unknown[]) => mockMembersList(...a),
    add: (...a: unknown[]) => mockMembersAdd(...a),
    remove: (...a: unknown[]) => mockMembersRemove(...a),
  },
}));

const mockTeamList = jest.fn();
jest.mock('@/lib/team-api', () => ({
  ...jest.requireActual('@/lib/team-api'),
  teamApi: { list: (...a: unknown[]) => mockTeamList(...a) },
}));

const mockProjectGet = jest.fn();
const mockProjectList = jest.fn();
const mockSiteList = jest.fn();
jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: Record<string, string[]>) {
      super(message);
    }
  }
  return {
    ApiError,
    authApi: { me: jest.fn() },
    projectApi: {
      get: (...a: unknown[]) => mockProjectGet(...a),
      list: (...a: unknown[]) => mockProjectList(...a),
    },
    siteApi: { list: (...a: unknown[]) => mockSiteList(...a) },
  };
});

import { useParams } from 'next/navigation';
import { ApiError } from '@/lib/api';
import type { AuthUser, UserRole } from '@/lib/types';
import type { ProjectMember } from '@/lib/members-api';
import { addErrorText, addableUsers, loadAllActiveUsers, memberScopeLabel } from '@/lib/members-api';
import type { TeamMember } from '@/lib/team-api';
import { ProjectMembers } from '@/components/members/ProjectMembers';
import ProjectDetailPage from '@/app/(app)/projects/[projectId]/page';
import ProjectsPage from '@/app/(app)/projects/page';
import { useAuthStore } from '@/store/auth.store';

jest.mock('next/navigation', () => ({
  ...jest.requireActual('@/__mocks__/next/navigation'),
  useParams: jest.fn(() => ({ projectId: 'p1' })),
}));

const asUser = (role: UserRole) => {
  const user: AuthUser = {
    id: 'me', email: 'me@example.com', firstName: 'Me', lastName: 'Admin', role, companyId: 'c1',
    currency: 'KES', canViewFinance: false, defaultProjectId: null, defaultSiteId: null,
  };
  useAuthStore.setState({ user, accessToken: 't', isHydrated: true });
};

const member = (o: Partial<ProjectMember> & { first?: string } = {}): ProjectMember => ({
  id: `m-${o.userId ?? 'u1'}`, projectId: 'p1', userId: 'u1', siteId: null,
  assignedAt: '2026-11-01T00:00:00.000Z', removedAt: null,
  user: { id: o.userId ?? 'u1', firstName: o.first ?? 'Amina', lastName: 'Otieno', email: 'amina@example.com', role: 'site_supervisor', consultantType: null },
  site: null,
  ...o,
});

const teamUser = (o: Partial<TeamMember>): TeamMember => ({
  id: 'u9', email: 'x@example.com', firstName: 'Xavier', lastName: 'K', phone: null, role: 'contractor',
  consultantType: null, isActive: true, createdAt: '2026-10-01T00:00:00.000Z', defaultProject: null,
  defaultSite: null, projectMemberships: [], ...o,
});

const SITES = [
  { id: 's1', companyId: 'c1', projectId: 'p1', name: 'North Yard', address: null, latitude: null, longitude: null, isActive: true, createdAt: '' },
  { id: 's2', companyId: 'c1', projectId: 'p1', name: 'Old Gate', address: null, latitude: null, longitude: null, isActive: false, createdAt: '' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockSiteList.mockResolvedValue({ sites: SITES });
  mockProjectGet.mockResolvedValue({
    project: { id: 'p1', companyId: 'c1', name: 'Tower A', code: null, description: null, status: 'planning', startDate: null, endDate: null, location: null, createdAt: '' },
  });
});

describe('members-api helpers', () => {
  it('addableUsers keeps active, assignable, not-yet-member users only', () => {
    const users = [
      teamUser({ id: 'a', firstName: 'Zed', role: 'contractor' }),
      teamUser({ id: 'b', firstName: 'Ann', role: 'company_admin' }),
      teamUser({ id: 'c', firstName: 'Bo', role: 'finance_officer' }),
      teamUser({ id: 'd', firstName: 'Cy', role: 'viewer', isActive: false }),
      teamUser({ id: 'u1', firstName: 'Amina', role: 'site_supervisor' }),
      teamUser({ id: 'e', firstName: 'Ann', lastName: 'B', role: 'project_manager' }),
    ];
    expect(addableUsers(users, [member()]).map((u) => u.id)).toEqual(['e', 'a']);
  });

  it('memberScopeLabel shows project-wide vs one site', () => {
    expect(memberScopeLabel(member())).toBe('All sites');
    expect(memberScopeLabel(member({ siteId: 's1', site: { id: 's1', name: 'North Yard' } }))).toBe('North Yard');
  });

  it('loadAllActiveUsers pages through the 200-user cap', async () => {
    const list = jest.fn()
      .mockResolvedValueOnce({ users: Array.from({ length: 200 }, (_, i) => teamUser({ id: `u${i}` })), total: 250 })
      .mockResolvedValueOnce({ users: Array.from({ length: 50 }, (_, i) => teamUser({ id: `v${i}` })), total: 250 });
    const all = await loadAllActiveUsers(list);
    expect(all).toHaveLength(250);
    expect(list).toHaveBeenNthCalledWith(1, { isActive: true, limit: 200, offset: 0 });
    expect(list).toHaveBeenNthCalledWith(2, { isActive: true, limit: 200, offset: 200 });
  });

  it('addErrorText explains a 5xx (soft-removed member re-add) and a 409', () => {
    expect(addErrorText(new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'))).toMatch(/removed from this project before/);
    expect(addErrorText(new ApiError(409, 'CONFLICT', 'x'))).toMatch(/already a member/);
    expect(addErrorText(new ApiError(404, 'NOT_FOUND', 'User not found'))).toBe('User not found');
    expect(addErrorText(new Error('boom'))).toBe('Failed to add member');
  });
});

describe('<ProjectMembers> as company_admin', () => {
  beforeEach(() => {
    asUser('company_admin');
    mockMembersList.mockResolvedValue({
      members: [member({ userId: 'u1', siteId: 's1', site: { id: 's1', name: 'North Yard' } })],
    });
    mockTeamList.mockResolvedValue({
      users: [teamUser({ id: 'u9', firstName: 'Xavier' }), teamUser({ id: 'u1', firstName: 'Amina', role: 'site_supervisor' })],
      total: 2,
    });
  });

  it('lists members with their site scope and offers only addable users and active sites', async () => {
    render(<ProjectMembers projectId="p1" role="company_admin" />);
    expect(await screen.findByText('Amina Otieno')).toBeInTheDocument();
    expect(screen.getAllByText('North Yard').length).toBeGreaterThan(0);

    const person = screen.getByLabelText('Person') as HTMLSelectElement;
    await waitFor(() => expect(within(person).getAllByRole('option')).toHaveLength(2));
    expect(within(person).queryByText(/Amina/)).toBeNull();

    const siteSel = screen.getByLabelText('Site access') as HTMLSelectElement;
    expect(within(siteSel).queryByText('Old Gate')).toBeNull();
    expect(mockTeamList).toHaveBeenCalledWith({ isActive: true, limit: 200, offset: 0 });
  });

  it('adds a user with a site and reloads the list', async () => {
    mockMembersAdd.mockResolvedValue({ member: member({ userId: 'u9', first: 'Xavier' }) });
    render(<ProjectMembers projectId="p1" role="company_admin" />);
    const person = await screen.findByLabelText('Person');
    await waitFor(() => expect(within(person).getAllByRole('option')).toHaveLength(2));

    fireEvent.change(person, { target: { value: 'u9' } });
    fireEvent.change(screen.getByLabelText('Site access'), { target: { value: 's1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Project' }));

    await waitFor(() => expect(mockMembersAdd).toHaveBeenCalledWith('p1', { userId: 'u9', siteId: 's1' }));
    expect(await screen.findByText(/added to the project/)).toBeInTheDocument();
    expect(mockMembersList).toHaveBeenCalledTimes(2);
  });

  it('project-wide add sends no siteId', async () => {
    mockMembersAdd.mockResolvedValue({ member: member({ userId: 'u9', first: 'Xavier' }) });
    render(<ProjectMembers projectId="p1" role="company_admin" />);
    const person = await screen.findByLabelText('Person');
    await waitFor(() => expect(within(person).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(person, { target: { value: 'u9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Project' }));
    await waitFor(() => expect(mockMembersAdd).toHaveBeenCalledWith('p1', { userId: 'u9' }));
  });

  it('shows the add error instead of failing silently', async () => {
    mockMembersAdd.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'));
    render(<ProjectMembers projectId="p1" role="company_admin" />);
    const person = await screen.findByLabelText('Person');
    await waitFor(() => expect(within(person).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(person, { target: { value: 'u9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Project' }));
    expect(await screen.findByText(/could not add this person/)).toBeInTheDocument();
  });

  it('removes a member only after confirming', async () => {
    mockMembersRemove.mockResolvedValue(undefined);
    render(<ProjectMembers projectId="p1" role="company_admin" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Amina Otieno' }));
    expect(mockMembersRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(mockMembersRemove).toHaveBeenCalledWith('p1', 'u1'));
    expect(await screen.findByText(/removed from the project/)).toBeInTheDocument();
    expect(screen.queryByText('Amina Otieno')).toBeNull();
  });

  it('shows a remove failure', async () => {
    mockMembersRemove.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Project membership not found'));
    render(<ProjectMembers projectId="p1" role="company_admin" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Amina Otieno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
    expect(await screen.findByText('Project membership not found')).toBeInTheDocument();
  });
});

describe('<ProjectMembers> for other roles', () => {
  it('project_manager: read-only list, never requests the admin-only user list', async () => {
    asUser('project_manager');
    mockMembersList.mockResolvedValue({ members: [member()] });
    render(<ProjectMembers projectId="p1" role="project_manager" />);
    expect(await screen.findByText('Amina Otieno')).toBeInTheDocument();
    expect(screen.queryByLabelText('Person')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.getByText(/Only a company admin can add or remove/)).toBeInTheDocument();
    expect(mockTeamList).not.toHaveBeenCalled();
  });

  it('site_supervisor: no member request at all', () => {
    render(<ProjectMembers projectId="p1" role="site_supervisor" />);
    expect(screen.getByText(/Only a company admin or project manager can view/)).toBeInTheDocument();
    expect(mockMembersList).not.toHaveBeenCalled();
  });
});

describe('project page entry points', () => {
  beforeEach(() => {
    (useParams as jest.Mock).mockReturnValue({ projectId: 'p1' });
    mockMembersList.mockResolvedValue({ members: [member()] });
  });

  it('company_admin gets Edit, Add Site and Manage Members links', async () => {
    asUser('company_admin');
    render(<ProjectDetailPage />);
    await screen.findAllByText('Tower A');
    const edit = screen.getAllByRole('link', { name: /Edit/ });
    expect(edit[0]).toHaveAttribute('href', '/projects/p1/edit');
    expect(screen.getAllByRole('link', { name: /Add Site/ })[0]).toHaveAttribute('href', '/projects/p1/sites/new');
    expect(screen.getByRole('link', { name: 'Manage Members' })).toHaveAttribute('href', '/projects/p1/members');
    expect(await screen.findByText('Amina Otieno')).toBeInTheDocument();
    expect(screen.getByText('Planning')).toBeInTheDocument();
  });

  it('project_manager: Add Site and View Members, but no Edit (PATCH is admin-only)', async () => {
    asUser('project_manager');
    render(<ProjectDetailPage />);
    await screen.findAllByText('Tower A');
    expect(screen.queryByRole('link', { name: /^Edit$/ })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Add Site/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View Members' })).toBeInTheDocument();
  });

  it('site_supervisor: no management controls and no members request', async () => {
    asUser('site_supervisor');
    render(<ProjectDetailPage />);
    await screen.findAllByText('Tower A');
    expect(screen.queryByRole('link', { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Add Site/ })).toBeNull();
    expect(screen.queryByText('Project Members')).toBeNull();
    expect(mockMembersList).not.toHaveBeenCalled();
  });

  it('projects list: New Project for company_admin only', async () => {
    mockProjectList.mockResolvedValue({ projects: [] });
    asUser('company_admin');
    const { unmount } = render(<ProjectsPage />);
    expect((await screen.findAllByRole('link', { name: /New Project/ }))[0]).toHaveAttribute('href', '/projects/new');
    unmount();

    asUser('project_manager');
    render(<ProjectsPage />);
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New Project/ })).toBeNull();
  });
});
