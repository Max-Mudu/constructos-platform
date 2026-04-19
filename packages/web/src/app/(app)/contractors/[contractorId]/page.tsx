'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { contractorApi, ApiError } from '@/lib/api';
import { Contractor } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StickyActionsRow } from '@/components/ui/StickyActionsRow';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Separator } from '@/components/ui/Separator';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { AlertCircle, Phone, Mail, Hash, Truck } from 'lucide-react';

export default function ContractorDetailPage() {
  const { contractorId }                = useParams<{ contractorId: string }>();
  const { user }                        = useAuthStore();
  const [contractor, setContractor]     = useState<Contractor | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  useEffect(() => {
    if (!contractorId) return;
    contractorApi.get(contractorId)
      .then((d) => setContractor(d.contractor))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load contractor'))
      .finally(() => setLoading(false));
  }, [contractorId]);

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6 animate-fade-in">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>
      </div>
    );
  }

  if (!contractor) return null;

  return (
    <div className="animate-fade-in">
      <StickyActionsRow
        title={contractor.name}
        actions={
          canManage ? (
            <Link href={`/contractors/${contractorId}/edit`}>
              <Button variant="outline" size="sm">Edit</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="px-6 py-8 space-y-6">
        <div className="space-y-3">
          <Breadcrumb items={[{ label: 'Contractors', href: '/contractors' }, { label: contractor.name }]} />
          <PageHeader
            title={contractor.name}
            subtitle={contractor.tradeSpecialization ?? undefined}
          />
          <div className="flex gap-2">
            <Badge variant={contractor.isActive ? 'active' : 'inactive'}>
              {contractor.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Contractor Details</CardTitle>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            {contractor.contactPerson && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Contact Person</span>
                <span className="text-foreground font-medium">{contractor.contactPerson}</span>
              </div>
            )}
            {contractor.phone && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Phone</span>
                <span className="flex items-center gap-1.5 text-foreground">
                  <Phone className="h-3.5 w-3.5" />{contractor.phone}
                </span>
              </div>
            )}
            {contractor.email && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Email</span>
                <span className="flex items-center gap-1.5 text-foreground">
                  <Mail className="h-3.5 w-3.5" />{contractor.email}
                </span>
              </div>
            )}
            {contractor.registrationNumber && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Registration No.</span>
                <span className="flex items-center gap-1.5 text-foreground font-mono text-xs">
                  <Hash className="h-3.5 w-3.5" />{contractor.registrationNumber}
                </span>
              </div>
            )}
            {contractor.tradeSpecialization && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Trade / Specialization</span>
                <span className="text-foreground">{contractor.tradeSpecialization}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Registered</span>
              <span className="text-foreground">
                {new Date(contractor.createdAt).toLocaleDateString()}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
