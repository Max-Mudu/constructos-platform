'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { deliveryApi, ApiError } from '@/lib/api';
import { DeliveryRecord, AcceptanceStatus, InspectionStatus } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import {
  Table, TableHeader, TableBody, TableRow,
  TableHead, TableCell,
} from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ArrowLeft, Plus, Truck, AlertCircle, Package } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const WRITE_ROLES = ['company_admin', 'project_manager', 'site_supervisor'] as const;
type WriteRole = typeof WRITE_ROLES[number];

function canWrite(role: string): role is WriteRole {
  return (WRITE_ROLES as readonly string[]).includes(role);
}

function acceptanceBadge(status: AcceptanceStatus) {
  if (status === 'accepted')           return <Badge variant="active">Accepted</Badge>;
  if (status === 'partially_accepted') return <Badge variant="secondary">Partial</Badge>;
  return                                      <Badge variant="destructive">Rejected</Badge>;
}

function inspectionBadge(status: InspectionStatus) {
  if (status === 'passed')  return <Badge variant="active">Passed</Badge>;
  if (status === 'failed')  return <Badge variant="destructive">Failed</Badge>;
  if (status === 'waived')  return <Badge variant="outline">Waived</Badge>;
  return                           <Badge variant="secondary">Pending</Badge>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DeliveriesPage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();
  const user = useAuthStore((s) => s.user);

  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  useEffect(() => {
    if (!projectId || !siteId) return;
    deliveryApi
      .list(projectId, siteId)
      .then((d) => setDeliveries(d.deliveries))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load deliveries'))
      .finally(() => setLoading(false));
  }, [projectId, siteId]);

  const showAddButton = user && canWrite(user.role);

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/projects/${projectId}/sites/${siteId}`}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Site
          </Link>
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">Delivery Records</h1>
          </div>
        </div>
        {showAddButton && (
          <Button asChild>
            <Link href={`/projects/${projectId}/sites/${siteId}/deliveries/new`}>
              <Plus className="mr-1.5 h-4 w-4" />
              Record Delivery
            </Link>
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded" />)}
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!loading && !error && deliveries.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-sm font-medium text-foreground">No deliveries recorded yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Start by recording the first delivery to this site.
            </p>
            {showAddButton && (
              <Button asChild className="mt-4">
                <Link href={`/projects/${projectId}/sites/${siteId}/deliveries/new`}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Record Delivery
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {!loading && !error && deliveries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {deliveries.length} {deliveries.length === 1 ? 'Record' : 'Records'}
            </CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty Ordered</TableHead>
                  <TableHead className="text-right">Qty Delivered</TableHead>
                  <TableHead>Inspection</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received By</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(d.deliveryDate)}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm font-medium">
                      {d.supplierName}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm">
                      {d.itemDescription}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {d.quantityOrdered.toLocaleString()} {d.unitOfMeasure}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {d.quantityDelivered.toLocaleString()} {d.unitOfMeasure}
                    </TableCell>
                    <TableCell>{inspectionBadge(d.inspectionStatus)}</TableCell>
                    <TableCell>{acceptanceBadge(d.acceptanceStatus)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {d.receivedBy.firstName} {d.receivedBy.lastName}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/projects/${projectId}/sites/${siteId}/deliveries/${d.id}`}>
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
