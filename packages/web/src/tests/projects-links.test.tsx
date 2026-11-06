/**
 * Broken links, endless spinners and silent failures in the site workflows.
 *
 * Regressions covered:
 *  - /contractors/:id linked to /contractors/:id/edit, which did not exist.
 *  - /drawings/:id linked to .../revisions/:rev/comments (404) although the
 *    comments API exists.
 *  - /drawings/:id and /consultants/instructions/:id spun forever without
 *    ?projectId.
 *  - the site page swallowed remove-worker failures (and asked for the
 *    worker list with roles the API 403s); attendance/new and targets/new
 *    swallowed worker-load failures; approving a target left the summary
 *    cards stale; the schedule showed "Create the first work package" under a
 *    403 error.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockApi = {
  contractorGet: jest.fn(), contractorUpdate: jest.fn(), contractorDeactivate: jest.fn(),
  drawingGet: jest.fn(), listComments: jest.fn(), addComment: jest.fn(), approveRevision: jest.fn(),
  instructionGet: jest.fn(),
  siteGet: jest.fn(), attendanceSummary: jest.fn(), targetsSummary: jest.fn(), targetsList: jest.fn(),
  targetsApprove: jest.fn(), scheduleSummary: jest.fn(), listTasks: jest.fn(), listPackages: jest.fn(),
  listSiteWorkers: jest.fn(), removeFromSite: jest.fn(), workerList: jest.fn(),
};
jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: Record<string, string[]>) {
      super(message);
    }
  }
  const call = (k: keyof typeof mockApi) => (...a: unknown[]) => mockApi[k](...a);
  return {
    ApiError,
    authApi: { me: jest.fn() },
    contractorApi: { get: call('contractorGet'), update: call('contractorUpdate'), deactivate: call('contractorDeactivate') },
    drawingApi: { get: call('drawingGet'), listComments: call('listComments'), addComment: call('addComment'), approveRevision: call('approveRevision') },
    instructionApi: { get: call('instructionGet') },
    siteApi: { get: call('siteGet') },
    attendanceApi: { summary: call('attendanceSummary') },
    targetsApi: { summary: call('targetsSummary'), list: call('targetsList'), approve: call('targetsApprove') },
    scheduleApi: { getSummary: call('scheduleSummary'), listTasks: call('listTasks'), listPackages: call('listPackages') },
    workerApi: { listSiteWorkers: call('listSiteWorkers'), removeFromSite: call('removeFromSite'), list: call('workerList'), assignToSite: jest.fn() },
  };
});

const mockParams = jest.fn();
const mockSearch = jest.fn(() => new URLSearchParams());
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => mockParams(),
  useSearchParams: () => mockSearch(),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/',
}));

import { ApiError } from '@/lib/api';
import type { AuthUser, Contractor, UserRole } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { SITE_WORKER_ROLES } from '@/components/projects/site-workers';
import { DRAWING_COMMENT_ROLES, commentError } from '@/components/projects/drawing-comments';
import { CONTRACTOR_WRITE_ROLES, contractorToForm, contractorUpdatePayload } from '@/app/(app)/contractors/contractor-form';
import EditContractorPage from '@/app/(app)/contractors/[contractorId]/edit/page';
import ContractorDetailPage from '@/app/(app)/contractors/[contractorId]/page';
import RevisionCommentsPage from '@/app/(app)/drawings/[drawingId]/revisions/[revisionId]/comments/page';
import DrawingDetailPage from '@/app/(app)/drawings/[drawingId]/page';
import InstructionDetailPage from '@/app/(app)/consultants/instructions/[instructionId]/page';
import SiteDetailPage from '@/app/(app)/projects/[projectId]/sites/[siteId]/page';
import SchedulesPage from '@/app/(app)/projects/[projectId]/sites/[siteId]/schedules/page';
import TargetsPage from '@/app/(app)/projects/[projectId]/sites/[siteId]/targets/page';
import NewAttendancePage from '@/app/(app)/projects/[projectId]/sites/[siteId]/attendance/new/page';
import NewTargetPage from '@/app/(app)/projects/[projectId]/sites/[siteId]/targets/new/page';

const API_ROUTES = path.resolve(__dirname, '..', '..', '..', 'api', 'src', 'routes');

function apiRoles(file: string, constName: string): string[] {
  const src = fs.readFileSync(path.join(API_ROUTES, file), 'utf8');
  const m = src.match(new RegExp(`const ${constName}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`${constName} not found in ${file}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}
const sorted = (r: readonly string[]) => [...r].sort();

const asUser = (role: UserRole) => {
  const user: AuthUser = {
    id: 'me', email: 'me@example.com', firstName: 'Me', lastName: 'User', role, companyId: 'c1',
    currency: 'KES', canViewFinance: false, defaultProjectId: null, defaultSiteId: null,
  };
  useAuthStore.setState({ user, accessToken: 't', isHydrated: true });
};

const contractor = (o: Partial<Contractor> = {}): Contractor => ({
  id: 'k1', companyId: 'c1', userId: null, name: 'BuildRight Ltd', contactPerson: 'Jane', email: 'jane@br.example',
  phone: null, registrationNumber: 'NCA-1', tradeSpecialization: 'Civil', isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...o,
});

const drawing = {
  id: 'd1', companyId: 'c1', projectId: 'p1', siteId: null, drawingNumber: 'A-101', title: 'Ground floor plan',
  discipline: 'architectural', currentRevisionId: 'r1', createdById: 'u1', createdAt: '', updatedAt: '', site: null,
  createdBy: { id: 'u1', firstName: 'Ann', lastName: 'Arch' },
  revisions: [{
    id: 'r1', drawingId: 'd1', companyId: 'c1', revisionNumber: 'B', fileUrl: '/api/v1/files/x', fileName: 'a.pdf',
    fileSizeBytes: 2048, fileType: 'application/pdf', status: 'issued_for_review', issueDate: null, uploadedById: 'u1',
    approvedById: null, approvedAt: null, notes: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '',
    uploadedBy: { id: 'u1', firstName: 'Ann', lastName: 'Arch' }, approvedBy: null,
  }],
};

const comment = (id: string, text: string) => ({
  id, companyId: 'c1', drawingId: 'd1', revisionId: 'r1', userId: 'u2', text,
  createdAt: '2026-11-02T08:00:00.000Z', updatedAt: '', user: { id: 'u2', firstName: 'Sam', lastName: 'Site', role: 'site_supervisor' },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch.mockImplementation(() => new URLSearchParams());
});

// ── role lists ────────────────────────────────────────────────────────────────

describe('role lists mirror the API', () => {
  it('site workers: view / assign match worker.routes.ts', () => {
    expect(sorted(SITE_WORKER_ROLES.view)).toEqual(apiRoles('worker.routes.ts', 'VIEW_ROLES'));
    expect(sorted(SITE_WORKER_ROLES.assign)).toEqual(apiRoles('worker.routes.ts', 'ASSIGN_ROLES'));
  });

  it('drawing comments: view / comment match drawing.routes.ts', () => {
    expect(sorted(DRAWING_COMMENT_ROLES.view)).toEqual(apiRoles('drawing.routes.ts', 'VIEW_ROLES'));
    expect(sorted(DRAWING_COMMENT_ROLES.comment)).toEqual(apiRoles('drawing.routes.ts', 'COMMENT_ROLES'));
  });

  it('contractor edit/deactivate match contractor.routes.ts WRITE_ROLES', () => {
    expect(sorted(CONTRACTOR_WRITE_ROLES)).toEqual(apiRoles('contractor.routes.ts', 'WRITE_ROLES'));
  });

  it('positive control: the parser reads a multi-line list', () => {
    expect(apiRoles('drawing.routes.ts', 'COMMENT_ROLES')).toContain('finance_officer');
    expect(apiRoles('drawing.routes.ts', 'COMMENT_ROLES')).not.toContain('viewer');
  });
});

// ── contractors ───────────────────────────────────────────────────────────────

describe('contractor edit', () => {
  beforeEach(() => mockParams.mockReturnValue({ contractorId: 'k1' }));

  it('payload: only changed fields, cleared optional fields become null', () => {
    const before = contractor();
    const form = { ...contractorToForm(before), contactPerson: '', phone: '+254700000000', isActive: false };
    expect(contractorUpdatePayload(before, form)).toEqual({ contactPerson: null, phone: '+254700000000', isActive: false });
    expect(contractorUpdatePayload(before, contractorToForm(before))).toEqual({});
  });

  it('the edit page exists where the detail page links to it', () => {
    const app = path.resolve(__dirname, '..', 'app', '(app)', 'contractors', '[contractorId]');
    expect(fs.readFileSync(path.join(app, 'page.tsx'), 'utf8')).toMatch(/\/contractors\/\$\{contractorId\}\/edit/);
    expect(fs.existsSync(path.join(app, 'edit', 'page.tsx'))).toBe(true);
  });

  it('project_manager edits and saves only the changed fields', async () => {
    asUser('project_manager');
    mockApi.contractorGet.mockResolvedValue({ contractor: contractor() });
    mockApi.contractorUpdate.mockResolvedValue({ contractor: contractor({ name: 'BuildRight Civil' }) });
    render(<EditContractorPage />);
    const name = await screen.findByLabelText('Company Name');
    fireEvent.change(name, { target: { value: 'BuildRight Civil' } });
    fireEvent.change(screen.getByLabelText('Contact Person'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mockApi.contractorUpdate).toHaveBeenCalledWith('k1', { name: 'BuildRight Civil', contactPerson: null }));
    expect(mockPush).toHaveBeenCalledWith('/contractors/k1');
  });

  it('shows a 422 detail for a field without silently re-enabling', async () => {
    asUser('company_admin');
    mockApi.contractorGet.mockResolvedValue({ contractor: contractor() });
    mockApi.contractorUpdate.mockRejectedValue(new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', { email: ['Invalid email'] }));
    render(<EditContractorPage />);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'x@y.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Invalid email')).toBeInTheDocument();
  });

  it('roles the API rejects get an explanation and no request', () => {
    asUser('site_supervisor');
    render(<EditContractorPage />);
    expect(screen.getByText(/Only a company admin or project manager can edit contractors/)).toBeInTheDocument();
    expect(mockApi.contractorGet).not.toHaveBeenCalled();
  });

  it('detail page deactivates after confirmation', async () => {
    asUser('company_admin');
    mockApi.contractorGet.mockResolvedValue({ contractor: contractor() });
    mockApi.contractorDeactivate.mockResolvedValue(undefined);
    render(<ContractorDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect(mockApi.contractorDeactivate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivate' }));
    await waitFor(() => expect(mockApi.contractorDeactivate).toHaveBeenCalledWith('k1'));
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
  });

  it('detail page shows no Edit/Deactivate to a viewer-type role', async () => {
    asUser('contractor');
    mockApi.contractorGet.mockResolvedValue({ contractor: contractor() });
    render(<ContractorDetailPage />);
    await screen.findAllByText('BuildRight Ltd');
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });
});

// ── drawing comments / missing projectId ─────────────────────────────────────

describe('drawing revision comments page', () => {
  beforeEach(() => {
    mockParams.mockReturnValue({ drawingId: 'd1', revisionId: 'r1' });
    mockSearch.mockImplementation(() => new URLSearchParams('projectId=p1'));
    mockApi.drawingGet.mockResolvedValue({ drawing });
    mockApi.listComments.mockResolvedValue({ comments: [comment('c1', 'Column grid clashes with duct')] });
  });

  it('lists comments and posts a new one', async () => {
    asUser('site_supervisor');
    mockApi.addComment.mockResolvedValue({ comment: comment('c2', 'Please confirm slab level') });
    render(<RevisionCommentsPage />);
    expect(await screen.findByText('Column grid clashes with duct')).toBeInTheDocument();
    expect(screen.getByText(/A-101 · Rev B/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: '  Please confirm slab level ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post Comment' }));
    await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledWith('p1', 'd1', 'r1', 'Please confirm slab level'));
    expect(await screen.findByText('Please confirm slab level')).toBeInTheDocument();
    expect(mockApi.listComments).toHaveBeenCalledWith('p1', 'd1', 'r1');
  });

  it('viewer can read but is not offered the comment box (API COMMENT_ROLES)', async () => {
    asUser('viewer');
    render(<RevisionCommentsPage />);
    expect(await screen.findByText('Column grid clashes with duct')).toBeInTheDocument();
    expect(screen.queryByLabelText('Comment')).toBeNull();
    expect(screen.getByText(/can read comments but not add them/)).toBeInTheDocument();
  });

  it('shows a post failure', async () => {
    asUser('company_admin');
    mockApi.addComment.mockRejectedValue(new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', { text: ['Too long'] }));
    render(<RevisionCommentsPage />);
    fireEvent.change(await screen.findByLabelText('Comment'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post Comment' }));
    expect(await screen.findByText('Too long')).toBeInTheDocument();
  });

  it('without ?projectId: explains, links back, and calls nothing', async () => {
    asUser('company_admin');
    mockSearch.mockImplementation(() => new URLSearchParams());
    render(<RevisionCommentsPage />);
    expect(await screen.findByText(/missing its project/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Drawings/ })).toHaveAttribute('href', '/drawings');
    expect(mockApi.listComments).not.toHaveBeenCalled();
  });

  it('commentError mirrors commentSchema (1..5000)', () => {
    expect(commentError('   ')).not.toBe('');
    expect(commentError('x'.repeat(5001))).not.toBe('');
    expect(commentError('ok')).toBe('');
  });

  it('the drawing page links to this page with an encoded projectId', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'app', '(app)', 'drawings', '[drawingId]', 'page.tsx'), 'utf8');
    expect(src).toMatch(/revisions\/\$\{revision\.id\}\/comments\?projectId=\$\{encodeURIComponent\(projectId\)\}/);
  });
});

describe('detail pages without ?projectId no longer spin forever', () => {
  it('drawing detail', async () => {
    asUser('company_admin');
    mockParams.mockReturnValue({ drawingId: 'd1' });
    render(<DrawingDetailPage />);
    expect(await screen.findByText(/drawing link is missing its project/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Drawings/ })).toHaveAttribute('href', '/drawings');
    expect(mockApi.drawingGet).not.toHaveBeenCalled();
  });

  it('instruction detail', async () => {
    asUser('company_admin');
    mockParams.mockReturnValue({ instructionId: 'i1' });
    render(<InstructionDetailPage />);
    expect(await screen.findByText(/instruction link is missing its project/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Instructions/ })).toHaveAttribute('href', '/consultants/instructions');
    expect(mockApi.instructionGet).not.toHaveBeenCalled();
  });
});

// ── silent failures ──────────────────────────────────────────────────────────

const site = { id: 's1', companyId: 'c1', projectId: 'p1', name: 'North Yard', address: null, latitude: null, longitude: null, isActive: true, createdAt: '' };
const worker = { id: 'w1', firstName: 'Peter', lastName: 'Kamau', trade: 'Mason' };

describe('site page', () => {
  beforeEach(() => {
    mockParams.mockReturnValue({ projectId: 'p1', siteId: 's1' });
    mockApi.siteGet.mockResolvedValue({ site });
    mockApi.attendanceSummary.mockResolvedValue({ summary: { present: 1, absent: 0 } });
    mockApi.targetsSummary.mockResolvedValue({ summary: { total: 0, approved: 0, withActual: 0, avgCompletion: 0 } });
    mockApi.scheduleSummary.mockResolvedValue({ summary: { tasks: { total: 0 } } });
    mockApi.listSiteWorkers.mockResolvedValue({ workers: [worker] });
  });

  it('a failed worker removal is reported', async () => {
    asUser('project_manager');
    mockApi.removeFromSite.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Insufficient permissions'));
    render(<SiteDetailPage />);
    expect(await screen.findByText('Peter Kamau')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(await screen.findByText(/Could not remove Peter Kamau: Insufficient permissions/)).toBeInTheDocument();
  });

  it('a failed worker list load is not shown as "No workers assigned"', async () => {
    asUser('site_supervisor');
    mockApi.listSiteWorkers.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'));
    render(<SiteDetailPage />);
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.queryByText('No workers assigned to this site.')).toBeNull();
  });

  it('roles the worker/summary endpoints reject are not sent those requests', async () => {
    asUser('contractor');
    render(<SiteDetailPage />);
    await screen.findAllByText('North Yard');
    expect(mockApi.listSiteWorkers).not.toHaveBeenCalled();
    expect(mockApi.attendanceSummary).not.toHaveBeenCalled();
    expect(mockApi.targetsSummary).not.toHaveBeenCalled();
    expect(mockApi.scheduleSummary).toHaveBeenCalled(); // contractors may view schedules
    expect(screen.queryByText('Assigned Workers')).toBeNull();
  });

  it('asks for today\'s summary by the local date', async () => {
    asUser('company_admin');
    jest.useFakeTimers({ now: new Date(2026, 10, 6, 1, 30), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'queueMicrotask'] });
    try {
      render(<SiteDetailPage />);
      await screen.findAllByText('North Yard');
      expect(mockApi.attendanceSummary).toHaveBeenCalledWith('p1', 's1', '2026-11-06');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('schedule page under a 403', () => {
  it('shows the error, not the "Create the first work package" empty state', async () => {
    asUser('company_admin');
    mockParams.mockReturnValue({ projectId: 'p1', siteId: 's1' });
    mockApi.listTasks.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not assigned to this project'));
    mockApi.listPackages.mockResolvedValue({ packages: [] });
    render(<SchedulesPage />);
    expect(await screen.findByText('You are not assigned to this project')).toBeInTheDocument();
    expect(screen.queryByText(/Create the first work package/)).toBeNull();
    expect(screen.queryByText('No schedule tasks yet')).toBeNull();
  });
});

describe('targets page', () => {
  it('approving a target refreshes the summary cards', async () => {
    asUser('site_supervisor');
    mockParams.mockReturnValue({ projectId: 'p1', siteId: 's1' });
    const target = {
      id: 't1', description: 'Pour slab', targetValue: '10', targetUnit: 'm3', actualValue: null,
      completionPct: null, approvedById: null, notes: null, worker: null,
    };
    mockApi.targetsList.mockResolvedValue({ targets: [target] });
    mockApi.targetsSummary
      .mockResolvedValueOnce({ summary: { total: 1, approved: 0, withActual: 0, avgCompletion: 0 } })
      .mockResolvedValueOnce({ summary: { total: 1, approved: 1, withActual: 0, avgCompletion: 0 } });
    mockApi.targetsApprove.mockResolvedValue({ target: { ...target, approvedById: 'me' } });
    render(<TargetsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mockApi.targetsSummary).toHaveBeenCalledTimes(2));
    // StatCard: <p>{value}</p><p>{label}</p>
    await waitFor(() => {
      const label = screen.getByText('Approved', { selector: 'p' });
      expect(label.previousElementSibling?.textContent).toBe('1');
    });
  });
});

describe('new attendance / target forms', () => {
  beforeEach(() => mockParams.mockReturnValue({ projectId: 'p1', siteId: 's1' }));

  it('attendance: a worker-load failure is shown', async () => {
    asUser('site_supervisor');
    mockApi.listSiteWorkers.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Insufficient permissions'));
    render(<NewAttendancePage />);
    expect(await screen.findByText(/Could not load this site's workers: Insufficient permissions/)).toBeInTheDocument();
  });

  it('attendance: an empty site says so and links to the site page', async () => {
    asUser('site_supervisor');
    mockApi.listSiteWorkers.mockResolvedValue({ workers: [] });
    render(<NewAttendancePage />);
    expect(await screen.findByText(/No workers are assigned to this site yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Assign workers on the site page/ })).toHaveAttribute('href', '/projects/p1/sites/s1');
  });

  it('target: a worker-load failure is shown', async () => {
    asUser('site_supervisor');
    mockApi.listSiteWorkers.mockRejectedValue(new Error('offline'));
    render(<NewTargetPage />);
    expect(await screen.findByText(/Could not load this site's workers: request failed/)).toBeInTheDocument();
  });
});
