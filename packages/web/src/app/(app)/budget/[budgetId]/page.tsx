'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { budgetApi, ApiError } from '@/lib/api';
import { Budget, BudgetSummary, BudgetLineItem, BudgetCategory, VariationOrder } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import {
  PieChart, ArrowLeft, Edit2, CheckCircle2, Lock,
  AlertTriangle, TrendingDown, TrendingUp, Minus,
  Plus, Trash2, Clock, Users, ShoppingCart, Wrench,
  Building2, Megaphone, Layers, FileCheck, RefreshCw,
  Shield, ChevronDown, ChevronUp,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, 'pending' | 'active' | 'inactive'> = {
  draft: 'pending', approved: 'active', locked: 'inactive',
};

const CATEGORY_META: Record<BudgetCategory, { label: string; icon: React.ReactNode }> = {
  labour:            { label: 'Labour',             icon: <Users    className="h-4 w-4" /> },
  materials:         { label: 'Materials',           icon: <ShoppingCart className="h-4 w-4" /> },
  equipment:         { label: 'Equipment',           icon: <Wrench   className="h-4 w-4" /> },
  subcontractors:    { label: 'Subcontractors',      icon: <Building2 className="h-4 w-4" /> },
  consultants:       { label: 'Consultants',         icon: <Users    className="h-4 w-4" /> },
  marketing:         { label: 'Marketing',           icon: <Megaphone className="h-4 w-4" /> },
  overheads:         { label: 'Overheads',           icon: <Layers   className="h-4 w-4" /> },
  permits_statutory: { label: 'Permits / Statutory', icon: <FileCheck className="h-4 w-4" /> },
  variations:        { label: 'Variations',          icon: <RefreshCw className="h-4 w-4" /> },
  contingency:       { label: 'Contingency',         icon: <Shield   className="h-4 w-4" /> },
};

function fmt(val: string | number, currency = 'USD') {
  return Number(val).toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
}

function pctBar(spent: number, budgeted: number) {
  const pct = budgeted > 0 ? Math.min((spent / budgeted) * 100, 100) : 0;
  const color = spent > budgeted ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return { pct, color };
}

// ─── Category breakdown row ───────────────────────────────────────────────────

function CategoryRow({
  category,
  items,
  currency,
}: {
  category: BudgetCategory;
  items: BudgetLineItem[];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const budgeted  = items.reduce((s, li) => s + Number(li.budgetedAmount),  0);
  const committed = items.reduce((s, li) => s + Number(li.committedAmount), 0);
  const spent     = items.reduce((s, li) => s + Number(li.actualSpend),     0);
  const remaining = budgeted - spent;
  const variance  = budgeted - spent;
  const { pct, color } = pctBar(spent, budgeted);
  const meta = CATEGORY_META[category];

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary flex-shrink-0">
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{meta.label}</p>
          <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-6 text-right hidden sm:grid">
          <div>
            <p className="text-xs text-muted-foreground">Budgeted</p>
            <p className="text-sm font-medium text-foreground">{fmt(budgeted, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Committed</p>
            <p className="text-sm font-medium text-foreground">{fmt(committed, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Spent</p>
            <p className={`text-sm font-medium ${spent > budgeted ? 'text-red-500' : 'text-foreground'}`}>{fmt(spent, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Remaining</p>
            <p className={`text-sm font-medium ${remaining < 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(remaining, currency)}</p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border divide-y divide-border">
          {items.map((li) => (
            <LineItemRow key={li.id} item={li} currency={currency} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Line item row ────────────────────────────────────────────────────────────

function LineItemRow({ item, currency }: { item: BudgetLineItem; currency: string }) {
  const budgeted  = Number(item.budgetedAmount);
  const spent     = Number(item.actualSpend);
  const committed = Number(item.committedAmount);
  const remaining = budgeted - spent;
  const variance  = budgeted - spent;

  return (
    <div className="px-4 py-3 bg-muted/20 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground">{item.description}</p>
        {spent > budgeted && (
          <span className="flex items-center gap-1 text-xs text-red-600 font-medium flex-shrink-0">
            <AlertTriangle className="h-3.5 w-3.5" /> Overspend
          </span>
        )}
      </div>
      {item.quantity && (
        <p className="text-xs text-muted-foreground">
          Qty: {item.quantity} {item.unit ?? ''} {item.unitRate ? `@ ${fmt(item.unitRate, currency)}` : ''}
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <span className="text-muted-foreground">Budgeted: <span className="text-foreground font-medium">{fmt(budgeted, currency)}</span></span>
        <span className="text-muted-foreground">Committed: <span className="text-foreground font-medium">{fmt(committed, currency)}</span></span>
        <span className="text-muted-foreground">Spent: <span className={`font-medium ${spent > budgeted ? 'text-red-500' : 'text-foreground'}`}>{fmt(spent, currency)}</span></span>
        <span className="text-muted-foreground">Remaining: <span className={`font-medium ${remaining < 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(remaining, currency)}</span></span>
      </div>

      {/* Consultant sub-entry */}
      {item.consultantCostEntry && (
        <div className="rounded-lg bg-blue-500/8 border border-blue-500/20 p-2.5 space-y-1">
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Consultant Details</p>
          <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground sm:grid-cols-3">
            <span>Type: <span className="text-foreground capitalize">{item.consultantCostEntry.consultantType.replace('_', ' ')}</span></span>
            <span>Name: <span className="text-foreground">{item.consultantCostEntry.consultantName}</span></span>
            {item.consultantCostEntry.firmName && <span>Firm: <span className="text-foreground">{item.consultantCostEntry.firmName}</span></span>}
            <span>Agreed: <span className="text-foreground font-medium">{fmt(item.consultantCostEntry.feeAgreed, item.consultantCostEntry.currency)}</span></span>
            <span>Paid: <span className="text-foreground font-medium">{fmt(item.consultantCostEntry.feePaid, item.consultantCostEntry.currency)}</span></span>
            <span>Outstanding: <span className={`font-medium ${Number(item.consultantCostEntry.feeOutstanding) > 0 ? 'text-amber-600' : 'text-foreground'}`}>{fmt(item.consultantCostEntry.feeOutstanding, item.consultantCostEntry.currency)}</span></span>
          </div>
        </div>
      )}

      {/* Marketing sub-entry */}
      {item.marketingBudgetEntry && (
        <div className="rounded-lg bg-purple-500/8 border border-purple-500/20 p-2.5 space-y-1">
          <p className="text-xs font-semibold text-purple-700 dark:text-purple-400">Marketing Details</p>
          <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground sm:grid-cols-3">
            <span>Campaign: <span className="text-foreground">{item.marketingBudgetEntry.campaignName}</span></span>
            <span>Channel: <span className="text-foreground capitalize">{item.marketingBudgetEntry.channel}</span></span>
            {item.marketingBudgetEntry.vendorAgency && <span>Agency: <span className="text-foreground">{item.marketingBudgetEntry.vendorAgency}</span></span>}
            <span>Budgeted: <span className="text-foreground font-medium">{fmt(item.marketingBudgetEntry.budgetedAmount, currency)}</span></span>
            <span>Actual: <span className="text-foreground font-medium">{fmt(item.marketingBudgetEntry.actualSpend, currency)}</span></span>
            <span>Paid: <span className="text-foreground font-medium">{fmt(item.marketingBudgetEntry.paidAmount, currency)}</span></span>
            {item.marketingBudgetEntry.expectedRoi && (
              <span className="col-span-2 sm:col-span-3">Expected ROI: <span className="text-foreground">{item.marketingBudgetEntry.expectedRoi}</span></span>
            )}
          </div>
        </div>
      )}

      {item.notes && (
        <p className="text-xs text-muted-foreground italic">{item.notes}</p>
      )}
    </div>
  );
}

// ─── Variation row ────────────────────────────────────────────────────────────

const VAR_STATUS_VARIANT: Record<string, 'active' | 'pending' | 'inactive'> = {
  approved: 'active', pending: 'pending', rejected: 'inactive',
};

function VariationRow({ variation, currency }: { variation: VariationOrder; currency: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-0">
      <div className={`flex-shrink-0 mt-0.5 ${variation.direction === 'addition' ? 'text-emerald-600' : 'text-red-500'}`}>
        {variation.direction === 'addition' ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-muted-foreground">{variation.referenceNumber}</span>
          <Badge variant={VAR_STATUS_VARIANT[variation.status] ?? 'default'} className="text-xs">
            {variation.status}
          </Badge>
        </div>
        <p className="text-sm text-foreground mt-0.5">{variation.description}</p>
        {variation.approvedAt && (
          <p className="text-xs text-muted-foreground mt-0.5">Approved {new Date(variation.approvedAt).toLocaleDateString()}</p>
        )}
      </div>
      <p className={`text-sm font-semibold flex-shrink-0 ${variation.direction === 'addition' ? 'text-emerald-600' : 'text-red-500'}`}>
        {variation.direction === 'omission' ? '-' : '+'}{fmt(variation.amount, currency)}
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BudgetDetailPage() {
  const { budgetId } = useParams<{ budgetId: string }>();
  const router        = useRouter();
  const { user }      = useAuthStore();

  const [budget,   setBudget]   = useState<Budget | null>(null);
  const [summary,  setSummary]  = useState<BudgetSummary | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [approving, setApproving] = useState(false);
  const [locking,  setLocking]  = useState(false);

  const canFinance = user?.role === 'company_admin' || user?.role === 'finance_officer';
  const canManage  = canFinance || user?.role === 'project_manager';

  function load() {
    setLoading(true);
    budgetApi.get(budgetId)
      .then((r) => { setBudget(r.budget); setSummary(r.summary); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load budget'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [budgetId]);

  async function handleApprove() {
    if (!budget) return;
    setApproving(true);
    try {
      const { budget: updated } = await budgetApi.approve(budgetId);
      setBudget(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to approve');
    } finally { setApproving(false); }
  }

  async function handleLock() {
    if (!budget) return;
    setLocking(true);
    try {
      const { budget: updated } = await budgetApi.lock(budgetId);
      setBudget(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to lock');
    } finally { setLocking(false); }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6">
        <Skeleton className="h-12 w-96 rounded-xl" />
        <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
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

  if (!budget || !summary) return null;

  // Group line items by category
  const byCategory = budget.lineItems.reduce<Record<string, BudgetLineItem[]>>((acc, li) => {
    if (!acc[li.category]) acc[li.category] = [];
    acc[li.category].push(li);
    return acc;
  }, {});

  const overspend = summary.overspend;

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title={budget.name}
        subtitle={`${budget.project.name}${budget.project.code ? ` · ${budget.project.code}` : ''} · ${budget.currency}`}
        action={
          canManage ? (
            <div className="flex items-center gap-2">
              {canFinance && budget.status === 'draft' && (
                <Button variant="outline" onClick={handleApprove} disabled={approving}>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  {approving ? 'Approving…' : 'Approve'}
                </Button>
              )}
              {canFinance && budget.status === 'approved' && (
                <Button variant="outline" onClick={handleLock} disabled={locking}>
                  <Lock className="h-4 w-4 mr-1" />
                  {locking ? 'Locking…' : 'Lock Budget'}
                </Button>
              )}
              {budget.status !== 'locked' && (
                <Link href={`/budget/${budgetId}/edit`}>
                  <Button variant="outline"><Edit2 className="h-4 w-4 mr-1" /> Edit</Button>
                </Link>
              )}
            </div>
          ) : undefined
        }
      />

      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Budgets
      </button>

      {/* Status badge + approval info */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant={STATUS_VARIANT[budget.status] ?? 'default'} className="text-sm px-3 py-1">
          {budget.status === 'approved' && <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
          {budget.status === 'locked'   && <Lock          className="h-3.5 w-3.5 mr-1" />}
          {budget.status.charAt(0).toUpperCase() + budget.status.slice(1)}
        </Badge>
        {budget.approvedBy && (
          <span className="text-xs text-muted-foreground">
            Approved by {budget.approvedBy.firstName} {budget.approvedBy.lastName}
            {budget.approvedAt ? ` on ${new Date(budget.approvedAt).toLocaleDateString()}` : ''}
          </span>
        )}
        {budget.createdBy && (
          <span className="text-xs text-muted-foreground">
            Created by {budget.createdBy.firstName} {budget.createdBy.lastName}
          </span>
        )}
      </div>

      {/* Overspend alert */}
      {overspend && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Overspend detected.</strong> Actual spend ({budget.currency} {summary.totalSpent.toLocaleString()}) exceeds budget ({budget.currency} {summary.totalBudgeted.toLocaleString()}) by {budget.currency} {Math.abs(summary.variance).toLocaleString()}.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total Budgeted"
          value={fmt(summary.totalBudgeted, budget.currency)}
          icon={<PieChart className="h-5 w-5" />}
        />
        <StatCard
          label="Committed"
          value={fmt(summary.totalCommitted, budget.currency)}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          label="Actual Spend"
          value={fmt(summary.totalSpent, budget.currency)}
          icon={<TrendingDown className="h-5 w-5" />}
          valueClassName={overspend ? 'text-red-500' : undefined}
        />
        <StatCard
          label="Remaining"
          value={fmt(summary.totalRemaining, budget.currency)}
          icon={<TrendingUp className="h-5 w-5" />}
          valueClassName={summary.totalRemaining < 0 ? 'text-red-500' : 'text-emerald-600'}
        />
      </div>

      {/* Adjusted budget (if variations exist) */}
      {budget.variationOrders.some((v) => v.status === 'approved') && (
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
          <RefreshCw className="h-5 w-5 text-primary flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Adjusted Budget (incl. approved variations)</p>
            <p className="text-lg font-bold text-brand-light">{fmt(summary.adjustedBudget, budget.currency)}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">Variation impact</p>
            <p className={`text-sm font-semibold ${summary.variationImpact >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {summary.variationImpact >= 0 ? '+' : ''}{fmt(summary.variationImpact, budget.currency)}
            </p>
          </div>
        </div>
      )}

      {/* Category breakdown */}
      <div className="space-y-3">
        <h2 className="font-semibold text-foreground">Budget by Category</h2>
        {budget.lineItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <PieChart className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No line items yet.</p>
            {canManage && budget.status !== 'locked' && (
              <Link href={`/budget/${budgetId}/edit`}>
                <Button className="mt-3" variant="outline">Add Line Items</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {(Object.keys(byCategory) as BudgetCategory[]).map((cat) => (
              <CategoryRow
                key={cat}
                category={cat}
                items={byCategory[cat]}
                currency={budget.currency}
              />
            ))}
          </div>
        )}
      </div>

      {/* Variation orders */}
      {budget.variationOrders.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-foreground">Variation Orders</h2>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {budget.variationOrders.map((v) => (
              <VariationRow key={v.id} variation={v} currency={budget.currency} />
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {budget.notes && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
          <p className="text-sm text-foreground">{budget.notes}</p>
        </div>
      )}
    </div>
  );
}
