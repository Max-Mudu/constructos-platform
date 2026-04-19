'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { invoiceApi, ApiError } from '@/lib/api';
import { InvoiceListItem, InvoiceVendorType, InvoiceStatus } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import {
  Receipt, Plus, AlertCircle, CheckCircle2, Lock,
  Clock, AlertTriangle, Ban, DollarSign, TrendingUp,
  TrendingDown, Users, Briefcase,
} from 'lucide-react';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft:          'Draft',
  submitted:      'Submitted',
  approved:       'Approved',
  partially_paid: 'Partially Paid',
  paid:           'Paid',
  overdue:        'Overdue',
  disputed:       'Disputed',
  cancelled:      'Cancelled',
};

const STATUS_VARIANT: Record<string, 'pending' | 'active' | 'inactive' | 'warning'> = {
  draft:          'pending',
  submitted:      'pending',
  approved:       'active',
  partially_paid: 'warning',
  paid:           'active',
  overdue:        'warning',
  disputed:       'warning',
  cancelled:      'inactive',
};

const VENDOR_TYPE_LABEL: Record<InvoiceVendorType, string> = {
  contractor: 'Contractor',
  consultant: 'Consultant',
  supplier:   'Supplier',
  marketing:  'Marketing',
  internal:   'Internal',
  other:      'Other',
};

function fmt(val: string | number, currency = 'USD') {
  return Number(val).toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
}

function isOverdue(inv: InvoiceListItem): boolean {
  return inv.status === 'overdue' ||
    (['approved', 'submitted', 'partially_paid'].includes(inv.status) && new Date(inv.dueDate) < new Date());
}

// ─── Invoice card ──────────────────────────────────────────────────────────────

