'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { invoiceApi, ApiError } from '@/lib/api';
import { Invoice } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle, ArrowLeft, Plus, Trash2, Save } from 'lucide-react';

// ─── Constants ─────────────────────────────────────────────────────────────────

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ZAR', 'AED', 'NGN', 'KES', 'GHS'];

// ─── New line item row ─────────────────────────────────────────────────────────

interface NewLineItem {
  description: string;
  quantity:    string;
  unitRate:    string;
  amount:      string;
  notes:       string;
}

const EMPTY: NewLineItem = { description: '', quantity: '1', unitRate: '', amount: '', notes: '' };

function NewLineItemRow({
  item,
  index,
  onChange,
  onRemove,
}: {
  item:     NewLineItem;
  index:    number;
  onChange: (i: number, field: keyof NewLineItem, value: string) => void;
  onRemove: (i: number) => void;
}) {
  function handleQtyRate(field: 'quantity' | 'unitRate', value: string) {
    const next = { ...item, [field]: value };
    const computed = ((parseFloat(next.quantity) || 0) * (parseFloat(next.unitRate) || 0)).toFixed(2);
    onChange(index, field, value);
    onChange(index, 'amount', computed);
  }

  return (
    <div className="grid grid-cols-12 gap-2 items-start">
      <div className="col-span-4">
        <Input value={item.description} onChange={(e) => onChange(index, 'description', e.target.value)} placeholder="Description" required />
      </div>
      <div className="col-span-2">
        <Input type="number" value={item.quantity} onChange={(e) => handleQtyRate('quantity', e.target.value)} placeholder="Qty" min="0" step="any" />
      </div>
      <div className="col-span-2">
        <Input type="number" value={item.unitRate} onChange={(e) => handleQtyRate('unitRate', e.target.value)} placeholder="Rate" min="0" step="any" />
      </div>
      <div className="col-span-2">
        <Input type="number" value={item.amount} onChange={(e) => onChange(index, 'amount', e.target.value)} placeholder="Amount" min="0" step="any" />
      </div>
      <div className="col-span-1">
        <Input value={item.notes} onChange={(e) => onChange(index, 'notes', e.target.value)} placeholder="Notes" />
      </div>
      <div className="col-span-1 flex justify-end pt-0.5">
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="rounded-md p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function EditInvoicePage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const router        = useRouter();
  const { user }      = useAuthStore();

  const canManage = user?.role === 'company_admin' || user?.role === 'finance_officer' || user?.role === 'project_manager';

  const [invoice, setInvoice]   = useState<Invoice | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState('');

  // Edit form state (core fields)
  const [form, setForm] = useState({
    invoiceNumber: '',
    vendorName:    '',
    currency:      'USD',
    issueDate:     '',
    dueDate:       '',
    subtotal:      '',
    taxAmount:     '',
    totalAmount:   '',
    notes:         '',
  });

  // New line items to add
  const [newLineItems, setNewLineItems] = useState<NewLineItem[]>([]);

  // Track which existing line items are being deleted
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    invoiceApi.get(invoiceId)
      .then((r) => {
        const inv = r.invoice;
        setInvoice(inv);
        setForm({
          invoiceNumber: inv.invoiceNumber,
          vendorName:    inv.vendorName,
          currency:      inv.currency,
          issueDate:     inv.issueDate.split('T')[0],
          dueDate:       inv.dueDate.split('T')[0],
          subtotal:      String(Number(inv.subtotal)),
          taxAmount:     String(Number(inv.taxAmount)),
          totalAmount:   String(Number(inv.totalAmount)),
          notes:         inv.notes ?? '',
        });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load invoice'))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-4">
        <Skeleton className="h-12 w-72 rounded-xl" />
        {[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      </div>
    );
  }

  if (!invoice) return null;

  if (!canManage || !['draft', 'submitted'].includes(invoice.status)) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive">
          <AlertDescription>
            {!canManage
              ? 'You do not have permission to edit invoices.'
              : `Invoices in "${invoice.status}" status cannot be edited.`}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  function setField<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateSubtotal(value: string) {
    setForm((f) => {
      const sub = parseFloat(value) || 0;
      const tax = parseFloat(f.taxAmount) || 0;
      return { ...f, subtotal: value, totalAmount: (sub + tax).toFixed(2) };
    });
  }

  function updateTax(value: string) {
    setForm((f) => {
      const sub = parseFloat(f.subtotal) || 0;
      const tax = parseFloat(value) || 0;
      return { ...f, taxAmount: value, totalAmount: (sub + tax).toFixed(2) };
    });
  }

  function handleNewItemChange(i: number, field: keyof NewLineItem, value: string) {
    setNewLineItems((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  }

  async function handleDeleteExistingLineItem(lineItemId: string) {
    if (!confirm('Remove this line item?')) return;
    setDeletingIds((prev) => new Set(prev).add(lineItemId));
    try {
      await invoiceApi.deleteLineItem(invoiceId, lineItemId);
      setInvoice((prev) => prev
        ? { ...prev, lineItems: prev.lineItems.filter((li) => li.id !== lineItemId) }
        : prev
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to remove line item');
    } finally {
      setDeletingIds((prev) => { const s = new Set(prev); s.delete(lineItemId); return s; });
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.invoiceNumber.trim()) { setError('Invoice number is required'); return; }
    if (!form.vendorName.trim())    { setError('Vendor name is required'); return; }
    if (!form.dueDate)              { setError('Due date is required'); return; }
    const subtotal    = parseFloat(form.subtotal) || 0;
    const totalAmount = parseFloat(form.totalAmount) || 0;
    if (subtotal <= 0 || totalAmount <= 0) { setError('Subtotal and total must be greater than zero'); return; }

    for (let i = 0; i < newLineItems.length; i++) {
      if (!newLineItems[i].description.trim()) {
        setError(`New line item ${i + 1}: description is required`);
        return;
      }
    }

    setError('');
    setSaving(true);
    try {
      // 1. Update core invoice fields
      await invoiceApi.update(invoiceId, {
        invoiceNumber: form.invoiceNumber.trim(),
        vendorName:    form.vendorName.trim(),
        currency:      form.currency,
        issueDate:     form.issueDate,
        dueDate:       form.dueDate,
        subtotal,
        taxAmount:     parseFloat(form.taxAmount) || 0,
        totalAmount,
        notes:         form.notes.trim() || null,
      });

      // 2. Add new line items sequentially
      for (const li of newLineItems) {
        if (!li.description.trim()) continue;
        await invoiceApi.addLineItem(invoiceId, {
          description: li.description.trim(),
          quantity:    parseFloat(li.quantity)  || 1,
          unitRate:    parseFloat(li.unitRate)   || 0,
          amount:      parseFloat(li.amount)     || 0,
          notes:       li.notes.trim() || undefined,
        });
      }

      router.push(`/invoices/${invoiceId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save changes');
      setSaving(false);
    }
  }

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader title="Edit Invoice" subtitle={invoice.invoiceNumber} />

      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* ── Core fields ───────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <h2 className="text-sm font-semibold text-foreground">Invoice Details</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Invoice Number *</label>
              <Input
                value={form.invoiceNumber}
                onChange={(e) => setField('invoiceNumber', e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Vendor Name *</label>
              <Input
                value={form.vendorName}
                onChange={(e) => setField('vendorName', e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Issue Date *</label>
              <Input
                type="date"
                value={form.issueDate}
                onChange={(e) => setField('issueDate', e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Due Date *</label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setField('dueDate', e.target.value)}
                required
              />
            </div>
          </div>
        </div>

        {/* ── Financials ────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <h2 className="text-sm font-semibold text-foreground">Financials</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Currency</label>
              <Select
                value={form.currency}
                onChange={(e) => setField('currency', e.target.value)}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Subtotal *</label>
              <Input
                type="number"
                value={form.subtotal}
                onChange={(e) => updateSubtotal(e.target.value)}
                min="0"
                step="any"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Tax Amount</label>
              <Input
                type="number"
                value={form.taxAmount}
                onChange={(e) => updateTax(e.target.value)}
                min="0"
                step="any"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Total Amount *</label>
              <Input
                type="number"
                value={form.totalAmount}
                onChange={(e) => setField('totalAmount', e.target.value)}
                min="0"
                step="any"
                required
              />
            </div>
          </div>
        </div>

        {/* ── Existing line items ───────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Line Items ({invoice.lineItems.length} existing)
            </h2>
            <Button
              type="button"
              variant="outline"
              onClick={() => setNewLineItems((prev) => [...prev, { ...EMPTY }])}
            >
              <Plus className="h-4 w-4 mr-1" /> Add Line Item
            </Button>
          </div>

          {/* Existing items */}
          {invoice.lineItems.length > 0 && (
            <div className="space-y-2">
              {invoice.lineItems.map((li) => (
                <div key={li.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{li.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {Number(li.quantity)} × {Number(li.unitRate).toLocaleString('en-US', { style: 'currency', currency: form.currency })} = {Number(li.amount).toLocaleString('en-US', { style: 'currency', currency: form.currency })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteExistingLineItem(li.id)}
                    disabled={deletingIds.has(li.id)}
                    className="rounded p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* New line items to add */}
          {newLineItems.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-border">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                New Line Items to Add
              </p>
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-0.5">
                <span className="col-span-4">Description</span>
                <span className="col-span-2">Qty</span>
                <span className="col-span-2">Rate</span>
                <span className="col-span-2">Amount</span>
                <span className="col-span-1">Notes</span>
                <span className="col-span-1" />
              </div>
              {newLineItems.map((item, i) => (
                <NewLineItemRow
                  key={i}
                  item={item}
                  index={i}
                  onChange={handleNewItemChange}
                  onRemove={(idx) => setNewLineItems((prev) => prev.filter((_, j) => j !== idx))}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Notes ─────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Notes</h2>
          <textarea
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="Optional internal notes…"
            rows={3}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(`/invoices/${invoiceId}`)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
