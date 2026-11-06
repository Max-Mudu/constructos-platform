'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import type { SiteFormValues } from '@/lib/projects-admin-api';

export const SITE_INLINE_FIELDS = ['name', 'address', 'latitude', 'longitude', 'isActive'] as const;

export function SiteForm({
  values, onChange, onSubmit, fieldErrors, error, submitting, submitLabel, submittingLabel,
  cancelHref, showActive,
}: {
  values:          SiteFormValues;
  onChange:        (next: SiteFormValues) => void;
  onSubmit:        () => void;
  fieldErrors:     Record<string, string[]>;
  error:           string;
  submitting:      boolean;
  submitLabel:     string;
  submittingLabel: string;
  cancelHref:      string;
  /** Edit form only: the Active switch (PATCH isActive). */
  showActive?:     boolean;
}) {
  const set = <K extends keyof SiteFormValues>(k: K, v: SiteFormValues[K]) => onChange({ ...values, [k]: v });

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="space-y-6" noValidate>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Site Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Site Name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            required
            maxLength={255}
            placeholder="e.g. Block A Foundation"
            error={fieldErrors.name?.[0]}
          />
          <Input
            label="Address"
            value={values.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="e.g. Westlands, Nairobi"
            error={fieldErrors.address?.[0]}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Latitude"
              inputMode="decimal"
              value={values.latitude}
              onChange={(e) => set('latitude', e.target.value)}
              placeholder="e.g. -1.2683"
              hint="Optional"
              error={fieldErrors.latitude?.[0]}
            />
            <Input
              label="Longitude"
              inputMode="decimal"
              value={values.longitude}
              onChange={(e) => set('longitude', e.target.value)}
              placeholder="e.g. 36.8111"
              hint="Optional"
              error={fieldErrors.longitude?.[0]}
            />
          </div>
          {showActive && (
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(e) => set('isActive', e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Site is active
              </label>
              <p className="text-xs text-muted-foreground">
                An inactive site keeps its records but is no longer offered for daily work.
              </p>
              {fieldErrors.isActive?.[0] && <p className="text-xs text-red-400">{fieldErrors.isActive[0]}</p>}
            </div>
          )}
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
