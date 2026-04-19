'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { invoiceApi, ApiError } from '@/lib/api';
import { Invoice } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import {
  Receipt, ArrowLeft, Edit2, CheckCircle2, AlertTriangle,
  Ban, DollarSign, TrendingDown, TrendingUp, AlertCircle,
  Trash2, Plus, Calendar, User, Building2, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function fmt(val: string | number, currency = 'USD') {
  return Number(val).toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 2 });
}

function isOverdue(invoice: Invoice): boolean {
  return invoice.status === 'overdue' ||
    (['approved', 'submitted', 'partially_paid'].includes(invoice.status) && new Date(invoice.dueDate) < new Date());
}

// ─── Record payment form ──────────────────────────────────────────────────────

function RecordPaymentForm({
  invoiceId,
  currency,
  onRecorded,
}: {
  invoiceId: string;
  currency:  string;
  onRecorded: () => void;
}) {
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [form, setForm] = useState({
    amount:      '',
    paymentDate: new Date().toISOString().split('T')[0],
    method:      'bank_transfer',
    reference:   '',
    notes:       '',
  });

  const METHODS = [
    { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'cheque',        label: 'Cheque' },
    { value: 'cash',          label: 'Cash' },
    { value: 'card',          label: 'Card' },
    { value: 'other',         label: 'Other' },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { setError('Amount must be greater than zero'); return; }
    setError('');
    setLoading(true);
    try {
      await invoiceApi.recordPayment(invoiceId, {
        amount,
        paymentDate: form.paymentDate,
        method:      form.method,
        reference:   form.reference.trim() || undefined,
        notes:       form.notes.trim()     || undefined,
      });
      setForm({ amount: '', paymentDate: new Date().toISOString().split('T')[0], method: 'bank_transfer', reference: '', notes: '' });
      setOpen(false);
      onRecorded();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <DollarSign className="h-4 w-4 mr-1" /> Record Payment
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Record Payment ({currency})</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Amount *</label>
          <Input
            type="number"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="0.00"
            min="0"
            step="any"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Payment Date *</label>
          <Input
            type="date"
            value={form.paymentDate}
            onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Method *</label>
          <Select
            value={form.method}
            onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
          >
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Reference</label>
          <Input
            value={form.reference}
            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            placeholder="Transaction ref…"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Optional payment notes…"
          rows={2}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={loading}>
          {loading ? 'Recording…' : 'Record Payment'}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const router        = useRouter();
  const { user }      = useAuthStore();

  const canManage        = user?.role === 'company_admin' || user?.role === 'finance_officer' || user?.role === 'project_manager';
  const canFinanceApprove = user?.role === 'company_admin' || user?.role === 'finance_officer';

  const [invoice,  setInvoice]  = useState<Invoice | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [actError, setActError] = useState('');
  const [acting,   setActing]   = useState(false);

  function load() {
    invoiceApi.get(invoiceId)
      .then((r) => setInvoice(r.invoice))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load invoice'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [invoiceId]);

  async function doAction(
    fn: () => Promise<{ invoice: Invoice }>,
  ) {
    setActing(true);
    setActError('');
    try {
      const { invoice: updated } = await fn();
      setInvoice(updated);
    } catch (e) {
      setActError(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setActing(false);
    }
  }

  async function handleDeletePayment(paymentId: string) {
    if (!confirm('Remove this payment record? The invoice status will be recalculated.')) return;
    try {
      await invoiceApi.deletePayment(invoiceId, paymentId);
      load();
    } catch (e) {
      setActError(e instanceof ApiError ? e.message : 'Failed to remove payment');
    }
  }

  async function handleDeleteLineItem(lineItemId: string) {
    if (!confirm('Remove this line item?')) return;
    try {
      await invoiceApi.deleteLineItem(invoiceId, lineItemId);
      load();
    } catch (e) {
      setActError(e instanceof ApiError ? e.message : 'Failed to remove line item');
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6">
        <Skeleton className="h-12 w-80 rounded-xl" />
        <div className="grid grid-cols-3 gap-4">{[1,2,3].map(i=><Skeleton key={i} className="h-24 rounded-xl"/>)}</div>
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      </div>
    );
  }

  if (!invoice) return null;

  const total       = Number(invoice.totalAmount);
  const paid        = Number(invoice.paidAmount);
  const outstanding = total - paid;
  const pct         = total > 0 ? Math.min((paid / total) * 100, 100) : 0;
  const overdue     = isOverdue(invoice);

  const canSubmit   = canManage && invoice.status === 'draft';
  const canApprove  = canFinanceApprove && ['submitted', 'draft'].includes(invoice.status);
  const canDispute  = canFinanceApprove && !['paid', 'cancelled'].includes(invoice.status);
  const canCancel   = canFinanceApprove && invoice.status !== 'paid';
  const canEdit     = canManage && ['draft', 'submitted'].includes(invoice.status);
  const canPay      = canFinanceApprove && ['approved', 'partially_paid', 'overdue'].includes(invoice.status);
  const canAddLines = canManage && ['draft', 'submitted'].includes(invoice.status);

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title={invoice.invoiceNumber}
        subtitle={`${invoice.project.name}${invoice.project.code ? ` · ${invoice.project.code}` : ''} · ${invoice.vendorName}`}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {canEdit && (
              <Link href={`/invoices/${invoiceId}/edit`}>
                <Button variant="outline" disabled={acting}>
                  <Edit2 className="h-4 w-4 mr-1" /> Edit
                </Button>
              </Link>
            )}
            {canSubmit && (
              <Button variant="outline" onClick={() => doAction(() => invoiceApi.submit(invoiceId))} disabled={acting}>
                Submit
              </Button>
            )}
            {canApprove && (
              <Button onClick={() => doAction(() => invoiceApi.approve(invoiceId))} disabled={acting}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
              </Button>
            )}
            {canDispute && (
              <Button
                variant="outline"
                onClick={() => {
                  const notes = prompt('Reason for dispute (optional):') ?? undefined;
                  doAction(() => invoiceApi.dispute(invoiceId, notes || undefined));
                }}
                disabled={acting}
              >
                Dispute
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm('Cancel this invoice?')) doAction(() => invoiceApi.cancel(invoiceId));
                }}
                disabled={acting}
              >
                <Ban className="h-4 w-4 mr-1" /> Cancel
              </Button>
            )}
          </div>
        }
      />

      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Invoices
      </button>

      {actError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{actError}</AlertDescription>
        </Alert>
      )}

      {/* ── Status + meta ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={STATUS_VARIANT[invoice.status] ?? 'pending'} className="text-sm px-3 py-1">
          {invoice.status === 'paid'      && <CheckCircle2   className="h-3.5 w-3.5 mr-1" />}
          {invoice.status === 'overdue'   && <AlertTriangle  className="h-3.5 w-3.5 mr-1" />}
          {invoice.status === 'cancelled' && <Ban            className="h-3.5 w-3.5 mr-1" />}
          {STATUS_LABEL[invoice.status]}
        </Badge>
        {invoice.approvedBy && (
          <span className="text-xs text-muted-foreground">
            Approved by {invoice.approvedBy.firstName} {invoice.approvedBy.lastName}
            {invoice.approvedAt ? ` on ${new Date(invoice.approvedAt).toLocaleDateString()}` : ''}
          </span>
        )}
        {invoice.createdBy && (
          <span className="text-xs text-muted-foreground">
            Created by {invoice.createdBy.firstName} {invoice.createdBy.lastName}
          </span>
        )}
      </div>

      {/* Overdue alert */}
      {overdue && invoice.status !== 'paid' && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This invoice is overdue. Due date was {new Date(invoice.dueDate).toLocaleDateString()}.
          </AlertDescription>
        </Alert>
      )}

      {/* ── KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Amount"
          value={fmt(total, invoice.currency)}
          icon={<Receipt className="h-5 w-5" />}
        />
        <StatCard
          label="Amount Paid"
          value={fmt(paid, invoice.currency)}
          icon={<TrendingDown className="h-5 w-5" />}
          valueClassName="text-emerald-600"
        />
        <StatCard
          label="Outstanding"
          value={fmt(outstanding, invoice.currency)}
          icon={<TrendingUp className="h-5 w-5" />}
          valueClassName={outstanding > 0 && overdue ? 'text-red-500' : outstanding > 0 ? 'text-amber-600' : undefined}
        />
      </div>

      {/* Payment progress bar */}
      {['approved', 'partially_paid', 'overdue', 'paid'].includes(invoice.status) && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>Payment progress</span>
            <span>{pct.toFixed(1)}% paid</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', {
                'bg-emerald-500': invoice.status === 'paid',
                'bg-red-500':     overdue && invoice.status !== 'paid',
                'bg-amber-500':   !overdue && invoice.status !== 'paid',
              })}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Invoice info grid ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Invoice Information</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <InfoRow icon={<FileText className="h-4 w-4" />} label="Invoice #" value={invoice.invoiceNumber} />
          <InfoRow icon={<Building2 className="h-4 w-4" />} label="Vendor" value={`${invoice.vendorName} (${invoice.vendorType})`} />
          <InfoRow icon={<Calendar className="h-4 w-4" />} label="Issue Date" value={new Date(invoice.issueDate).toLocaleDateString()} />
          <InfoRow icon={<Calendar className="h-4 w-4" />} label="Due Date" value={new Date(invoice.dueDate).toLocaleDateString()} />
          {invoice.paidAt && (
            <InfoRow icon={<CheckCircle2 className="h-4 w-4" />} label="Paid At" value={new Date(invoice.paidAt).toLocaleDateString()} />
          )}
          {invoice.contractor && (
            <InfoRow icon={<User className="h-4 w-4" />} label="Contractor" value={invoice.contractor.name} />
          )}
          {invoice.supplier && (
            <InfoRow icon={<Building2 className="h-4 w-4" />} label="Supplier" value={invoice.supplier.name} />
          )}
          {invoice.consultantUser && (
            <InfoRow icon={<User className="h-4 w-4" />} label="Consultant" value={`${invoice.consultantUser.firstName} ${invoice.consultantUser.lastName}`} />
          )}
          {invoice.budgetLineItem && (
            <InfoRow icon={<Receipt className="h-4 w-4" />} label="Budget Line" value={`${invoice.budgetLineItem.category}: ${invoice.budgetLineItem.description}`} />
          )}
          {invoice.deliveryRecord && (
            <InfoRow icon={<FileText className="h-4 w-4" />} label="Delivery" value={invoice.deliveryRecord.itemDescription} />
          )}
        </div>
        {invoice.notes && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-foreground">{invoice.notes}</p>
          </div>
        )}
      </div>

      {/* ── Amounts breakdown ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Amounts</h2>
        <div className="space-y-2 text-sm max-w-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">{fmt(invoice.subtotal, invoice.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span className="font-medium">{fmt(invoice.taxAmount, invoice.currency)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <span>Total</span>
            <span>{fmt(invoice.totalAmount, invoice.currency)}</span>
          </div>
        </div>
      </div>

      {/* ── Line items ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Line Items</h2>
          {canAddLines && (
            <Link href={`/invoices/${invoiceId}/edit`}>
              <Button variant="outline">
                <Plus className="h-4 w-4 mr-1" /> Add Line Item
              </Button>
            </Link>
          )}
        </div>

        {invoice.lineItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">No line items on this invoice.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Description</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Qty</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Rate</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Amount</th>
                  {canAddLines && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invoice.lineItems.map((li) => (
                  <tr key={li.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{li.description}</p>
                      {li.notes && <p className="text-xs text-muted-foreground mt-0.5">{li.notes}</p>}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{Number(li.quantity)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fmt(li.unitRate, invoice.currency)}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(li.amount, invoice.currency)}</td>
                    {canAddLines && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDeleteLineItem(li.id)}
                          className="rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          title="Remove line item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/20">
                <tr>
                  <td colSpan={canAddLines ? 3 : 3} className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                    Line items total
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {fmt(
                      invoice.lineItems.reduce((s, li) => s + Number(li.amount), 0),
                      invoice.currency,
                    )}
                  </td>
                  {canAddLines && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Payments ───────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="font-semibold text-foreground">Payments</h2>

        {canPay && (
          <RecordPaymentForm
            invoiceId={invoiceId}
            currency={invoice.currency}
            onRecorded={load}
          />
        )}

        {invoice.payments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Method</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Reference</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Recorded by</th>
                  {canFinanceApprove && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invoice.payments.map((pmt) => (
                  <tr key={pmt.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">{new Date(pmt.paymentDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3 capitalize">{pmt.method.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-muted-foreground">{pmt.reference ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600">
                      {fmt(pmt.amount, pmt.currency)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {pmt.recordedBy.firstName} {pmt.recordedBy.lastName}
                    </td>
                    {canFinanceApprove && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDeletePayment(pmt.id)}
                          className="rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          title="Remove payment"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/20">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
                    Total paid
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                    {fmt(invoice.paidAmount, invoice.currency)}
                  </td>
                  <td />
                  {canFinanceApprove && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Info row helper ──────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}
