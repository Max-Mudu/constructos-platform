'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Bell, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { projectApi, siteApi, authApi, ApiError } from '@/lib/api';
import { Project, JobSite } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';

export default function SettingsPage() {
  const { user, accessToken, setAuth } = useAuthStore();

  const [projects, setProjects]               = useState<Project[]>([]);
  const [sites, setSites]                     = useState<JobSite[]>([]);
  const [projectId, setProjectId]             = useState(user?.defaultProjectId ?? '');
  const [siteId, setSiteId]                   = useState(user?.defaultSiteId ?? '');
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [sitesLoading, setSitesLoading]       = useState(false);
  const [saving, setSaving]                   = useState(false);
  const [clearing, setClearing]               = useState(false);
  const [error, setError]                     = useState('');
  const [saved, setSaved]                     = useState(false);
  const [savedMessage, setSavedMessage]       = useState('');

  // Load all projects once on mount (for the project selector)
  useEffect(() => {
    projectApi.list()
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load projects'))
      .finally(() => setProjectsLoading(false));
  }, []);

  // Reload sites whenever the selected project changes
  useEffect(() => {
    if (!projectId) {
      setSites([]);
      return;
    }
    setSitesLoading(true);
    siteApi.list(projectId)
      .then((r) => {
        setSites(r.sites);
        // Keep the current siteId only if it belongs to the new project
        setSiteId((prev) => (r.sites.some((s) => s.id === prev) ? prev : ''));
      })
      .catch(() => setSites([]))
      .finally(() => setSitesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function handleProjectChange(newProjectId: string) {
    setProjectId(newProjectId);
    setSiteId('');
    setSaved(false);
    setError('');
  }

  async function handleSave() {
    if (!projectId || !siteId || !accessToken) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const result = await authApi.updateDefaults({ defaultProjectId: projectId, defaultSiteId: siteId });
      setAuth(result.user, accessToken);
      setSavedMessage('Default workspace saved.');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save workspace');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!accessToken) return;
    setClearing(true);
    setError('');
    setSaved(false);
    try {
      const result = await authApi.updateDefaults({ defaultProjectId: null, defaultSiteId: null });
      setAuth(result.user, accessToken);
      setProjectId('');
      setSiteId('');
      setSavedMessage('Default workspace cleared.');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to clear workspace');
    } finally {
      setClearing(false);
    }
  }

  const hasDefaults = !!(user?.defaultProjectId && user?.defaultSiteId);
  const hasChanged  = projectId !== (user?.defaultProjectId ?? '') || siteId !== (user?.defaultSiteId ?? '');
  const canSave     = !!(projectId && siteId && hasChanged && !saving);

  return (
    <div className="px-6 py-8 space-y-8 animate-fade-in">
      <PageHeader
        title="Settings"
        subtitle="Platform and account configuration"
      />

      {/* ── Default Workspace ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Default Workspace</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasDefaults
              ? 'Operational modules open directly to your default workspace.'
              : 'Set a default workspace to skip project and site selection in operational modules.'}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          {projectsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full rounded-lg" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Default Project"
                value={projectId}
                onChange={(e) => handleProjectChange(e.target.value)}
              >
                <option value="">Select a project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>

              <Select
                label="Default Site"
                value={siteId}
                onChange={(e) => { setSiteId(e.target.value); setSaved(false); setError(''); }}
                disabled={!projectId || sitesLoading}
              >
                <option value="">
                  {sitesLoading ? 'Loading sites…' : projectId ? 'Select a site' : 'Select a project first'}
                </option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {saved && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <AlertDescription>{savedMessage}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={handleSave}
              disabled={!canSave}
              loading={saving}
            >
              Save workspace
            </Button>
            {hasDefaults && !saving && (
              <Button
                variant="outline"
                onClick={handleClear}
                disabled={clearing}
                loading={clearing}
              >
                Clear defaults
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* ── Notifications ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage in-app notification preferences.
          </p>
        </div>
        <Link
          href="/settings/notifications"
          className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 hover:bg-navy-elevated transition-colors group"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
            <Bell className="h-4 w-4 text-primary/70" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Notification Preferences</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose which events trigger in-app notifications.
            </p>
          </div>
          <span className="text-sm text-muted-foreground/40 group-hover:text-muted-foreground transition-colors select-none">
            →
          </span>
        </Link>
      </section>
    </div>
  );
}
