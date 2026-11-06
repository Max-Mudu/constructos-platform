'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { formErrorState } from '@/lib/workflows-form-errors';
import {
  canCreateSite, emptySiteForm, siteAdminApi, siteCreatePayload, siteFormErrors,
  type SiteFormValues,
} from '@/lib/projects-admin-api';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { NotAllowed } from '@/components/projects/ProjectForm';
import { SITE_INLINE_FIELDS, SiteForm } from '@/components/projects/SiteForm';

export default function NewSitePage() {
  const router = useRouter();
  const { projectId } = useParams<{ projectId: string }>()!;
  const user = useAuthStore((s) => s.user);

  const [form, setForm]               = useState<SiteFormValues>(emptySiteForm());
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit() {
    if (!projectId) return;
    const local = siteFormErrors(form);
    if (Object.keys(local).length > 0) { setFieldErrors(local); setError(''); return; }

    setSubmitting(true);
    setError('');
    setFieldErrors({});
    try {
      const { site } = await siteAdminApi.create(projectId, siteCreatePayload(form));
      router.push(`/projects/${projectId}/sites/${site.id}`);
    } catch (e) {
      const state = formErrorState(e, SITE_INLINE_FIELDS, 'Failed to add site');
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
        { label: 'Project', href: `/projects/${projectId}` },
        { label: 'New Site' },
      ]} />
      <PageHeader title="Add Job Site" subtitle="Add a new job site to this project." />

      {!canCreateSite(user?.role) ? (
        <NotAllowed
          message="Only a company admin or project manager can add job sites."
          backHref={`/projects/${projectId}`}
          backLabel="Back to Project"
        />
      ) : (
        <SiteForm
          values={form}
          onChange={setForm}
          onSubmit={() => void handleSubmit()}
          fieldErrors={fieldErrors}
          error={error}
          submitting={submitting}
          submitLabel="Add Site"
          submittingLabel="Adding…"
          cancelHref={`/projects/${projectId}`}
        />
      )}
    </div>
  );
}
