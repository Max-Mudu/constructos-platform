'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { projectApi, siteApi, ApiError } from '@/lib/api';
import type { JobSite, Project } from '@/lib/types';
import { teamApi, type CreateTeamMemberResponse } from '@/lib/team-api';
import {
  ASSIGNABLE_TEAM_ROLES,
  CONSULTANT_TYPES,
  CONSULTANT_TYPE_LABELS,
  EMPTY_MEMBER_FORM,
  buildCreatePayload,
  describeCreateError,
  isCompanyWideRole,
  roleLabel,
  validateMemberForm,
  type AssignableTeamRole,
  type ConsultantType,
  type MemberFormErrors,
  type NewMemberForm,
} from '@/lib/team-roles';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

export interface AddMemberFormProps {
  onCreated: (result: CreateTeamMemberResponse) => void;
  onCancel:  () => void;
}

export function AddMemberForm({ onCreated, onCancel }: AddMemberFormProps) {
  const [form, setForm]                       = useState<NewMemberForm>(EMPTY_MEMBER_FORM);
  const [errors, setErrors]                   = useState<MemberFormErrors>({});
  const [serverError, setServerError]         = useState('');
  const [submitting, setSubmitting]           = useState(false);
  const [projects, setProjects]               = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError]     = useState('');
  const [sites, setSites]                     = useState<JobSite[]>([]);
  const [sitesLoading, setSitesLoading]       = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectApi.list()
      .then((r) => { if (!cancelled) setProjects(r.projects); })
      .catch((e) => {
        if (!cancelled) setProjectsError(e instanceof ApiError ? e.message : 'Failed to load projects');
      })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!form.projectId) { setSites([]); return; }
    let cancelled = false;
    setSitesLoading(true);
    siteApi.list(form.projectId)
      .then((r) => { if (!cancelled) setSites(r.sites); })
      .catch(() => { if (!cancelled) setSites([]); })
      .finally(() => { if (!cancelled) setSitesLoading(false); });
    return () => { cancelled = true; };
  }, [form.projectId]);

  function update<K extends keyof NewMemberForm>(key: K, value: NewMemberForm[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'projectId') next.siteId = '';
      if (key === 'role' && value !== 'consultant') next.consultantType = '';
      return next;
    });
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setServerError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const found = validateMemberForm(form);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    setSubmitting(true);
    setServerError('');
    try {
      const result = await teamApi.create(buildCreatePayload(form));
      setForm(EMPTY_MEMBER_FORM);
      onCreated(result);
    } catch (err) {
      setServerError(describeCreateError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const companyWide = form.role !== '' && isCompanyWideRole(form.role);
  const scopeHint = form.role === ''
    ? 'Choose a role first.'
    : companyWide
      ? `${roleLabel(form.role)}s can access every project; a default project and site are optional.`
      : `${roleLabel(form.role)}s only see the project they are assigned to; project and site are required.`;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Add team member"
      className="rounded-xl border border-border bg-card p-6 space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="team-first-name"
          label="First name"
          value={form.firstName}
          maxLength={100}
          onChange={(e) => update('firstName', e.target.value)}
          error={errors.firstName}
        />
        <Input
          id="team-last-name"
          label="Last name"
          value={form.lastName}
          maxLength={100}
          onChange={(e) => update('lastName', e.target.value)}
          error={errors.lastName}
        />
        <Input
          id="team-email"
          label="Email"
          type="email"
          autoComplete="off"
          value={form.email}
          onChange={(e) => update('email', e.target.value)}
          error={errors.email}
        />
        <Input
          id="team-phone"
          label="Phone (optional)"
          type="tel"
          value={form.phone}
          maxLength={30}
          onChange={(e) => update('phone', e.target.value)}
          error={errors.phone}
        />
        <Select
          id="team-role"
          label="Role"
          value={form.role}
          onChange={(e) => update('role', e.target.value as AssignableTeamRole | '')}
          error={errors.role}
        >
          <option value="">Select a role</option>
          {ASSIGNABLE_TEAM_ROLES.map((r) => (
            <option key={r} value={r}>{roleLabel(r)}</option>
          ))}
        </Select>
        {form.role === 'consultant' && (
          <Select
            id="team-consultant-type"
            label="Consultant type (optional)"
            value={form.consultantType}
            onChange={(e) => update('consultantType', e.target.value as ConsultantType | '')}
          >
            <option value="">Not specified</option>
            {CONSULTANT_TYPES.map((t) => (
              <option key={t} value={t}>{CONSULTANT_TYPE_LABELS[t]}</option>
            ))}
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{scopeHint}</p>
        {projectsError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{projectsError}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="team-project"
            label={companyWide ? 'Default project (optional)' : 'Project'}
            value={form.projectId}
            onChange={(e) => update('projectId', e.target.value)}
            disabled={projectsLoading || form.role === ''}
            error={errors.projectId}
          >
            <option value="">
              {projectsLoading ? 'Loading projects…' : projects.length ? 'Select a project' : 'No projects yet'}
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Select
            id="team-site"
            label={companyWide ? 'Default site (optional)' : 'Site'}
            value={form.siteId}
            onChange={(e) => update('siteId', e.target.value)}
            disabled={!form.projectId || sitesLoading}
            error={errors.siteId}
          >
            <option value="">
              {sitesLoading
                ? 'Loading sites…'
                : !form.projectId
                  ? 'Select a project first'
                  : sites.length ? 'Select a site' : 'This project has no sites'}
            </option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>
      </div>

      {serverError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={submitting} disabled={submitting}>Add member</Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
      </div>
    </form>
  );
}
