'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { workerApi, ApiError } from '@/lib/api';
import { Worker } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StickyActionsRow } from '@/components/ui/StickyActionsRow';
import { Separator } from '@/components/ui/Separator';
import { Edit, Trash2, AlertCircle, Phone, Mail, MapPin } from 'lucide-react';

const WRITE_ROLES = ['company_admin', 'project_manager'] as const;
function canWrite(role: string) { return (WRITE_ROLES as readonly string[]).includes(role); }
function canDelete(role: string) { return role === 'company_admin'; }

function statusVariant(status: string): 'active' | 'secondary' | 'destructive' {
  if (status === 'active')    return 'active';
  if (status === 'suspended') return 'secondary';
  return 'destructive';
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value ?? '—'}</span>
    </div>
  );
}

export default function WorkerDetailPage() {
  const { workerId } = useParams<{ workerId: string }>();
  const user   = useAuthStore((s) => s.user);
  const router = useRouter();

  const [worker, setWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!workerId) return;
    workerApi
      .get(workerId)
      .then((d) => setWorker(d.worker))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load worker'))
      .finally(() => setLoading(false));
  }, [workerId]);

  async function handleDeactivate() {
    if (!worker || !confirm(`Deactivate ${worker.firstName} ${worker.lastName}?`)) return;
    setDeleting(true);
    try {
      await workerApi.deactivate(workerId);
      router.push('/workers');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to deactivate worker');
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-2xl space-y-4 animate-fade-in">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !worker) {
    return (
      <div className="px-6 py-8 max-w-2xl animate-fade-in">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || 'Worker not found'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const workerName = `${worker.firstName} ${worker.lastName}`;
  const subtitle   = [worker.trade, worker.employmentStatus].filter(Boolean).join(' · ');

  const actions = user ? (
    <div className="flex gap-2">
      {canWrite(user.role) && (
        <Link href={`/workers/${workerId}/edit`}>
          <Button variant="outline" size="sm"><Edit className="h-4 w-4 mr-1" />Edit</Button>
        </Link>
      )}
      {canDelete(user.role) && worker.isActive && (
        <Button
          variant="destructive"
          size="sm"
          disabled={deleting}
          onClick={handleDeactivate}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          {deleting ? 'Deactivating…' : 'Deactivate'}
        </Button>
      )}
    </div>
  ) : undefined;

  return (
    <div className="animate-fade-in">
      <StickyActionsRow title={workerName} actions={actions} />

      <div className="px-6 py-8 max-w-2xl space-y-6">
        <Breadcrumb items={[{ label: 'Workers', href: '/workers' }, { label: workerName }]} />
        <div className="space-y-3">
          <PageHeader
            title={workerName}
            subtitle={subtitle || undefined}
            action={actions}
          />
          <Badge variant={statusVariant(worker.employmentStatus)}>
            {worker.employmentStatus}
          </Badge>
        </div>

        {/* Details */}
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-2">
            <Row label="ID / National ID" value={worker.idNumber} />
            <Row label="Trade"            value={worker.trade} />
            <Row label="Daily Wage"       value={worker.dailyWage ? `${Number(worker.dailyWage).toLocaleString()} ${worker.currency}` : null} />
            <Row label="Employment"       value={worker.employmentStatus} />
          </CardContent>
        </Card>

        {/* Contact */}
        <Card>
          <CardHeader><CardTitle className="text-base">Contact</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-3">
            {worker.phone && (
              <div className="flex items-center gap-2 py-1.5 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {worker.phone}
              </div>
            )}
            {worker.email && (
              <div className="flex items-center gap-2 py-1.5 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                {worker.email}
              </div>
            )}
            {!worker.phone && !worker.email && (
              <p className="py-1 text-sm text-muted-foreground">No contact info</p>
            )}
          </CardContent>
        </Card>

        {/* Emergency contact */}
        {(worker.emergencyContactName || worker.emergencyContactPhone) && (
          <Card>
            <CardHeader><CardTitle className="text-base">Emergency Contact</CardTitle></CardHeader>
            <Separator />
            <CardContent className="pt-2">
              <Row label="Name"  value={worker.emergencyContactName} />
              <Row label="Phone" value={worker.emergencyContactPhone} />
            </CardContent>
          </Card>
        )}

        {/* Site assignments */}
        {worker.assignments && worker.assignments.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Site Assignments</CardTitle></CardHeader>
            <Separator />
            <CardContent className="pt-3 space-y-1">
              {worker.assignments.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-sm py-1">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{a.site.name}</span>
                  <span className="text-muted-foreground">— {a.project.name}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        {worker.notes && (
          <Card>
            <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
            <Separator />
            <CardContent className="pt-3">
              <p className="text-sm whitespace-pre-wrap">{worker.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
