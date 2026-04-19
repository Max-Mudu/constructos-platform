'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { instructionApi, projectApi, ApiError } from '@/lib/api';
import { ConsultantInstruction, Project } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import {
  ClipboardList, AlertCircle, Plus, ChevronRight,
  AlertTriangle, CheckCircle2, Clock, XCircle,
} from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  open:         'Open',
  acknowledged: 'Acknowledged',
  in_progress:  'In Progress',
  resolved:     'Resolved',
  rejected:     'Rejected',
};

const STATUS_VARIANT: Record<string, 'active' | 'inactive' | 'pending' | 'warning' | 'default'> = {
  open:         'warning',
  acknowledged: 'pending',
  in_progress:  'pending',
  resolved:     'active',
  rejected:     'inactive',
};

const PRIORITY_VARIANT: Record<string, 'active' | 'inactive' | 'pending' | 'warning' | 'default'> = {
  low:      'inactive',
  medium:   'pending',
  high:     'warning',
  critical: 'default',
};

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge variant={PRIORITY_VARIANT[priority] ?? 'default'} className={priority === 'critical' ? 'bg-red-100 text-red-700 border-red-200' : ''}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'resolved':     return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'rejected':     return <XCircle className="h-4 w-4 text-muted-foreground" />;
    case 'open':         return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    default:             return <Clock className="h-4 w-4 text-blue-500" />;
  }
}

export default function InstructionsPage() {
  const { user } = useAuthStore();
  const [projects, setProjects]           = useState<Project[]>([]);
  const [instructions, setInstructions]   = useState<ConsultantInstruction[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');
  const [projectId, setProjectId]         = useState('');
  const [statusFilter, setStatusFilter]   = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [typeFilter, setTypeFilter]       = useState('');

  const canIssue = user?.role === 'company_admin' || user?.role === 'project_manager' || user?.role === 'consultant';

  useEffect(() => {
    projectApi.list()
      .then((d) => {
        setProjects(d.projects);
        if (d.projects.length > 0) setProjectId(d.projects[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    instructionApi.list(projectId, {
      status:   statusFilter   || undefined,
      priority: priorityFilter || undefined,
      type:     typeFilter     || undefined,
    })
      .then((d) => setInstructions(d.instructions))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [projectId, statusFilter, priorityFilter, typeFilter]);

  const unresolved = instructions.filter((i) => !['resolved', 'rejected'].includes(i.status));

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Consultant Instructions"
        subtitle={projectId
          ? `${instructions.length} instruction${instructions.length !== 1 ? 's' : ''} · ${unresolved.length} unresolved`
          : 'Select a project'}
        action={
          canIssue && projectId ? (
            <Link href={`/consultants/instructions/new?projectId=${projectId}`}>
              <Button><Plus className="h-4 w-4 mr-1" /> New Instruction</Button>
            </Link>
          ) : undefined
        }
      />

      <SearchFilterBar
        searchValue=""
        onSearchChange={() => {}}
        searchPlaceholder=""
        filters={[
          {
            label: 'Project',
            value: projectId,
            options: projects.map((p) => ({ label: p.name, value: p.id })),
            onChange: setProjectId,
          },
          {
            label: 'Type',
            value: typeFilter,
            options: [
              { label: 'Instruction',    value: 'instruction' },
              { label: 'Recommendation', value: 'recommendation' },
            ],
            onChange: setTypeFilter,
          },
          {
            label: 'Status',
            value: statusFilter,
            options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ label, value })),
            onChange: setStatusFilter,
          },
          {
            label: 'Priority',
            value: priorityFilter,
            options: [
              { label: 'Low',      value: 'low' },
              { label: 'Medium',   value: 'medium' },
              { label: 'High',     value: 'high' },
              { label: 'Critical', value: 'critical' },
            ],
            onChange: setPriorityFilter,
          },
        ]}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!projectId ? (
        <EmptyState
          icon={<ClipboardList className="h-12 w-12" />}
          title="Select a project"
          description="Choose a project from the filter above."
        />
      ) : loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : instructions.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-12 w-12" />}
          title={statusFilter || priorityFilter || typeFilter ? 'No instructions match your filter' : 'No instructions yet'}
          description={!statusFilter && !priorityFilter && !typeFilter && canIssue ? 'Issue the first instruction to get started.' : undefined}
          action={!statusFilter && !priorityFilter && !typeFilter && canIssue ? { label: 'New Instruction', href: `/consultants/instructions/new?projectId=${projectId}` } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {instructions.map((instr) => (
            <Link key={instr.id} href={`/consultants/instructions/${instr.id}?projectId=${projectId}`}>
              <div className="group flex items-center justify-between rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-navy-elevated cursor-pointer">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <StatusIcon status={instr.status} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground uppercase tracking-wide">
                        {instr.type}
                      </span>
                      <p className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                        {instr.title}
                      </p>
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <Badge variant={STATUS_VARIANT[instr.status] ?? 'default'}>
                        {STATUS_LABELS[instr.status]}
                      </Badge>
                      <PriorityBadge priority={instr.priority} />
                      {instr.category && (
                        <span className="text-xs text-muted-foreground">{instr.category}</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {instr.issuedBy.firstName} {instr.issuedBy.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(instr.issuedDate).toLocaleDateString()}
                      </span>
                      {instr.targetActionDate && (
                        <span className="text-xs text-muted-foreground">
                          Due {new Date(instr.targetActionDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors ml-3" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
