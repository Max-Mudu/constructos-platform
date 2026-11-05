'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import type { JobSite, Project } from '@/lib/types';
import { useDailyProjects, useDailySites } from './hooks';
import { describeError } from './report-errors';
import { pickDefaultId, readLastSite, writeLastSite } from './site-select';
import { DButton, DCard, FieldLabel, Notice, SelectInput, Skeleton } from './ui';

export interface SiteSelection {
  project: Project;
  site: JobSite;
}

/**
 * Project + site picker. Defaults to the user's default project/site, then
 * the last site used on this phone, and auto-selects when only one exists.
 * Collapses to a one-line summary once a site is chosen.
 */
export function SitePicker({ onChange }: { onChange: (sel: SiteSelection | null) => void }) {
  const user = useAuthStore((s) => s.user);
  const projectsQ = useDailyProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const sitesQ = useDailySites(projectId);
  const [lastSite] = useState(() => (typeof window === 'undefined' ? null : readLastSite()));
  const last = useRef(lastSite);
  const projectAutoDone = useRef(false);
  const siteAutoFor = useRef<string | null>(null);

  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);
  const sites = useMemo(() => sitesQ.data ?? [], [sitesQ.data]);

  // Default project once projects load.
  useEffect(() => {
    if (projectAutoDone.current || !projectsQ.isSuccess) return;
    projectAutoDone.current = true;
    const id = pickDefaultId(projects, [user?.defaultProjectId, last.current?.projectId]);
    setProjectId(id);
    if (!id) setExpanded(true);
  }, [projectsQ.isSuccess, projects, user?.defaultProjectId]);

  // Default site whenever a project's sites load.
  useEffect(() => {
    if (!projectId || !sitesQ.isSuccess || siteAutoFor.current === projectId) return;
    siteAutoFor.current = projectId;
    const preferred = [
      user?.defaultProjectId === projectId ? user?.defaultSiteId : null,
      last.current?.projectId === projectId ? last.current.siteId : null,
    ];
    const id = pickDefaultId(sites, preferred);
    setSiteId(id);
    if (!id) setExpanded(true);
  }, [projectId, sitesQ.isSuccess, sites, user?.defaultProjectId, user?.defaultSiteId]);

  const project = projects.find((p) => p.id === projectId) ?? null;
  const site = sites.find((s) => s.id === siteId) ?? null;

  useEffect(() => {
    if (project && site) {
      writeLastSite({ projectId: project.id, siteId: site.id });
      onChange({ project, site });
    } else {
      onChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, site?.id]);

  if (projectsQ.isPending) {
    return (
      <DCard>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-11 w-full" />
      </DCard>
    );
  }
  if (projectsQ.isError) {
    const e = describeError(projectsQ.error);
    return (
      <Notice tone="danger" title={e.title} actions={<DButton variant="secondary" size="sm" onClick={() => void projectsQ.refetch()}>Try again</DButton>}>
        {e.message}
      </Notice>
    );
  }
  if (projects.length === 0) {
    return (
      <Notice tone="info" title="No projects yet">
        You are not assigned to any project. Ask your project manager to add you to a project and site.
      </Notice>
    );
  }

  if (project && site && !expanded) {
    return (
      <DCard className="flex items-center gap-3 py-3">
        <MapPin className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">{site.name}</p>
          <p className="truncate text-sm text-muted-foreground">{project.name}</p>
        </div>
        {(projects.length > 1 || sites.length > 1) && (
          <DButton variant="ghost" size="sm" onClick={() => setExpanded(true)}>Change</DButton>
        )}
      </DCard>
    );
  }

  return (
    <DCard className="space-y-4">
      <div>
        <FieldLabel htmlFor="dr-project">Project</FieldLabel>
        <SelectInput
          id="dr-project"
          value={projectId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null;
            setProjectId(id);
            setSiteId(null);
            siteAutoFor.current = null;
          }}
        >
          <option value="" disabled>Choose a project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectInput>
      </div>
      <div>
        <FieldLabel htmlFor="dr-site">Site</FieldLabel>
        {projectId && sitesQ.isPending ? (
          <Skeleton className="h-11 w-full" />
        ) : sitesQ.isError ? (
          <Notice tone="danger" title={describeError(sitesQ.error).title}
            actions={<DButton variant="secondary" size="sm" onClick={() => void sitesQ.refetch()}>Try again</DButton>}>
            {describeError(sitesQ.error).message}
          </Notice>
        ) : projectId && sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">This project has no active sites.</p>
        ) : (
          <SelectInput
            id="dr-site"
            value={siteId ?? ''}
            disabled={!projectId}
            onChange={(e) => {
              setSiteId(e.target.value || null);
              if (e.target.value) setExpanded(false);
            }}
          >
            <option value="" disabled>{projectId ? 'Choose a site' : 'Choose a project first'}</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectInput>
        )}
      </div>
      {project && site && (
        <DButton variant="secondary" block onClick={() => setExpanded(false)}>Done</DButton>
      )}
    </DCard>
  );
}
