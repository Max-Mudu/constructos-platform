'use client';

import { Users } from 'lucide-react';
import type { TeamMember } from '@/lib/team-api';
import { CONSULTANT_TYPE_LABELS, isCompanyWideRole, roleLabel } from '@/lib/team-roles';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';

/** "Project A · Site 1", "Project B (all sites)", … */
export function membershipLabels(member: TeamMember): string[] {
  return member.projectMemberships.map((m) =>
    m.siteName ? `${m.projectName} · ${m.siteName}` : `${m.projectName} (all sites)`,
  );
}

export function defaultWorkspaceLabel(member: TeamMember): string {
  if (!member.defaultProject) return '—';
  return member.defaultSite
    ? `${member.defaultProject.name} · ${member.defaultSite.name}`
    : member.defaultProject.name;
}

export interface TeamMemberListProps {
  members:    TeamMember[];
  filtered:   boolean;
  onAddClick: () => void;
}

export function TeamMemberList({ members, filtered, onAddClick }: TeamMemberListProps) {
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => {
          const access = membershipLabels(m);
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
                {isCompanyWideRole(m.role)
                  ? 'All projects'
                  : access.length ? access.join(', ') : 'No project access'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
