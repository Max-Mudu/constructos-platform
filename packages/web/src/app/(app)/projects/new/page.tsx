'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { projectApi } from '@/lib/api';
import { formErrorState } from '@/lib/workflows-form-errors';
import {
  canCreateProject, projectFormErrors, type ProjectFormValues,
} from '@/lib/projects-admin-api';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { NotAllowed, PROJECT_INLINE_FIELDS, ProjectForm } from '@/components/projects/ProjectForm';

const EMPTY: ProjectFormValues = {
  name: '', code: '', description: '', location: '', startDate: '', endDate: '', status: 'active',
};

export default function NewProjectPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [form, setForm]               = useState<ProjectFormValues>(EMPTY);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit() {
    const local = projectFormErrors(form);
    if (Object.keys(local).length > 0) { setFieldErrors(local); setError(''); return; }

    setSubmitting(true);
    setError('');
    setFieldErrors({});
    try {
      const payload: Parameters<typeof projectApi.create>[0] = { name: form.name.trim(), status: form.status };
      if (form.code.trim())        payload.code = form.code.trim();
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.location.trim())    payload.location = form.location.trim();
      if (form.startDate)          payload.startDate = form.startDate;
      if (form.endDate)            payload.endDate = form.endDate;

      const { project } = await projectApi.create(payload);
      router.push(`/projects/${project.id}`);
    } catch (e) {
      const state = formErrorState(e, PROJECT_INLINE_FIELDS, 'Failed to create project');
      setFieldErrors(state.fieldErrors);
      setError(state.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-6 py-8 max-w-2xl space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: 'Projects', href: '/projects' }, { label: 'New Project' }]} />
      <PageHeader title="New Project" subtitle="Create a new construction project." />

      {!canCreateProject(user?.role) ? (
        <NotAllowed
          message="Only a company admin can create projects."
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
          submitLabel="Create Project"
          submittingLabel="Creating…"
          cancelHref="/projects"
        />
      )}
    </div>
  );
}
