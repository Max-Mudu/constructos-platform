'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { projectApi, ApiError } from '@/lib/api';
import type { Project } from '@/lib/types';
import { formErrorState } from '@/lib/workflows-form-errors';
import {
  canEditProject, projectAdminApi, projectFormErrors, projectToForm, projectUpdatePayload,
  type ProjectFormValues,
} from '@/lib/projects-admin-api';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { NotAllowed, PROJECT_INLINE_FIELDS, ProjectForm } from '@/components/projects/ProjectForm';

export default function EditProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()!;
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const allowed = canEditProject(user?.role);

  const [project, setProject]         = useState<Project | null>(null);
  const [form, setForm]               = useState<ProjectFormValues | null>(null);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!projectId || !allowed) { setLoading(false); return; }
    projectApi.get(projectId)
      .then(({ project: p }) => { setProject(p); setForm(projectToForm(p)); })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Failed to load project'))
      .finally(() => setLoading(false));
  }, [projectId, allowed]);

  async function handleSubmit() {
    if (!project || !form) return;
    const local = projectFormErrors(form);
    if (Object.keys(local).length > 0) { setFieldErrors(local); setError(''); return; }

    const payload = projectUpdatePayload(project, form);
    if (Object.keys(payload).length === 0) { router.push(`/projects/${projectId}`); return; }

    setSubmitting(true);
    setError('');
    setFieldErrors({});
    try {
      await projectAdminApi.update(projectId, payload);
      router.push(`/projects/${projectId}`);
    } catch (e) {
      const state = formErrorState(e, PROJECT_INLINE_FIELDS, 'Failed to save project');
      setFieldErrors(state.fieldErrors);
      setError(state.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-6 py-8 max-w-2xl space-y-6 animate-fade-in">
      <Breadcrumb items={[
        { label: 'Projects', href: '/projects' },
        { label: project?.name ?? 'Project', href: `/projects/${projectId}` },
        { label: 'Edit' },
      ]} />
      <PageHeader title="Edit Project" subtitle={project?.name} />

      {!allowed ? (
        <NotAllowed
          message="Only a company admin can edit project details."
          backHref={`/projects/${projectId}`}
          backLabel="Back to Project"
        />
      ) : loading ? (
        <div className="space-y-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : loadError || !form || !project ? (
        <NotAllowed
          message={loadError || 'Project not found'}
          backHref="/projects"
          backLabel="Back to Projects"
        />
      ) : (
        <ProjectForm
          values={form}
          onChange={setForm}
          onSubmit={() => void handleSubmit()}
          fieldErrors={fieldErrors}
          error={error}
          submitting={submitting}
          submitLabel="Save Changes"
          submittingLabel="Saving…"
          cancelHref={`/projects/${projectId}`}
          currentStatus={project.status}
        />
      )}
    </div>
  );
}
