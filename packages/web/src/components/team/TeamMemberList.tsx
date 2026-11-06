'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';
import type { TeamMember } from '@/lib/team-api';
import { CONSULTANT_TYPE_LABELS, isCompanyWideRole, roleLabel } from '@/lib/team-roles';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import type { StatusAction } from './MemberStatusDialog';

/** "Project A · Site 1", "Project B (all sites)", … */
export function membershipLabels(member: TeamMember): string[] {
  return member.projectMemberships.map(scopeLabel);
}

export function defaultWorkspaceLabel(member: TeamMember): string {
  if (!member.defaultProject) return '—';
  return member.defaultSite
    ? `${member.defaultProject.name} · ${member.defaultSite.name}`
    : member.defaultProject.name;
}

/** "Project A · Site 1" / "Project A (all sites)" for one membership. */
function scopeLabel(m: TeamMember['projectMemberships'][number]): string {
  return m.siteName ? `${m.projectName} · ${m.siteName}` : `${m.projectName} (all sites)`;
}

function ProjectAccess({ member }: { member: TeamMember }) {
  if (isCompanyWideRole(member.role)) return <>All projects</>;
  if (member.projectMemberships.length === 0) return <>No project access</>;
  return (
    <ul className="space-y-0.5">
      {member.projectMemberships.map((m) => (
        <li key={m.projectId}>
          <Link
            href={`/projects/${encodeURIComponent(m.projectId)}/members`}
            className="text-primary hover:underline"
            title={`Manage members of ${m.projectName}`}
          >
            {scopeLabel(m)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export interface TeamMemberListProps {
  members:    TeamMember[];
  filtered:   boolean;
  onAddClick: () => void;
  /** The signed-in admin; their own row never offers a status action. */
  currentUserId?: string | null;
  /** Omit to render the list without status actions. */
  onStatusAction?: (member: TeamMember, action: StatusAction) => void;
}

export function TeamMemberList({
  members, filtered, onAddClick, currentUserId, onStatusAction,
}: TeamMemberListProps) {
  if (members.length === 0) {
    return filtered ? (
      <EmptyState
        icon={<Users className="h-10 w-10" />}
        title="No team members match"
        description="Try a different search or status filter."
      />
    ) : (
      <EmptyState
        icon={<Users className="h-10 w-10" />}
        title="No team members yet"
        description="Add the people who work on your projects."
        action={{ label: 'Add team member', onClick: onAddClick }}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Default workspace</TableHead>
          <TableHead>Project access</TableHead>
          {onStatusAction && <TableHead><span className="sr-only">Actions</span></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => {
          const isSelf = Boolean(currentUserId) && m.id === currentUserId;
          const name = `${m.firstName} ${m.lastName}`.trim() || m.email;
          return (
            <TableRow key={m.id}>
              <TableCell>
                <p className="font-medium text-foreground">{m.firstName} {m.lastName}</p>
                <p className="text-xs text-muted-foreground break-all">{m.email}</p>
              </TableCell>
              <TableCell>
                <span className="text-sm">{roleLabel(m.role)}</span>
                {m.role === 'consultant' && m.consultantType && (
                  <p className="text-xs text-muted-foreground">{CONSULTANT_TYPE_LABELS[m.consultantType]}</p>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={m.isActive ? 'active' : 'inactive'}>
                  {m.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{defaultWorkspaceLabel(m)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <ProjectAccess member={m} />
              </TableCell>
              {onStatusAction && (
                <TableCell className="text-right">
                  {isSelf ? (
                    <span className="text-xs text-muted-foreground">You</span>
                  ) : m.isActive ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Deactivate ${name}`}
                      onClick={() => onStatusAction(m, 'deactivate')}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Reactivate ${name}`}
                      onClick={() => onStatusAction(m, 'reactivate')}
                    >
                      Reactivate
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
