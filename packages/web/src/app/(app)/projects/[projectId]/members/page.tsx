'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { projectApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProjectMembers } from '@/components/members/ProjectMembers';

export default function ProjectMembersPage() {
  const { projectId } = useParams<{ projectId: string }>()!;
  const user = useAuthStore((s) => s.user);
  const [projectName, setProjectName] = useState('');

  useEffect(() => {
    if (!projectId) return;
    projectApi.get(projectId)
      .then(({ project }) => setProjectName(project.name))
      .catch(() => { /* the member list reports access errors itself */ });
  }, [projectId]);

  return (
    <div className="px-6 py-8 max-w-3xl space-y-6 animate-fade-in">
      <Breadcrumb items={[
        { label: 'Projects', href: '/projects' },
        { label: projectName || 'Project', href: `/projects/${projectId}` },
        { label: 'Members' },
      ]} />
      <PageHeader
        title="Project Members"
        subtitle={projectName
          ? `Who can work on ${projectName}, and on which sites.`
          : 'Who can work on this project, and on which sites.'}
      />
      {projectId && <ProjectMembers projectId={projectId} role={user?.role} />}
    </div>
  );
}
