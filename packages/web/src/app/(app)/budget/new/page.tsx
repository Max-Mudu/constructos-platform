'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { budgetApi, projectApi, ApiError } from '@/lib/api';
import { Project } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle, ArrowLeft } from 'lucide-react';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ZAR', 'AED', 'NGN', 'KES', 'GHS'];

export default function NewBudgetPage() {
  const router    = useRouter();
  const { user }  = useAuthStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState({
    projectId: '',
    name:      '',
    currency:  'USD',
    notes:     '',
  });
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const canCreate = user?.role === 'company_admin' || user?.role === 'finance_officer' || user?.role === 'project_manager';

  useEffect(() => {
    projectApi.list()
      .then((r) => setProjects(r.projects ?? r))
      .catch(() => {})
      .finally(() => setLoadingProjects(false));
  }, []);

  if (!canCreate) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive"><AlertDescription>You do not have permission to create budgets.</AlertDescription></Alert>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.projectId) { setError('Please select a project'); return; }
    if (!form.name.trim()) { setError('Budget name is required'); return; }
    setError('');
    setLoading(true);
    try {
      const { budget } = await budgetApi.create({
        projectId: form.projectId,
        name:      form.name.trim(),
        currency:  form.currency,
        notes:     form.notes.trim() || undefined,
      });
      router.push(`/budget/${budget.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create budget');
      setLoading(false);
    }
  }

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader title="New Budget" subtitle="Create a project budget to track costs" />

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

      <form onSubmit={handleSubmit} className="max-w-xl space-y-5 rounded-xl border border-border bg-card p-6">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Project *</label>
          {loadingProjects ? (
            <p className="text-sm text-muted-foreground">Loading projects…</p>
          ) : (
            <Select
              value={form.projectId}
              onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
              required
            >
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>
              ))}
            </Select>
          )}
          <p className="text-xs text-muted-foreground">Only one budget per project is allowed.</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Budget Name *</label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Phase 1 Budget 2026"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Currency</label>
          <Select
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
          >
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Optional internal notes…"
            rows={3}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create Budget'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
