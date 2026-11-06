'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ApiError, siteApi } from '@/lib/api';
import type { JobSite, UserRole } from '@/lib/types';
import { teamApi, type TeamMember } from '@/lib/team-api';
import { roleLabel } from '@/lib/team-roles';
import {
  addErrorText, addableUsers, canAddMembers, canListMembers, canRemoveMembers, loadAllActiveUsers,
  memberScopeLabel, membersApi, sortMembers, type ProjectMember,
} from '@/lib/members-api';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Separator } from '@/components/ui/Separator';
import { AlertCircle, CheckCircle2, UserMinus, UserPlus, Users } from 'lucide-react';

function errText(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.message ? e.message : fallback;
}

export function ProjectMembers({ projectId, role }: { projectId: string; role: UserRole | null | undefined }) {
  const canAdd    = canAddMembers(role);
  const canRemove = canRemoveMembers(role);

  const [members, setMembers]   = useState<ProjectMember[]>([]);
  const [sites, setSites]       = useState<JobSite[]>([]);
  const [users, setUsers]       = useState<TeamMember[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [usersError, setUsersError] = useState('');
  const [notice, setNotice]     = useState('');

  const [userId, setUserId]     = useState('');
  const [siteId, setSiteId]     = useState('');
  const [adding, setAdding]     = useState(false);
  const [addError, setAddError] = useState('');

  const [confirmId, setConfirmId]   = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const reloadMembers = useCallback(async () => {
    const res = await membersApi.list(projectId);
    setMembers(res.members);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !canListMembers(role)) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([membersApi.list(projectId), siteApi.list(projectId)])
      .then(([m, s]) => { if (!cancelled) { setMembers(m.members); setSites(s.sites); } })
      .catch((e) => { if (!cancelled) setError(errText(e, 'Failed to load project members')); })
      .finally(() => { if (!cancelled) setLoading(false); });

    // The company user list is company_admin only (GET /companies/me/users),
    // which is also the only role that may add members.
    if (canAddMembers(role)) {
      loadAllActiveUsers((q) => teamApi.list(q))
        .then((u) => { if (!cancelled) setUsers(u); })
        .catch((e) => { if (!cancelled) setUsersError(errText(e, 'Failed to load company users')); });
    }
    return () => { cancelled = true; };
  }, [projectId, role]);

  const candidates = useMemo(() => addableUsers(users, members), [users, members]);
  const activeSites = useMemo(() => sites.filter((s) => s.isActive), [sites]);
  const sorted = useMemo(() => sortMembers(members), [members]);

  async function handleAdd() {
    if (!userId) { setAddError('Choose a person to add'); return; }
    setAdding(true);
    setAddError('');
    setNotice('');
    try {
      const { member } = await membersApi.add(projectId, { userId, ...(siteId ? { siteId } : {}) });
      setNotice(`${member.user.firstName} ${member.user.lastName} added to the project.`);
      setUserId('');
      setSiteId('');
      await reloadMembers().catch(() => setMembers((prev) => [...prev, member]));
    } catch (e) {
      setAddError(addErrorText(e));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(m: ProjectMember) {
    setRemovingId(m.userId);
    setError('');
    setNotice('');
    try {
      await membersApi.remove(projectId, m.userId);
      setMembers((prev) => prev.filter((x) => x.userId !== m.userId));
      setNotice(`${m.user.firstName} ${m.user.lastName} removed from the project.`);
    } catch (e) {
      setError(errText(e, 'Failed to remove member'));
    } finally {
      setRemovingId(null);
      setConfirmId(null);
    }
  }

  if (!canListMembers(role)) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Only a company admin or project manager can view project members.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {notice && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {canAdd ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" /> Add a team member
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            {usersError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{usersError}</AlertDescription>
              </Alert>
            )}
            {addError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{addError}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select label="Person" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={loading}>
                <option value="">Select a company user…</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName} — {roleLabel(u.role)} ({u.email})
                  </option>
                ))}
              </Select>
              <Select
                label="Site access"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={loading}
                hint="Leave as All sites for project-wide access."
              >
                <option value="">All sites (project-wide)</option>
                {activeSites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </div>
            {!loading && !usersError && candidates.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Everyone who can be assigned is already on this project. Company admins and finance
                officers see every project and are not added here. To invite someone new, use{' '}
                <Link href="/settings" className="text-primary hover:underline">Settings → Team</Link>.
              </p>
            )}
            <div className="flex justify-end">
              <Button onClick={() => void handleAdd()} disabled={adding || loading || !userId}>
                {adding ? 'Adding…' : 'Add to Project'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only a company admin can add or remove project members.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" /> Members
            {!loading && members.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {members.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-3">
          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
            </div>
          ) : sorted.length === 0 ? (
            !error && <p className="py-1 text-sm text-muted-foreground">No members assigned to this project yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {sorted.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{m.user.firstName} {m.user.lastName}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.user.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{roleLabel(m.user.role)}</Badge>
                    <Badge variant={m.siteId ? 'info' : 'outline'}>{memberScopeLabel(m)}</Badge>
                    {canRemove && (confirmId === m.userId ? (
                      <span className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={removingId === m.userId}
                          onClick={() => void handleRemove(m)}
                        >
                          {removingId === m.userId ? 'Removing…' : 'Confirm remove'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)} disabled={removingId === m.userId}>
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmId(m.userId)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                        aria-label={`Remove ${m.user.firstName} ${m.user.lastName}`}
                      >
                        <UserMinus className="h-4 w-4" />
                        <span className="ml-1 hidden sm:inline">Remove</span>
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canAdd && (
            <p className="mt-3 text-xs text-muted-foreground">
              Site access is chosen when a member is added. Removing a member takes away their access to this project.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
