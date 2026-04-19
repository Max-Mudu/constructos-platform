'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invoiceApi, projectApi, ApiError } from '@/lib/api';
import { Project, InvoiceVendorType } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle, ArrowLeft, Plus, Trash2 } from 'lucide-react';

// ─── Constants ─────────────────────────────────────────────────────────────────

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ZAR', 'AED', 'NGN', 'KES', 'GHS'];

const VENDOR_TYPES: Array<{ value: InvoiceVendorType; label: string }> = [
  { value: 'contractor', label: 'Contractor' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'supplier',   label: 'Supplier' },
  { value: 'marketing',  label: 'Marketing' },
  { value: 'internal',   label: 'Internal' },
  { value: 'other',      label: 'Other' },
];

// ─── Line item row ─────────────────────────────────────────────────────────────

interface LineItem {
  description: string;
  quantity:    string;
  unitRate:    string;
  amount:      string;
  notes:       string;
}

const EMPTY_LINE_ITEM: LineItem = { description: '', quantity: '1', unitRate: '', amount: '', notes: '' };

function LineItemRow({
  item,
  index,
  onChange,
  onRemove,
}: {
  item:     LineItem;
  index:    number;
  onChange: (index: number, field: keyof LineItem, value: string) => void;
  onRemove: (index: number) => void;
}) {
  function handleQtyOrRate(field: 'quantity' | 'unitRate', value: string) {
    const next = { ...item, [field]: value };
    const qty  = parseFloat(next.quantity)  || 0;
    const rate = parseFloat(next.unitRate) || 0;
    const computed = (qty * rate).toFixed(2);
    onChange(index, field,    value);
    onChange(index, 'amount', computed);
  }

  return (
    <div className="grid grid-cols-12 gap-2 items-start">
      <div className="col-span-4">
        <Input
          value={item.description}
          onChange={(e) => onChange(index, 'description', e.target.value)}
          placeholder="Description"
          required
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number"
          value={item.quantity}
          onChange={(e) => handleQtyOrRate('quantity', e.target.value)}
          placeholder="Qty"
          min="0"
          step="any"
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number"
          value={item.unitRate}
          onChange={(e) => handleQtyOrRate('unitRate', e.target.value)}
          placeholder="Unit rate"
          min="0"
          step="any"
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number"
          value={item.amount}
          onChange={(e) => onChange(index, 'amount', e.target.value)}
          placeholder="Amount"
          min="0"
          step="any"
        />
      </div>
      <div className="col-span-1">
        <Input
          value={item.notes}
          onChange={(e) => onChange(index, 'notes', e.target.value)}
          placeholder="Notes"
        />
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

export default function NewInvoicePage() {
  const router   = useRouter();
  const { user } = useAuthStore();

  const canCreate = user?.role === 'company_admin' || user?.role === 'finance_officer' || user?.role === 'project_manager';

  const [projects,        setProjects]        = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [error,           setError]           = useState('');
  const [loading,         setLoading]         = useState(false);

  const [form, setForm] = useState({
    projectId:     '',
    invoiceNumber: '',
    vendorType:    'contractor' as InvoiceVendorType,
    vendorName:    '',
    currency:      'USD',
    issueDate:     new Date().toISOString().split('T')[0],
    dueDate:       '',
    subtotal:      '',
    taxAmount:     '',
    totalAmount:   '',
    notes:         '',
  });

  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  useEffect(() => {
    projectApi.list()
      .then((r) => setProjects((r as any).projects ?? r))
      .catch(() => {})
      .finally(() => setLoadingProjects(false));
  }, []);

  if (!canCreate) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive">
          <AlertDescription>You do not have permission to create invoices.</AlertDescription>
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

  function handleLineItemChange(index: number, field: keyof LineItem, value: string) {
    setLineItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, { ...EMPTY_LINE_ITEM }]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.projectId)     { setError('Please select a project'); return; }
    if (!form.invoiceNumber) { setError('Invoice number is required'); return; }
    if (!form.vendorName)    { setError('Vendor name is required'); return; }
    if (!form.dueDate)       { setError('Due date is required'); return; }

    const subtotal    = parseFloat(form.subtotal)    || 0;
    const totalAmount = parseFloat(form.totalAmount) || 0;
    if (subtotal <= 0 || totalAmount <= 0) {
      setError('Subtotal and total amount must be greater than zero');
      return;
    }

    // Validate line items
    for (let i = 0; i < lineItems.length; i++) {
      if (!lineItems[i].description.trim()) {
        setError(`Line item ${i + 1}: description is required`);
        return;
      }
    }

    setError('');
    setLoading(true);
    try {
      const { invoice } = await invoiceApi.create({
        projectId:     form.projectId,
        invoiceNumber: form.invoiceNumber.trim(),
        vendorType:    form.vendorType,
        vendorName:    form.vendorName.trim(),
        currency:      form.currency,
        issueDate:     form.issueDate,
        dueDate:       form.dueDate,
        subtotal,
        taxAmount:     parseFloat(form.taxAmount) || 0,
        totalAmount,
        notes:         form.notes.trim() || undefined,
        lineItems: lineItems.length > 0
          ? lineItems.map((li) => ({
              description: li.description.trim(),
              quantity:    parseFloat(li.quantity)  || 1,
              unitRate:    parseFloat(li.unitRate)   || 0,
              amount:      parseFloat(li.amount)     || 0,
              notes:       li.notes.trim() || undefined,
            }))
          : undefined,
      });
      router.push(`/invoices/${invoice.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create invoice');
      setLoading(false);
    }
  }

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader title="New Invoice" subtitle="Create an invoice for a project" />

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

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── Core details ──────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <h2 className="text-sm font-semibold text-foreground">Invoice Details</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Project *</label>
              {loadingProjects ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <Select
                  value={form.projectId}
                  onChange={(e) => setField('projectId', e.target.value)}
                  required
                >
                  <option value="">Select a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.code ? ` (${p.code})` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Invoice Number *</label>
              <Input
                value={form.invoiceNumber}
                onChange={(e) => setField('invoiceNumber', e.target.value)}
                placeholder="e.g. INV-2026-001"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Vendor Type *</label>
              <Select
                value={form.vendorType}
                onChange={(e) => setField('vendorType', e.target.value as InvoiceVendorType)}
                required
              >
                {VENDOR_TYPES.map((vt) => (
                  <option key={vt.value} value={vt.value}>{vt.label}</option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Vendor Name *</label>
              <Input
                value={form.vendorName}
                onChange={(e) => setField('vendorName', e.target.value)}
                placeholder="e.g. Acme Construction Ltd"
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
                placeholder="0.00"
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
                placeholder="0.00"
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
                placeholder="0.00"
                min="0"
                step="any"
                required
              />
              <p className="text-xs text-muted-foreground">Auto-calculated from subtotal + tax</p>
            </div>
          </div>
        </div>

        {/* ── Line items ────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Line Items</h2>
            <Button type="button" variant="outline" onClick={addLineItem}>
              <Plus className="h-4 w-4 mr-1" /> Add Line Item
            </Button>
          </div>

          {lineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No line items added. Line items are optional.</p>
          ) : (
            <div className="space-y-3">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-0.5">
                <span className="col-span-4">Description</span>
                <span className="col-span-2">Qty</span>
                <span className="col-span-2">Unit Rate</span>
                <span className="col-span-2">Amount</span>
                <span className="col-span-1">Notes</span>
                <span className="col-span-1" />
              </div>
              {lineItems.map((item, i) => (
                <LineItemRow
                  key={i}
                  item={item}
                  index={i}
                  onChange={handleLineItemChange}
                  onRemove={removeLineItem}
                />
              ))}
              <div className="flex justify-end pt-2 border-t border-border">
                <p className="text-sm font-semibold text-foreground">
                  Line items total:{' '}
                  <span className="text-primary">
                    {lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0).toLocaleString('en-US', {
                      style: 'currency',
                      currency: form.currency,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </p>
              </div>
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
          <Button type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create Invoice'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
