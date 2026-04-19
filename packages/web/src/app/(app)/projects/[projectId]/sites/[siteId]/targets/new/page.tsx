'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { targetsApi, workerApi, ApiError } from '@/lib/api';
import { Worker } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, AlertCircle } from 'lucide-react';

function today(): string {
  return new Date().toISOString().split('T')[0];
}

export default function NewTargetPage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();
  const router = useRouter();

  const [workers,      setWorkers]      = useState<Worker[]>([]);
  const [date,         setDate]         = useState(today());
  const [description,  setDescription]  = useState('');
  const [targetValue,  setTargetValue]  = useState('');
  const [targetUnit,   setTargetUnit]   = useState('');
  const [actualValue,  setActualValue]  = useState('');
  const [workerId,     setWorkerId]     = useState('');
  const [notes,        setNotes]        = useState('');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  useEffect(() => {
    if (!projectId || !siteId) return;
    workerApi.listSiteWorkers(projectId, siteId)
      .then((d) => setWorkers(d.workers))
      .catch(() => {});
  }, [projectId, siteId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description || !targetValue || !targetUnit) {
      setError('Description, target value, and unit are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await targetsApi.create(projectId, siteId, {
        date,
        description,
        targetValue:  parseFloat(targetValue),
        targetUnit,
        ...(actualValue && { actualValue: parseFloat(actualValue) }),
        ...(workerId    && { workerId }),
        ...(notes       && { notes }),
      });
      router.push(`/projects/${projectId}/sites/${siteId}/targets`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create target');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-lg">
      <div>
        <Link
          href={`/projects/${projectId}/sites/${siteId}/targets`}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Targets
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Add Daily Target</h1>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Target Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Date */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Date *</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Description *</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Pour concrete slab — Level 3"
                required
              />
            </div>

            {/* Target value + unit */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Target Quantity *</label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  placeholder="50"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Unit *</label>
                <Input
                  value={targetUnit}
                  onChange={(e) => setTargetUnit(e.target.value)}
                  placeholder="m³, bags, units…"
                  required
                />
              </div>
            </div>

            {/* Actual value */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Actual Quantity Achieved</label>
              <Input
                type="number"
                min="0"
                step="any"
                value={actualValue}
                onChange={(e) => setActualValue(e.target.value)}
                placeholder="Leave blank if not yet achieved"
              />
            </div>

            {/* Worker (optional) */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Assign to Worker (optional)</label>
              <select
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Site-wide target (no specific worker)</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.firstName} {w.lastName}{w.trade ? ` — ${w.trade}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Optional comments…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save Target'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/projects/${projectId}/sites/${siteId}/targets`)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