function InvoiceCard({ invoice }: { invoice: InvoiceListItem }) {
  const total       = Number(invoice.totalAmount);
  const paid        = Number(invoice.paidAmount);
  const outstanding = total - paid;
  const pct         = total > 0 ? Math.min((paid / total) * 100, 100) : 0;
  const overdue     = isOverdue(invoice);

  return (
    <Link
      href={`/invoices/${invoice.id}`}
      className={`block rounded-xl border bg-card p-5 hover:shadow-sm transition-all ${
        overdue ? 'border-red-400/60 hover:border-red-500/60' : 'border-border hover:border-primary/40'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-foreground truncate">{invoice.invoiceNumber}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{invoice.vendorName}</p>
          <p className="text-xs text-muted-foreground">{invoice.project.name}{invoice.project.code ? ` · ${invoice.project.code}` : ''}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant={STATUS_VARIANT[invoice.status] ?? 'pending'}>
            {invoice.status === 'paid'     && <CheckCircle2 className="h-3 w-3 mr-1" />}
            {invoice.status === 'overdue'  && <AlertTriangle className="h-3 w-3 mr-1" />}
            {invoice.status === 'cancelled'&& <Ban className="h-3 w-3 mr-1" />}
            {STATUS_LABEL[invoice.status]}
          </Badge>
          <span className="text-xs text-muted-foreground">{VENDOR_TYPE_LABEL[invoice.vendorType]}</span>
        </div>
      </div>

      {/* Progress bar for partial payment */}
      {['approved', 'partially_paid', 'overdue', 'paid'].includes(invoice.status) && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Payment progress</span>
            <span>{pct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                invoice.status === 'paid' ? 'bg-emerald-500' :
                overdue ? 'bg-red-500' : 'bg-amber-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-sm font-semibold text-foreground">{fmt(total, invoice.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Paid</p>
          <p className="text-sm font-semibold text-emerald-600">{fmt(paid, invoice.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className={`text-sm font-semibold ${outstanding > 0 && overdue ? 'text-red-500' : outstanding > 0 ? 'text-amber-600' : 'text-foreground'}`}>
            {fmt(outstanding, invoice.currency)}
          </p>
        </div>
      </div>

      {overdue && invoice.status !== 'paid' && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-600">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          Overdue — due {new Date(invoice.dueDate).toLocaleDateString()}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {invoice._count.lineItems} line item{invoice._count.lineItems !== 1 ? 's' : ''} · {invoice.currency}
        {invoice.payments.length > 0 && ` · ${invoice.payments.length} payment${invoice.payments.length !== 1 ? 's' : ''}`}
      </p>
    </Link>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const { user } = useAuthStore();
  const [invoices, setInvoices]         = useState<InvoiceListItem[]>([]);
  const [loading,  setLoading]          = useState(true);
  const [error,    setError]            = useState('');
  const [search,   setSearch]           = useState('');
  const [statusFilter,     setStatusFilter]     = useState('');
  const [vendorTypeFilter, setVendorTypeFilter] = useState('');

  const canManage = user?.role === 'company_admin' || user?.role === 'finance_officer' || user?.role === 'project_manager';

  useEffect(() => {
    setLoading(true);
    invoiceApi.list({
      status:     statusFilter     || undefined,
      vendorType: vendorTypeFilter || undefined,
    })
      .then((r) => setInvoices(r.invoices))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load invoices'))
      .finally(() => setLoading(false));
  }, [statusFilter, vendorTypeFilter]);

  const filtered = useMemo(() => {
    if (!search) return invoices;
    const q = search.toLowerCase();
    return invoices.filter(
      (i) =>
        i.invoiceNumber.toLowerCase().includes(q) ||
        i.vendorName.toLowerCase().includes(q) ||
        i.project.name.toLowerCase().includes(q),
    );
  }, [invoices, search]);

  // KPIs
  const totalValue       = invoices.reduce((s, i) => s + Number(i.totalAmount), 0);
  const totalPaid        = invoices.reduce((s, i) => s + Number(i.paidAmount), 0);
  const totalOutstanding = totalValue - totalPaid;
  const overdueCount     = invoices.filter(isOverdue).length;

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6">
        <Skeleton className="h-12 w-80 rounded-xl" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title="Invoices"
        subtitle="Invoice management, payment tracking, and overdue alerts"
        action={
          canManage ? (
            <Link href="/invoices/new">
              <Button><Plus className="h-4 w-4 mr-1" /> New Invoice</Button>
            </Link>
          ) : undefined
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Global KPI strip */}
      {invoices.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Total Value"
            value={`$${(totalValue / 1_000_000).toFixed(1)}M`}
            icon={<Receipt className="h-5 w-5" />}
          />
          <StatCard
            label="Total Paid"
            value={`$${(totalPaid / 1_000_000).toFixed(1)}M`}
            icon={<TrendingDown className="h-5 w-5" />}
            valueClassName="text-emerald-600"
          />
          <StatCard
            label="Outstanding"
            value={`$${(totalOutstanding / 1_000_000).toFixed(1)}M`}
            icon={<TrendingUp className="h-5 w-5" />}
            valueClassName={totalOutstanding > 0 ? 'text-amber-600' : undefined}
          />
          <StatCard
            label="Overdue"
            value={overdueCount}
            icon={<AlertTriangle className="h-5 w-5" />}
            valueClassName={overdueCount > 0 ? 'text-red-500' : undefined}
          />
        </div>
      )}

      {/* Filters */}
      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search invoices, vendors, projects…"
        filters={[
          {
            label: 'Status',
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: '',              label: 'All statuses' },
              { value: 'draft',         label: 'Draft' },
              { value: 'submitted',     label: 'Submitted' },
              { value: 'approved',      label: 'Approved' },
              { value: 'partially_paid',label: 'Partially Paid' },
              { value: 'paid',          label: 'Paid' },
              { value: 'overdue',       label: 'Overdue' },
              { value: 'disputed',      label: 'Disputed' },
              { value: 'cancelled',     label: 'Cancelled' },
            ],
          },
          {
            label: 'Type',
            value: vendorTypeFilter,
            onChange: setVendorTypeFilter,
            options: [
              { value: '',           label: 'All types' },
              { value: 'contractor', label: 'Contractor' },
              { value: 'consultant', label: 'Consultant' },
              { value: 'supplier',   label: 'Supplier' },
              { value: 'marketing',  label: 'Marketing' },
              { value: 'internal',   label: 'Internal' },
              { value: 'other',      label: 'Other' },
            ],
          },
        ]}
      />

      {/* Invoice grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-12 w-12" />}
          title="No invoices found"
          description={canManage ? 'Create an invoice to start tracking payments.' : 'No invoices have been created yet.'}
          action={canManage ? { label: 'New Invoice', href: '/invoices/new' } : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((inv) => (
            <InvoiceCard key={inv.id} invoice={inv} />
          ))}
        </div>
      )}
    </div>
  );
}
