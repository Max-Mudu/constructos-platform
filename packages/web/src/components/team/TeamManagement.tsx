'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ChevronLeft, ShieldAlert, UserPlus } from 'lucide-react';
import { ApiError } from '@/lib/api';
import type { UserRole } from '@/lib/types';
import {
  teamApi,
  TEAM_LIST_MAX_LIMIT,
  type CreateTeamMemberResponse,
  type TeamMember,
} from '@/lib/team-api';
import { canManageTeam } from '@/lib/team-roles';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { AddMemberForm } from './AddMemberForm';
import { SetupLinkPanel } from './SetupLinkPanel';
import { TeamMemberList } from './TeamMemberList';

type StatusFilter = 'all' | 'active' | 'inactive';

/** Only what the result panel needs — never the full response, never persisted. */
interface CreatedNotice {
  email:          string;
  setupLink?:     string;
  setupEmailSent: boolean;
}

export function noticeFromResponse(res: CreateTeamMemberResponse): CreatedNotice {
  return {
    email:          res.user.email,
    setupLink:      typeof res.setupLink === 'string' && res.setupLink ? res.setupLink : undefined,
    setupEmailSent: res.setupEmailSent === true,
  };
}

export function NotTeamAdmin() {
  return (
    <div className="rounded-xl border border-border bg-card p-8 text-center space-y-2" role="alert">
      <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm font-medium text-foreground">Only company admins can manage the team</p>
      <p className="text-xs text-muted-foreground">
        Ask a company admin to add or change team members.
      </p>
    </div>
  );
}

export function TeamManagement({ role }: { role: UserRole | null | undefined }) {
  const isAdmin = canManageTeam(role);

  const [members, setMembers]   = useState<TeamMember[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(isAdmin);
  const [error, setError]       = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [search, setSearch]     = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus]     = useState<StatusFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice]     = useState<CreatedNotice | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    teamApi.list({
      search:   debounced || undefined,
      isActive: status === 'all' ? undefined : status === 'active',
      limit:    TEAM_LIST_MAX_LIMIT,
    }, controller.signal)
      .then((r) => { setMembers(r.users); setTotal(r.total); })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 403) { setForbidden(true); return; }
        setError(e instanceof ApiError ? e.message : 'Failed to load the team');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isAdmin, debounced, status, reloadKey]);

  const openForm = useCallback(() => {
    setNotice(null); // a previous setup link must not linger next to a new form
    setShowForm(true);
  }, []);

  function handleCreated(res: CreateTeamMemberResponse) {
    setShowForm(false);
    setNotice(noticeFromResponse(res));
    setReloadKey((k) => k + 1);
  }

  const header = (
    <div className="space-y-3">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Settings
      </Link>
      <PageHeader title="Team" subtitle="People in your company and what they can access" />
    </div>
  );

  if (!isAdmin || forbidden) {
    return (
      <div className="px-6 py-8 space-y-6 animate-fade-in">
        {header}
        <NotTeamAdmin />
      </div>
    );
  }

  const filtered = Boolean(debounced) || status !== 'all';

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      {header}

      {notice && (
        <SetupLinkPanel
          email={notice.email}
          setupLink={notice.setupLink}
          setupEmailSent={notice.setupEmailSent}
          onDismiss={() => setNotice(null)}
        />
      )}

      {showForm ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Add team member</h2>
          <p className="text-xs text-muted-foreground">
            They will choose their own password from a one-time setup link. You never see or set it.
          </p>
          <AddMemberForm onCreated={handleCreated} onCancel={() => setShowForm(false)} />
        </section>
      ) : (
        <div>
          <Button onClick={openForm}>
            <UserPlus className="h-4 w-4" />
            Add team member
          </Button>
        </div>
      )}

      <section className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <Input
            id="team-search"
            aria-label="Search team"
            placeholder="Search by name or email"
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            id="team-status"
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>
            </AlertDescription>
          </Alert>
        ) : loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading team">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : (
          <>
            <TeamMemberList members={members} filtered={filtered} onAddClick={openForm} />
            {total > members.length && (
              <p className="text-xs text-muted-foreground">
                Showing {members.length} of {total}. Refine the search to find someone else.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
