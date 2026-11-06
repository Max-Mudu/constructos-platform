/**
 * Team management form rules — must mirror the API (user.service
 * ASSIGNABLE_USER_ROLES / COMPANY_WIDE_ROLES and createCompanyUser checks).
 */
import {
  ASSIGNABLE_TEAM_ROLES,
  COMPANY_WIDE_TEAM_ROLES,
  EMPTY_MEMBER_FORM,
  ROLE_LABELS,
  buildCreatePayload,
  canManageTeam,
  describeCreateError,
  isAssignableRole,
  validateMemberForm,
  type NewMemberForm,
} from '@/lib/team-roles';

const base = (o: Partial<NewMemberForm> = {}): NewMemberForm => ({
  ...EMPTY_MEMBER_FORM,
  email: 'ana@example.com',
  firstName: 'Ana',
  lastName: 'Lee',
  ...o,
});

describe('assignable roles', () => {
  it('matches the API list exactly and never includes super_admin or worker', () => {
    expect([...ASSIGNABLE_TEAM_ROLES]).toEqual([
      'company_admin', 'finance_officer', 'project_manager', 'site_supervisor',
      'contractor', 'consultant', 'viewer',
    ]);
    expect(isAssignableRole('super_admin')).toBe(false);
    expect(isAssignableRole('worker')).toBe(false);
  });

  it('treats only company_admin and finance_officer as company-wide', () => {
    expect([...COMPANY_WIDE_TEAM_ROLES]).toEqual(['company_admin', 'finance_officer']);
  });

  it('has a human label for every role', () => {
    for (const r of ASSIGNABLE_TEAM_ROLES) expect(ROLE_LABELS[r]).toMatch(/^[A-Z]/);
  });
});

describe('validateMemberForm', () => {
  it('requires email, names and role', () => {
    const errors = validateMemberForm(EMPTY_MEMBER_FORM);
    expect(errors.email).toBeTruthy();
    expect(errors.firstName).toBeTruthy();
    expect(errors.lastName).toBeTruthy();
    expect(errors.role).toBeTruthy();
  });

  it('rejects a malformed email', () => {
    expect(validateMemberForm(base({ email: 'not-an-email', role: 'viewer' })).email).toBeTruthy();
  });

  it('rejects roles outside the assignable list even if forced into the form', () => {
    const forced = base({ role: 'super_admin' as unknown as NewMemberForm['role'] });
    expect(validateMemberForm(forced).role).toBe('This role cannot be assigned here');
    const worker = base({ role: 'worker' as unknown as NewMemberForm['role'] });
    expect(validateMemberForm(worker).role).toBeTruthy();
  });

  it.each(['company_admin', 'finance_officer'] as const)(
    '%s may omit project and site',
    (role) => {
      expect(validateMemberForm(base({ role }))).toEqual({});
    },
  );

  it('company-wide roles must give project and site together when they give one', () => {
    expect(validateMemberForm(base({ role: 'finance_officer', projectId: 'p1' })).siteId).toBeTruthy();
    expect(validateMemberForm(base({ role: 'finance_officer', siteId: 's1' })).projectId).toBeTruthy();
    expect(validateMemberForm(base({ role: 'finance_officer', projectId: 'p1', siteId: 's1' }))).toEqual({});
  });

  it.each(['project_manager', 'site_supervisor', 'contractor', 'consultant', 'viewer'] as const)(
    '%s requires both project and site',
    (role) => {
      const neither = validateMemberForm(base({ role }));
      expect(neither.projectId).toBeTruthy();
      expect(neither.siteId).toBeTruthy();
      expect(validateMemberForm(base({ role, projectId: 'p1' })).siteId).toBeTruthy();
      expect(validateMemberForm(base({ role, siteId: 's1' })).projectId).toBeTruthy();
      expect(validateMemberForm(base({ role, projectId: 'p1', siteId: 's1' }))).toEqual({});
    },
  );

  it('enforces the server length limits', () => {
    const long = 'x'.repeat(101);
    const errors = validateMemberForm(base({ role: 'viewer', projectId: 'p', siteId: 's', firstName: long, lastName: long, phone: '1'.repeat(31) }));
    expect(errors.firstName).toBeTruthy();
    expect(errors.lastName).toBeTruthy();
    expect(errors.phone).toBeTruthy();
  });
});

describe('buildCreatePayload', () => {
  it('trims, drops empties and omits project/site for a company-wide role without them', () => {
    expect(buildCreatePayload(base({ email: ' ana@example.com ', role: 'finance_officer', phone: '  ' }))).toEqual({
      email: 'ana@example.com', firstName: 'Ana', lastName: 'Lee', role: 'finance_officer',
    });
  });

  it('sends consultantType only for consultants', () => {
    const c = buildCreatePayload(base({ role: 'consultant', consultantType: 'architect', projectId: 'p1', siteId: 's1' }));
    expect(c).toMatchObject({ consultantType: 'architect', defaultProjectId: 'p1', defaultSiteId: 's1' });

    const v = buildCreatePayload(base({ role: 'viewer', consultantType: 'architect', projectId: 'p1', siteId: 's1' }));
    expect(v).not.toHaveProperty('consultantType');
  });

  it('never sends companyId, password, isActive or canViewFinance', () => {
    const p = buildCreatePayload(base({ role: 'company_admin' })) as unknown as Record<string, unknown>;
    for (const k of ['companyId', 'password', 'isActive', 'canViewFinance']) expect(p).not.toHaveProperty(k);
  });

  it('refuses to build a payload for a non-assignable role', () => {
    expect(() => buildCreatePayload(base({ role: 'super_admin' as unknown as NewMemberForm['role'] }))).toThrow();
  });
});

describe('describeCreateError', () => {
  it('explains a duplicate email (409)', () => {
    expect(describeCreateError({ status: 409, message: 'An account with this email already exists' }))
      .toMatch(/already exists/);
  });

  it('shows the server 404 resource', () => {
    expect(describeCreateError({ status: 404, message: 'Site not found' })).toMatch(/^Site not found in your company/);
  });

  it('lists 422 field details, or falls back to the server message', () => {
    expect(describeCreateError({ status: 422, message: 'Validation failed', details: { email: ['Invalid email'] } }))
      .toBe('Please fix: email: Invalid email');
    expect(describeCreateError({ status: 422, message: "Both defaultProjectId and defaultSiteId are required for role 'viewer'" }))
      .toMatch(/required for role 'viewer'/);
  });

  it('handles 403 and unknown errors', () => {
    expect(describeCreateError({ status: 403 })).toMatch(/Only company admins/);
    expect(describeCreateError(new Error('boom'))).toBe('boom');
    expect(describeCreateError(undefined)).toMatch(/Could not add/);
  });
});

describe('canManageTeam', () => {
  it('is true only for company_admin', () => {
    expect(canManageTeam('company_admin')).toBe(true);
    for (const r of ['super_admin', 'finance_officer', 'project_manager', 'site_supervisor', 'contractor', 'consultant', 'worker', 'viewer'] as const) {
      expect(canManageTeam(r)).toBe(false);
    }
    expect(canManageTeam(null)).toBe(false);
    expect(canManageTeam(undefined)).toBe(false);
  });
});
