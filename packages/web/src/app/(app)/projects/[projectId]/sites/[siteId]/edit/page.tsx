'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { siteApi, ApiError } from '@/lib/api';
import type { JobSite } from '@/lib/types';
import { formErrorState } from '@/lib/workflows-form-errors';
import {
  canEditSite, siteAdminApi, siteFormErrors, siteToForm, siteUpdatePayload,
  type SiteFormValues,
} from '@/lib/projects-admin-api';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { NotAllowed } from '@/components/projects/ProjectForm';
import { SITE_INLINE_FIELDS, SiteForm } from '@/components/projects/SiteForm';

export default function EditSitePage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>()!;
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const allowed = canEditSite(user?.role);
  const siteHref = `/projects/${projectId}/sites/${siteId}`;

  const [site, setSite]               = useState<JobSite | null>(null);
  const [form, setForm]               = useState<SiteFormValues | null>(null);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!projectId || !siteId || !allowed) { setLoading(false); return; }
    siteApi.get(projectId, siteId)
      .then(({ site: s }) => { setSite(s); setForm(siteToForm(s)); })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Failed to load site'))
      .finally(() => setLoading(false));
  }, [projectId, siteId, allowed]);

  async function handleSubmit() {
    if (!site || !form) return;
    const local = siteFormErrors(form);
    if (Object.keys(local).length > 0) { setFieldErrors(local); setError(''); return; }

    const payload = siteUpdatePayload(site, form);
    if (Object.keys(payload).length === 0) { router.push(siteHref); return; }

    setSubmitting(true);
    setError('');
    setFieldErrors({});
    try {
      await siteAdminApi.update(projectId, siteId, payload);
      router.push(siteHref);
    } catch (e) {
      const state = formErrorState(e, SITE_INLINE_FIELDS, 'Failed to save site');
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
        { label: site?.name ?? 'Site', href: siteHref },
        { label: 'Edit' },
      ]} />
      <PageHeader title="Edit Job Site" subtitle={site?.name} />

      {!allowed ? (
        <NotAllowed
          message="Only a company admin or project manager can edit job sites."
          backHref={siteHref}
          backLabel="Back to Site"
        />
      ) : loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : loadError || !form ? (
        <NotAllowed
          message={loadError || 'Site not found'}
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
          submitLabel="Save Changes"
          submittingLabel="Saving…"
          cancelHref={siteHref}
          showActive
        />
      )}
    </div>
  );
}
