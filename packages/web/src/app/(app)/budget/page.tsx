'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { budgetApi, ApiError } from '@/lib/api';
import { BudgetListItem, BudgetCategory } from '@/lib/types';
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
  PieChart, Plus, AlertCircle, CheckCircle2, Lock,
  FileText, TrendingUp, TrendingDown, AlertTriangle,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft:    'Draft',
  approved: 'Approved',
  locked:   'Locked',
};
const STATUS_VARIANT: Record<string, 'pending' | 'active' | 'inactive' | 'warning'> = {
  draft:    'pending',
  approved: 'active',
  locked:   'inactive',
};

const CATEGORY_LABELS: Record<BudgetCategory, string> = {
  labour:            'Labour',
  materials:         'Materials',
  equipment:         'Equipment',
  subcontractors:    'Subcontractors',
  consultants:       'Consultants',
  marketing:         'Marketing',
  overheads:         'Overheads',
  permits_statutory: 'Permits / Statutory',
  variations:        'Variations',
  contingency:       'Contingency',
};

function fmt(val: string | number, currency = 'USD') {
  return Number(val).toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
}

function sumBy(items: BudgetListItem['lineItems'], key: 'budgetedAmount' | 'committedAmount' | 'actualSpend') {
  return items.reduce((s, li) => s + Number(li[key]), 0);
}

// ─── Budget card ──────────────────────────────────────────────────────────────

function BudgetCard({ budget }: { budget: BudgetListItem }) {
  const totalBudgeted = sumBy(budget.lineItems, 'budgetedAmount');
  const totalSpent    = sumBy(budget.lineItems, 'actualSpend');
  const remaining     = totalBudgeted - totalSpent;
  const overspend     = totalSpent > totalBudgeted;
  const pct           = totalBudgeted > 0 ? Math.min((totalSpent / totalBudgeted) * 100, 100) : 0;

  return (
    <Link
      href={`/budget/${budget.id}`}
      className="block rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-semibold text-foreground truncate">{budget.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{budget.project.name}{budget.project.code ? ` · ${budget.project.code}` : ''}</p>
        </div>
        <Badge variant={STATUS_VARIANT[budget.status] ?? 'default'}>
          {budget.status === 'locked' && <Lock className="h-3 w-3 mr-1" />}
          {budget.status === 'approved' && <CheckCircle2 className="h-3 w-3 mr-1" />}
          {STATUS_LABEL[budget.status]}
        </Badge>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Spend</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${overspend ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Budgeted</p>
          <p className="text-sm font-semibold text-foreground">{fmt(totalBudgeted, budget.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Spent</p>
          <p className={`text-sm font-semibold ${overspend ? 'text-red-500' : 'text-foreground'}`}>
            {fmt(totalSpent, budget.currency)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Remaining</p>
          <p className={`text-sm font-semibold ${remaining < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
            {fmt(remaining, budget.currency)}
          </p>
        </div>
      </div>

      {overspend && (
        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-600">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          Overspend detected
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {budget.lineItems.length} line item{budget.lineItems.length !== 1 ? 's' : ''} · {budget.currency}
      </p>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BudgetPage() {
  const { user } = useAuthStore();
  const [budgets, setBudgets] = useState<BudgetListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const canManage = user?.role === 'company_admin' || user?.role === 'finance_officer' || user?.role === 'project_manager';

  useEffect(() => {
    budgetApi.list({ status: statusFilter || undefined })
      .then((r) => setBudgets(r.budgets))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load budgets'))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!search) return budgets;
    const q = search.toLowerCase();
    return budgets.filter(
      (b) => b.name.toLowerCase().includes(q) || b.project.name.toLowerCase().includes(q),
    );
  }, [budgets, search]);

  // Global KPIs
  const totalBudgeted  = budgets.reduce((s, b) => s + sumBy(b.lineItems, 'budgetedAmount'), 0);
  const totalSpent     = budgets.reduce((s, b) => s + sumBy(b.lineItems, 'actualSpend'),    0);
  const totalRemaining = totalBudgeted - totalSpent;
  const overspendCount = budgets.filter((b) => sumBy(b.lineItems, 'actualSpend') > sumBy(b.lineItems, 'budgetedAmount')).length;

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6">
        <Skeleton className="h-12 w-80 rounded-xl" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
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
        title="Budget"
        subtitle="Project budgets, cost tracking, and overspend alerts"
        action={
          canManage ? (
            <Link href="/budget/new">
              <Button><Plus className="h-4 w-4 mr-1" /> New Budget</Button>
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
      {budgets.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Total Budgeted"
            value={`$${(totalBudgeted / 1_000_000).toFixed(1)}M`}
            icon={<PieChart className="h-5 w-5" />}
          />
          <StatCard
            label="Total Spent"
            value={`$${(totalSpent / 1_000_000).toFixed(1)}M`}
            icon={<TrendingDown className="h-5 w-5" />}
            valueClassName={totalSpent > totalBudgeted ? 'text-red-500' : undefined}
          />
          <StatCard
            label="Remaining"
            value={`$${(totalRemaining / 1_000_000).toFixed(1)}M`}
            icon={<TrendingUp className="h-5 w-5" />}
            valueClassName={totalRemaining < 0 ? 'text-red-500' : 'text-emerald-600'}
          />
          <StatCard
            label="Overspend Alerts"
            value={overspendCount}
            icon={<AlertTriangle className="h-5 w-5" />}
            valueClassName={overspendCount > 0 ? 'text-red-500' : undefined}
          />
        </div>
      )}

      {/* Filters */}
      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search budgets or projects…"
        filters={[
          {
            label: 'Status',
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: '',         label: 'All statuses' },
              { value: 'draft',    label: 'Draft' },
              { value: 'approved', label: 'Approved' },
              { value: 'locked',   label: 'Locked' },
            ],
          },
        ]}
      />

      {/* Budget grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<PieChart className="h-12 w-12" />}
          title="No budgets found"
          description={canManage ? 'Create a budget to start tracking project costs.' : 'No budgets have been created yet.'}
          action={canManage ? { label: 'New Budget', href: '/budget/new' } : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((b) => (
            <BudgetCard key={b.id} budget={b} />
          ))}
        </div>
      )}
    </div>
  );
}
