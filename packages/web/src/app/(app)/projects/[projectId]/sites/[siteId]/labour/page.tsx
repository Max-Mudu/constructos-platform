'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { labourApi, ApiError } from '@/lib/api';
import { LabourEntry } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import {
  Table, TableHeader, TableBody, TableRow,
  TableHead, TableCell,
} from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ArrowLeft, Plus, Users, AlertCircle } from 'lucide-react';

const WRITE_ROLES = ['company_admin', 'project_manager', 'site_supervisor'] as const;
function canWrite(role: string) { return (WRITE_ROLES as readonly string[]).includes(role); }

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function totalWage(entry: LabourEntry): string {
  const total = (Number(entry.hoursWorked) / 8) * Number(entry.dailyRate);
  return `${total.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${entry.currency}`;
}

export default function LabourPage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();
  const user = useAuthStore((s) => s.user);

  const [entries, setEntries] = useState<LabourEntry[]>([]);
  const [dateFilter, setDateFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  function load(date?: string) {
    if (!projectId || !siteId) return;
    setLoading(true);
    labourApi
      .list(projectId, siteId, date ? { date } : {})
      .then((d) => setEntries(d.entries))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load entries'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(dateFilter || undefined); }, [projectId, siteId, dateFilter]);

  // Summary
  const totalWorkerDays = entries.length;
  const totalCost = entries.reduce((sum, e) => sum + (Number(e.hoursWorked) / 8) * Number(e.dailyRate), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/projects/${projectId}/sites/${siteId}`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Labour Register</h1>
          </div>
          {user && canWrite(user.role) && (
            <Link href={`/projects/${projectId}/sites/${siteId}/labour/new`}>
              <Button><Plus className="h-4 w-4 mr-2" />Log Labour</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Worker-Days</p>
            <p className="text-2xl font-bold">{totalWorkerDays}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Labour Cost</p>
            <p className="text-2xl font-bold">
              {totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              {entries[0] ? ` ${entries[0].currency}` : ''}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Date filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Filter by date:</label>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {dateFilter && (
          <Button variant="ghost" size="sm" onClick={() => setDateFilter('')}>Clear</Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? 'Loading…' : `${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No labour entries{dateFilter ? ' for this date' : ''}</p>
              {user && canWrite(user.role) && (
                <Link href={`/projects/${projectId}/sites/${siteId}/labour/new`}>
                  <Button variant="outline" size="sm" className="mt-3">
                    <Plus className="h-4 w-4 mr-1" />Log first entry
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>Trade</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Daily Rate</TableHead>
                  <TableHead>Wage</TableHead>
                  <TableHead>Logged By</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(e.date)}</TableCell>
                    <TableCell className="font-medium">
                      {e.worker.firstName} {e.worker.lastName}
                    </TableCell>
                    <TableCell>{e.worker.trade ?? '—'}</TableCell>
                    <TableCell>{e.hoursWorked}h</TableCell>
                    <TableCell>{Number(e.dailyRate).toLocaleString()} {e.currency}</TableCell>
                    <TableCell className="font-medium">{totalWage(e)}</TableCell>
                    <TableCell>{e.registeredBy.firstName} {e.registeredBy.lastName}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{e.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
