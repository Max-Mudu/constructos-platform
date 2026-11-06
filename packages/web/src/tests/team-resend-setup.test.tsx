/**
 * /settings/team — "Resend setup link" (POST /companies/me/users/:id/setup-link).
 *
 * Offered only for active members who have never signed in, never on the
 * admin's own row. The new link is shown once in the setup-link panel (same
 * handling as at creation) and never persisted.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';

const mockList = jest.fn();
const mockResend = jest.fn();
const mockSetStatus = jest.fn();
jest.mock('@/lib/team-api', () => ({
  ...jest.requireActual('@/lib/team-api'),
  teamApi: {
    list: (...a: unknown[]) => mockList(...a),
    create: jest.fn(),
    setStatus: (...a: unknown[]) => mockSetStatus(...a),
    resendSetupLink: (...a: unknown[]) => mockResend(...a),
  },
}));

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  }
  return {
    ApiError,
    authApi: { me: jest.fn() },
    projectApi: { list: jest.fn().mockResolvedValue({ projects: [] }) },
    siteApi: { list: jest.fn().mockResolvedValue({ sites: [] }) },
  };
});

import { ApiError } from '@/lib/api';
import type { TeamMember } from '@/lib/team-api';
import { TeamManagement } from '@/components/team/TeamManagement';

const ME = 'me';
const LINK = 'http://localhost:3000/reset-password?token=NEW-ONE-TIME-TOKEN-abcdef123456';

const member = (o: Partial<TeamMember>): TeamMember => ({
  id: 'x', email: 'x@example.com', firstName: 'X', lastName: 'Y', phone: null, role: 'finance_officer',
  consultantType: null, isActive: true, createdAt: '2026-11-01T00:00:00.000Z', setupPending: false,
  defaultProject: null, defaultSite: null, projectMemberships: [], ...o,
});

const pending  = member({ id: 'p1', email: 'pen@example.com', firstName: 'Pen', lastName: 'Ding', setupPending: true });
const signedIn = member({ id: 's1', email: 'sig@example.com', firstName: 'Sig', lastName: 'Ned', setupPending: false });
const inactivePending = member({ id: 'i1', email: 'ina@example.com', firstName: 'Ina', lastName: 'Ctive', isActive: false, setupPending: true });
const self = member({ id: ME, email: 'me@example.com', firstName: 'Ada', lastName: 'Admin', role: 'company_admin', setupPending: true });

beforeEach(() => {
  mockList.mockReset().mockResolvedValue({ users: [self, pending, signedIn, inactivePending], total: 4, limit: 200, offset: 0 });
  mockResend.mockReset();
  mockSetStatus.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => jest.restoreAllMocks());

async function renderTeam() {
  render(<TeamManagement role="company_admin" currentUserId={ME} />);
  await screen.findByText('Pen Ding');
}
const row = (name: string) => screen.getByText(name).closest('tr')!;

it('is offered only for active members who have never signed in, never for yourself', async () => {
  await renderTeam();
  expect(within(row('Pen Ding')).getByRole('button', { name: 'Resend setup link to Pen Ding' })).toBeInTheDocument();
  expect(within(row('Sig Ned')).queryByRole('button', { name: /resend/i })).not.toBeInTheDocument();
  expect(within(row('Ina Ctive')).queryByRole('button', { name: /resend/i })).not.toBeInTheDocument();
  expect(within(row('Ada Admin')).queryByRole('button', { name: /resend/i })).not.toBeInTheDocument();
});

it('is not offered when the API does not report setupPending', async () => {
  const legacy = { ...pending } as Partial<TeamMember>;
  delete legacy.setupPending;
  mockList.mockResolvedValue({ users: [legacy], total: 1, limit: 200, offset: 0 });
  render(<TeamManagement role="company_admin" currentUserId={ME} />);
  await screen.findByText('Pen Ding');
  expect(screen.queryByRole('button', { name: /resend/i })).not.toBeInTheDocument();
});

it('shows the new link once in the setup panel, without persisting or logging it', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  mockResend.mockResolvedValue({
    user: { id: 'p1', email: 'pen@example.com', firstName: 'Pen', lastName: 'Ding', role: 'finance_officer', isActive: true },
    setupLink: LINK,
    setupEmailSent: false,
  });
  await renderTeam();

  fireEvent.click(screen.getByRole('button', { name: 'Resend setup link to Pen Ding' }));
  const panel = await screen.findByRole('region', { name: 'New team member access' });
  expect(within(panel).getByText('New setup link for pen@example.com')).toBeInTheDocument();
  expect(within(panel).getByLabelText('One-time setup link')).toHaveValue(LINK);
  expect(mockResend).toHaveBeenCalledWith('p1');
  expect(mockResend).toHaveBeenCalledTimes(1);

  const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
  expect(stored).not.toContain('NEW-ONE-TIME-TOKEN');
  expect(window.location.href).not.toContain('NEW-ONE-TIME-TOKEN');
  for (const spy of [log, info]) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain('NEW-ONE-TIME-TOKEN');
  }

  fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
  expect(screen.queryByDisplayValue(LINK)).not.toBeInTheDocument();
});

it('says an email was sent when no link comes back (production)', async () => {
  mockResend.mockResolvedValue({
    user: { id: 'p1', email: 'pen@example.com', firstName: 'Pen', lastName: 'Ding', role: 'finance_officer', isActive: true },
    setupEmailSent: true,
  });
  await renderTeam();
  fireEvent.click(screen.getByRole('button', { name: 'Resend setup link to Pen Ding' }));
  expect(await screen.findByText('A setup email was sent to pen@example.com.')).toBeInTheDocument();
  expect(screen.queryByLabelText('One-time setup link')).not.toBeInTheDocument();
});

it('shows the server 409 message (e.g. already signed in) and refreshes the list', async () => {
  mockResend.mockRejectedValue(new ApiError(409, 'CONFLICT', 'This user has already signed in. They can reset their own password with "Forgot password"'));
  await renderTeam();
  fireEvent.click(screen.getByRole('button', { name: 'Resend setup link to Pen Ding' }));
  expect(await screen.findByText(/already signed in/)).toBeInTheDocument();
  expect(screen.queryByLabelText('One-time setup link')).not.toBeInTheDocument();
  expect(mockList).toHaveBeenCalledTimes(2);
});

it('deactivating the member removes their setup link from the screen', async () => {
  mockResend.mockResolvedValue({
    user: { id: 'p1', email: 'pen@example.com', firstName: 'Pen', lastName: 'Ding', role: 'finance_officer', isActive: true },
    setupLink: LINK,
    setupEmailSent: false,
  });
  mockSetStatus.mockResolvedValue({
    user: { id: 'p1', email: 'pen@example.com', firstName: 'Pen', lastName: 'Ding', role: 'finance_officer', isActive: false },
    changed: true, refreshTokensRevoked: 0, setupTokensInvalidated: 1,
  });
  await renderTeam();
  fireEvent.click(screen.getByRole('button', { name: 'Resend setup link to Pen Ding' }));
  await screen.findByLabelText('One-time setup link');

  fireEvent.click(screen.getByRole('button', { name: 'Deactivate Pen Ding' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Deactivate and sign out' }));
  expect(await screen.findByText('Pen Ding was deactivated and signed out everywhere.')).toBeInTheDocument();
  expect(screen.queryByLabelText('One-time setup link')).not.toBeInTheDocument();
});
