'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';
import {
  selectableStatuses, type ProjectFormValues, type ProjectStatus,
} from '@/lib/projects-admin-api';

/** Fields the form shows inline errors for (everything else goes in the banner). */
export const PROJECT_INLINE_FIELDS = ['name', 'code', 'description', 'location', 'startDate', 'endDate', 'status'] as const;

export function ProjectForm({
  values, onChange, onSubmit, fieldErrors, error, submitting, submitLabel, submittingLabel,
  cancelHref, currentStatus,
}: {
  values:          ProjectFormValues;
  onChange:        (next: ProjectFormValues) => void;
  onSubmit:        () => void;
  fieldErrors:     Record<string, string[]>;
  error:           string;
  submitting:      boolean;
  submitLabel:     string;
  submittingLabel: string;
  cancelHref:      string;
  /** The saved status, so an archived project still shows "Archived". */
  currentStatus?:  ProjectStatus;
}) {
  const set = <K extends keyof ProjectFormValues>(k: K, v: ProjectFormValues[K]) => onChange({ ...values, [k]: v });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className="space-y-6"
      noValidate
    >
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="Project Name"
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              required
              maxLength={255}
              placeholder="e.g. Westlands Office Block"
              error={fieldErrors.name?.[0]}
            />
          </div>

          <Input
            label="Project Code"
            value={values.code}
            onChange={(e) => set('code', e.target.value)}
            maxLength={50}
            placeholder="e.g. PRJ-001"
            error={fieldErrors.code?.[0]}
          />

          <Select
            label="Status"
            value={values.status}
            onChange={(e) => set('status', e.target.value as ProjectStatus)}
            error={fieldErrors.status?.[0]}
          >
            {selectableStatuses(currentStatus).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>

          <div className="sm:col-span-2">
            <Input
              label="Location"
              value={values.location}
              onChange={(e) => set('location', e.target.value)}
              maxLength={255}
              placeholder="e.g. Westlands, Nairobi"
              error={fieldErrors.location?.[0]}
            />
          </div>

          <Input
            label="Start Date"
            type="date"
            value={values.startDate}
            onChange={(e) => set('startDate', e.target.value)}
            error={fieldErrors.startDate?.[0]}
          />

          <Input
            label="End Date"
            type="date"
            value={values.endDate}
            onChange={(e) => set('endDate', e.target.value)}
            error={fieldErrors.endDate?.[0]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Description</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <textarea
            aria-label="Description"
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            placeholder="Optional project description…"
            className={cn(
              'flex w-full rounded-lg border border-border bg-navy-base px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground',
              'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50 resize-none',
            )}
          />
          {fieldErrors.description?.[0] && <p className="text-xs text-red-400">{fieldErrors.description[0]}</p>}
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-end">
        <Link href={cancelHref}>
          <Button type="button" variant="outline">Cancel</Button>
        </Link>
        <Button type="submit" disabled={submitting}>
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Shown in place of a form when the signed-in role cannot use it. */
export function NotAllowed({ message, backHref, backLabel }: { message: string; backHref: string; backLabel: string }) {
  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Link href={backHref}>
        <Button variant="outline" size="sm">{backLabel}</Button>
      </Link>
    </div>
  );
}
