'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { contractorApi, ApiError } from '@/lib/api';
import { Contractor } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Truck, Phone, Mail, ChevronRight, AlertCircle, Plus } from 'lucide-react';

export default function ContractorsPage() {
  const { user }                          = useAuthStore();
  const [contractors, setContractors]     = useState<Contractor[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');
  const [search, setSearch]               = useState('');
  const [statusFilter, setStatusFilter]   = useState('');

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  useEffect(() => {
    contractorApi.list()
      .then((d) => setContractors(d.contractors))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = contractors.filter((c) => {
    const matchSearch = !search || [c.name, c.contactPerson, c.tradeSpecialization]
      .some((f) => f?.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = !statusFilter
      || (statusFilter === 'active' && c.isActive)
      || (statusFilter === 'inactive' && !c.isActive);
    return matchSearch && matchStatus;
  });

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Contractors"
        subtitle={`${contractors.length} contractor${contractors.length !== 1 ? 's' : ''} registered`}
        action={
          canManage ? (
            <Link href="/contractors/new">
              <Button><Plus className="h-4 w-4" /> Add Contractor</Button>
            </Link>
          ) : undefined
        }
      />

      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, contact or trade…"
        filters={[
          {
            label: 'Status',
            value: statusFilter,
            options: [
              { label: 'Active',   value: 'active'   },
              { label: 'Inactive', value: 'inactive' },
            ],
            onChange: setStatusFilter,
          },
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
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-12 w-12" />}
          title={search || statusFilter ? 'No contractors match your filter' : 'No contractors yet'}
          description={!search && !statusFilter && canManage ? 'Register the first contractor to get started.' : undefined}
          action={!search && !statusFilter && canManage ? { label: 'Add Contractor', href: '/contractors/new' } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <Link key={c.id} href={`/contractors/${c.id}`}>
              <div className="group flex items-center justify-between rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-navy-elevated cursor-pointer">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Truck className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                        {c.name}
                      </p>
                      <Badge variant={c.isActive ? 'active' : 'inactive'}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                      {c.tradeSpecialization && (
                        <span className="text-xs text-muted-foreground">{c.tradeSpecialization}</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-4">
                      {c.contactPerson && (
                        <span className="text-xs text-muted-foreground">{c.contactPerson}</span>
                      )}
                      {c.phone && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" />{c.phone}
                        </span>
                      )}
                      {c.email && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3" />{c.email}
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
