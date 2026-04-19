'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { budgetApi, ApiError } from '@/lib/api';
import { Budget, BudgetLineItem, BudgetCategory, VariationOrder } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import {
  ArrowLeft, Plus, Trash2, Save, AlertCircle,
  Users, ShoppingCart, Wrench, Building2, Megaphone,
  Layers, FileCheck, RefreshCw, Shield, ChevronDown,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: Array<{ value: BudgetCategory; label: string }> = [
  { value: 'labour',            label: 'Labour' },
  { value: 'materials',         label: 'Materials' },
  { value: 'equipment',         label: 'Equipment' },
  { value: 'subcontractors',    label: 'Subcontractors' },
  { value: 'consultants',       label: 'Consultants' },
  { value: 'marketing',         label: 'Marketing' },
  { value: 'overheads',         label: 'Overheads' },
  { value: 'permits_statutory', label: 'Permits / Statutory' },
  { value: 'variations',        label: 'Variations' },
  { value: 'contingency',       label: 'Contingency' },
];

const CONSULTANT_TYPES = [
  { value: 'engineer',         label: 'Engineer' },
  { value: 'architect',        label: 'Architect' },
  { value: 'quantity_surveyor',label: 'Quantity Surveyor' },
  { value: 'other',            label: 'Other' },
];

// ─── Add line item form ───────────────────────────────────────────────────────

interface LineItemFormState {
  category:       BudgetCategory;
  description:    string;
  quantity:       string;
  unit:           string;
  unitRate:       string;
  budgetedAmount: string;
  committedAmount:string;
  actualSpend:    string;
  notes:          string;
  // Consultant
  consultantType: string;
  consultantName: string;
  firmName:       string;
  feeAgreed:      string;
  feePaid:        string;
  feeOutstanding: string;
  // Marketing
  campaignName:   string;
  channel:        string;
  vendorAgency:   string;
  mktBudgeted:    string;
  mktActual:      string;
  mktPaid:        string;
  expectedRoi:    string;
}

const EMPTY_FORM: LineItemFormState = {
  category: 'labour', description: '', quantity: '', unit: '',
  unitRate: '', budgetedAmount: '', committedAmount: '', actualSpend: '',
  notes: '', consultantType: 'engineer', consultantName: '', firmName: '',
  feeAgreed: '', feePaid: '', feeOutstanding: '', campaignName: '',
  channel: '', vendorAgency: '', mktBudgeted: '', mktActual: '',
  mktPaid: '', expectedRoi: '',
};

// ─── Variation form ───────────────────────────────────────────────────────────

interface VarFormState {
  referenceNumber: string;
  description:     string;
  amount:          string;
  direction:       'addition' | 'omission';
}

const EMPTY_VAR: VarFormState = { referenceNumber: '', description: '', amount: '', direction: 'addition' };

// ─── Line item table row ──────────────────────────────────────────────────────

function ExistingLineItemRow({
  item,
  currency,
  onDelete,
  locked,
}: {
  item: BudgetLineItem;
  currency: string;
  onDelete: (id: string) => void;
  locked: boolean;
}) {
  function fmt(v: string | number) {
    return Number(v).toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  }
  const cat = CATEGORIES.find((c) => c.value === item.category);

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 text-sm">
      <div className="flex-1 min-w-0">
        <span className="font-medium text-foreground truncate block">{item.description}</span>
        <span className="text-xs text-muted-foreground">{cat?.label ?? item.category}</span>
        {item.consultantCostEntry && (
          <span className="text-xs text-blue-600 ml-2">· {item.consultantCostEntry.consultantName}</span>
        )}
        {item.marketingBudgetEntry && (
          <span className="text-xs text-purple-600 ml-2">· {item.marketingBudgetEntry.campaignName}</span>
        )}
      </div>
      <div className="hidden sm:grid grid-cols-3 gap-4 text-right text-xs">
        <div>
          <p className="text-muted-foreground">Budgeted</p>
          <p className="font-medium text-foreground">{fmt(item.budgetedAmount)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Spent</p>
          <p className={`font-medium ${Number(item.actualSpend) > Number(item.budgetedAmount) ? 'text-red-500' : 'text-foreground'}`}>{fmt(item.actualSpend)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Remaining</p>
          <p className={`font-medium ${Number(item.budgetedAmount) - Number(item.actualSpend) < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
            {fmt(Number(item.budgetedAmount) - Number(item.actualSpend))}
          </p>
        </div>
      </div>
      {!locked && (
        <button
          onClick={() => onDelete(item.id)}
          className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
          title="Delete line item"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BudgetEditPage() {
  const { budgetId } = useParams<{ budgetId: string }>();
  const router        = useRouter();
  const { user }      = useAuthStore();

  const [budget,  setBudget]  = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);

  // Meta edit
  const [metaForm, setMetaForm] = useState({ name: '', notes: '' });

  // Line item form
  const [showLiForm, setShowLiForm] = useState(false);
  const [liForm, setLiForm] = useState<LineItemFormState>(EMPTY_FORM);
  const [liSaving, setLiSaving] = useState(false);

  // Variation form
  const [showVarForm, setShowVarForm] = useState(false);
  const [varForm, setVarForm] = useState<VarFormState>(EMPTY_VAR);
  const [varSaving, setVarSaving] = useState(false);

  const canManage = user?.role === 'company_admin' || user?.role === 'finance_officer' || user?.role === 'project_manager';

  function load() {
    budgetApi.get(budgetId)
      .then((r) => {
        setBudget(r.budget);
        setMetaForm({ name: r.budget.name, notes: r.budget.notes ?? '' });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [budgetId]);

  if (!canManage) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive"><AlertDescription>You do not have permission to edit budgets.</AlertDescription></Alert>
      </div>
    );
  }

  async function handleSaveMeta(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await budgetApi.update(budgetId, { name: metaForm.name, notes: metaForm.notes || null });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  async function handleAddLineItem(e: React.FormEvent) {
    e.preventDefault();
    if (!liForm.budgetedAmount) { setError('Budgeted amount is required'); return; }
    setError('');
    setLiSaving(true);
    try {
      await budgetApi.addLineItem(budgetId, {
        category:        liForm.category,
        description:     liForm.description,
        quantity:        liForm.quantity    ? Number(liForm.quantity)    : undefined,
        unit:            liForm.unit        || undefined,
        unitRate:        liForm.unitRate    ? Number(liForm.unitRate)    : undefined,
        budgetedAmount:  Number(liForm.budgetedAmount),
        committedAmount: liForm.committedAmount ? Number(liForm.committedAmount) : undefined,
        actualSpend:     liForm.actualSpend ? Number(liForm.actualSpend) : undefined,
        notes:           liForm.notes || undefined,
        ...(liForm.category === 'consultants' && {
          consultant: {
            consultantType: liForm.consultantType,
            consultantName: liForm.consultantName,
            firmName:       liForm.firmName || undefined,
            feeAgreed:      Number(liForm.feeAgreed || liForm.budgetedAmount),
            feePaid:        liForm.feePaid    ? Number(liForm.feePaid)    : undefined,
            feeOutstanding: liForm.feeOutstanding ? Number(liForm.feeOutstanding) : undefined,
          },
        }),
        ...(liForm.category === 'marketing' && {
          marketing: {
            campaignName:   liForm.campaignName,
            channel:        liForm.channel,
            vendorAgency:   liForm.vendorAgency || undefined,
            budgetedAmount: Number(liForm.mktBudgeted || liForm.budgetedAmount),
            actualSpend:    liForm.mktActual ? Number(liForm.mktActual) : undefined,
            paidAmount:     liForm.mktPaid   ? Number(liForm.mktPaid)   : undefined,
            expectedRoi:    liForm.expectedRoi || undefined,
          },
        }),
      });
      setLiForm(EMPTY_FORM);
      setShowLiForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add line item');
    } finally { setLiSaving(false); }
  }

  async function handleDeleteLineItem(lineItemId: string) {
    if (!confirm('Delete this line item?')) return;
    try {
      await budgetApi.deleteLineItem(budgetId, lineItemId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete');
    }
  }

  async function handleAddVariation(e: React.FormEvent) {
    e.preventDefault();
    if (!varForm.amount) { setError('Amount is required'); return; }
    setError('');
    setVarSaving(true);
    try {
      await budgetApi.addVariation(budgetId, {
        referenceNumber: varForm.referenceNumber,
        description:     varForm.description,
        amount:          Number(varForm.amount),
        direction:       varForm.direction,
      });
      setVarForm(EMPTY_VAR);
      setShowVarForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add variation');
    } finally { setVarSaving(false); }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-4">
        <Skeleton className="h-12 w-80 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!budget) return null;

  const locked = budget.status === 'locked';

  return (
    <div className="px-6 py-8 space-y-8 animate-fade-in">
      <PageHeader
        title={`Edit: ${budget.name}`}
        subtitle={`${budget.project.name} · ${budget.currency}`}
      />

      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Budget
      </button>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {locked && (
        <Alert>
          <AlertDescription>This budget is <strong>locked</strong> and cannot be edited.</AlertDescription>
        </Alert>
      )}

      {/* ── Meta form ───────────────────────────────────────────────────── */}
      {!locked && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-foreground">Budget Details</h2>
          <form onSubmit={handleSaveMeta} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Budget Name *</label>
              <Input
                value={metaForm.name}
                onChange={(e) => setMetaForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Notes</label>
              <textarea
                value={metaForm.notes}
                onChange={(e) => setMetaForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
            <Button type="submit" disabled={saving} size="sm">
              <Save className="h-4 w-4 mr-1" />
              {saving ? 'Saving…' : 'Save Details'}
            </Button>
          </form>
        </section>
      )}

      {/* ── Line Items ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Line Items</h2>
          {!locked && (
            <Button size="sm" variant="outline" onClick={() => setShowLiForm((p) => !p)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Line Item
            </Button>
          )}
        </div>

        {/* Add line item form */}
        {showLiForm && !locked && (
          <form onSubmit={handleAddLineItem} className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">New Line Item</h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Category *</label>
                <Select
                  value={liForm.category}
                  onChange={(e) => setLiForm((f) => ({ ...f, category: e.target.value as BudgetCategory }))}
                  required
                >
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Description *</label>
                <Input
                  value={liForm.description}
                  onChange={(e) => setLiForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Portland cement bags"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Budgeted Amount *</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={liForm.budgetedAmount}
                  onChange={(e) => setLiForm((f) => ({ ...f, budgetedAmount: e.target.value }))}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Committed Amount</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={liForm.committedAmount}
                  onChange={(e) => setLiForm((f) => ({ ...f, committedAmount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Actual Spend</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={liForm.actualSpend}
                  onChange={(e) => setLiForm((f) => ({ ...f, actualSpend: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Quantity</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={liForm.quantity}
                    onChange={(e) => setLiForm((f) => ({ ...f, quantity: e.target.value }))}
                    placeholder="Qty"
                  />
                  <Input
                    value={liForm.unit}
                    onChange={(e) => setLiForm((f) => ({ ...f, unit: e.target.value }))}
                    placeholder="Unit"
                  />
                </div>
              </div>
            </div>

            {/* Consultant-specific fields */}
            {liForm.category === 'consultants' && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Consultant Details</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Consultant Type *</label>
                    <Select
                      value={liForm.consultantType}
                      onChange={(e) => setLiForm((f) => ({ ...f, consultantType: e.target.value }))}
                    >
                      {CONSULTANT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Consultant Name *</label>
                    <Input
                      value={liForm.consultantName}
                      onChange={(e) => setLiForm((f) => ({ ...f, consultantName: e.target.value }))}
                      placeholder="Full name"
                      required={liForm.category === 'consultants'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Firm / Company</label>
                    <Input
                      value={liForm.firmName}
                      onChange={(e) => setLiForm((f) => ({ ...f, firmName: e.target.value }))}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Agreed Fee</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={liForm.feeAgreed}
                      onChange={(e) => setLiForm((f) => ({ ...f, feeAgreed: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Fee Paid</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={liForm.feePaid}
                      onChange={(e) => setLiForm((f) => ({ ...f, feePaid: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Fee Outstanding</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={liForm.feeOutstanding}
                      onChange={(e) => setLiForm((f) => ({ ...f, feeOutstanding: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Marketing-specific fields */}
            {liForm.category === 'marketing' && (
              <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4 space-y-3">
                <p className="text-xs font-semibold text-purple-700 dark:text-purple-400">Marketing Details</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Campaign Name *</label>
                    <Input
                      value={liForm.campaignName}
                      onChange={(e) => setLiForm((f) => ({ ...f, campaignName: e.target.value }))}
                      placeholder="e.g. Q2 Launch"
                      required={liForm.category === 'marketing'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Channel *</label>
                    <Input
                      value={liForm.channel}
                      onChange={(e) => setLiForm((f) => ({ ...f, channel: e.target.value }))}
                      placeholder="e.g. digital, print, outdoor"
                      required={liForm.category === 'marketing'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Vendor / Agency</label>
                    <Input
                      value={liForm.vendorAgency}
                      onChange={(e) => setLiForm((f) => ({ ...f, vendorAgency: e.target.value }))}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Marketing Budget</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={liForm.mktBudgeted}
                      onChange={(e) => setLiForm((f) => ({ ...f, mktBudgeted: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Actual Spend</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={liForm.mktActual}
                      onChange={(e) => setLiForm((f) => ({ ...f, mktActual: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Amount Paid</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={liForm.mktPaid}
                      onChange={(e) => setLiForm((f) => ({ ...f, mktPaid: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-medium text-foreground">Expected ROI</label>
                    <Input
                      value={liForm.expectedRoi}
                      onChange={(e) => setLiForm((f) => ({ ...f, expectedRoi: e.target.value }))}
                      placeholder="e.g. 3x units sold (optional)"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Notes</label>
              <Input
                value={liForm.notes}
                onChange={(e) => setLiForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </div>

            <div className="flex gap-3">
              <Button type="submit" size="sm" disabled={liSaving}>
                {liSaving ? 'Adding…' : 'Add Line Item'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { setShowLiForm(false); setLiForm(EMPTY_FORM); }}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/* Existing line items */}
        {budget.lineItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No line items yet. Add the first one above.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {budget.lineItems.map((li) => (
              <ExistingLineItemRow
                key={li.id}
                item={li}
                currency={budget.currency}
                onDelete={handleDeleteLineItem}
                locked={locked}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Variation Orders ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Variation Orders</h2>
          {!locked && (
            <Button size="sm" variant="outline" onClick={() => setShowVarForm((p) => !p)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Variation
            </Button>
          )}
        </div>

        {showVarForm && !locked && (
          <form onSubmit={handleAddVariation} className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">New Variation Order</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Reference Number *</label>
                <Input
                  value={varForm.referenceNumber}
                  onChange={(e) => setVarForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                  placeholder="e.g. VO-001"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Direction</label>
                <Select
                  value={varForm.direction}
                  onChange={(e) => setVarForm((f) => ({ ...f, direction: e.target.value as 'addition' | 'omission' }))}
                >
                  <option value="addition">Addition (increases budget)</option>
                  <option value="omission">Omission (reduces budget)</option>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium text-foreground">Description *</label>
                <Input
                  value={varForm.description}
                  onChange={(e) => setVarForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What does this variation cover?"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Amount ({budget.currency}) *</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={varForm.amount}
                  onChange={(e) => setVarForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Button type="submit" size="sm" disabled={varSaving}>
                {varSaving ? 'Adding…' : 'Add Variation'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { setShowVarForm(false); setVarForm(EMPTY_VAR); }}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {budget.variationOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No variation orders yet.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {budget.variationOrders.map((v) => (
              <div key={v.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{v.referenceNumber}</span>
                    <Badge variant={v.status === 'approved' ? 'active' : v.status === 'rejected' ? 'inactive' : 'pending'}>
                      {v.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground mt-0.5">{v.description}</p>
                </div>
                <p className={`text-sm font-semibold flex-shrink-0 ${v.direction === 'addition' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {v.direction === 'omission' ? '-' : '+'}
                  {Number(v.amount).toLocaleString('en-US', { style: 'currency', currency: budget.currency, maximumFractionDigits: 0 })}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Done button */}
      <div className="pt-2">
        <Button onClick={() => router.push(`/budget/${budgetId}`)}>
          Done — View Budget
        </Button>
      </div>
    </div>
  );
}
