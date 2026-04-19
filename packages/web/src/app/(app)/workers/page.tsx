'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { workerApi, ApiError } from '@/lib/api';
import { Worker } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { HardHat, Plus, AlertCircle, ChevronRight } from 'lucide-react';

const STATUS_OPTIONS = [
  { label: 'Active',    value: 'active'    },
  { label: 'Inactive',  value: 'inactive'  },
  { label: 'Suspended', value: 'suspended' },
];

function statusVariant(s: string): 'active' | 'inactive' | 'pending' {
  if (s === 'active')    return 'active';
  if (s === 'suspended') return 'pending';
  return 'inactive';
}

export default function WorkersPage() {
  const { user }    = useAuthStore();
  const [workers,   setWorkers]        = useState<Worker[]>([]);
  const [loading,   setLoading]        = useState(true);
  const [error,     setError]          = useState('');
  const [search,    setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    workerApi.list()
      .then((d) => setWorkers(d.workers))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load workers'))
      .finally(() => setLoading(false));
  }, []);

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  const filtered = workers.filter((w) => {
    const name = `${w.firstName} ${w.lastName}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase()) || (w.trade ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || w.employmentStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Workers"
        subtitle={`${workers.length} registered`}
        action={
          canManage ? (
            <Link href="/workers/new">
              <Button><Plus className="h-4 w-4" /> Add Worker</Button>
            </Link>
          ) : undefined
        }
      />

      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name or trade…"
        filters={[
          { label: 'Status', value: statusFilter, options: STATUS_OPTIONS, onChange: setStatusFilter },
        ]}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<HardHat className="h-12 w-12" />}
          title={search || statusFilter ? 'No workers match your filter' : 'No workers yet'}
          action={!search && !statusFilter && canManage ? { label: 'Add Worker', href: '/workers/new' } : undefined}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Trade</TableHead>
              <TableHead>Daily Wage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-medium">{w.firstName} {w.lastName}</TableCell>
                <TableCell className="text-muted-foreground">{w.trade ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">
                  {w.dailyWage ? `${Number(w.dailyWage).toLocaleString()} ${w.currency}` : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(w.employmentStatus)}>{w.employmentStatus}</Badge>
                </TableCell>
                <TableCell>
                  <Link href={`/workers/${w.id}`}>
                    <Button variant="ghost" size="sm">
                      View <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
