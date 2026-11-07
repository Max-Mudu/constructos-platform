'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError, inventoryApi } from '@/lib/api';
import type { SiteInventoryItem } from '@/lib/types';
import { formatQuantity } from '@/components/projects/format-quantity';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/** Roles the API lets record inventory usage (inventory.routes.ts WRITE_ROLES). */
export const INVENTORY_WRITE_ROLES = ['company_admin', 'project_manager', 'site_supervisor'] as const;

export function canRecordUsage(role: string | undefined | null): boolean {
  return !!role && (INVENTORY_WRITE_ROLES as readonly string[]).includes(role);
}

/** Wording for a failed usage save; the API's own message wins when it has one. */
export function usageErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You do not have permission to record usage on this site.';
    if (err.status === 404) return 'This inventory item no longer exists. Refresh the list.';
    if (err.status === 0 || err.status === 408) return 'Could not reach the server. Check your connection and try again.';
    return err.message || 'The usage could not be recorded.';
  }
  return 'The usage could not be recorded.';
}

export interface RecordUsageDialogProps {
  projectId: string;
  siteId:    string;
  item:      SiteInventoryItem;
  onClose:   () => void;
  onDone:    () => void;
}

/**
 * Records stock issued or used on site. The API deducts the quantity and
 * refuses more than the current stock; the form checks the same up front.
 */
export function RecordUsageDialog({ projectId, siteId, item, onClose, onDone }: RecordUsageDialogProps) {
  const [quantity, setQuantity]       = useState('');
  const [usageReason, setUsageReason] = useState('');
  const [workArea, setWorkArea]       = useState('');
  const [note, setNote]               = useState('');
  const [fieldError, setFieldError]   = useState('');
  const [error, setError]             = useState('');
  const [busy, setBusy]               = useState(false);
  const ref     = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const available = Number(item.currentQuantity);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busyRef.current) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const qty = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(qty) || qty <= 0) {
      setFieldError('Enter a quantity greater than 0.');
      return;
    }
    if (Number.isFinite(available) && qty > available) {
      setFieldError(`Only ${formatQuantity(available)} ${item.unitOfMeasure} in stock.`);
      return;
    }
    setFieldError('');
    setError('');
    busyRef.current = true;
    setBusy(true);
    try {
      await inventoryApi.recordUsage(projectId, siteId, item.id, {
        quantity: qty,
        ...(usageReason.trim() && { usageReason: usageReason.trim() }),
        ...(workArea.trim()    && { workArea:    workArea.trim() }),
        ...(note.trim()        && { note:        note.trim() }),
      });
      busyRef.current = false;
      onDone();
    } catch (err) {
      setError(usageErrorMessage(err));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div
        className="absolute inset-0 bg-[#121826]/50"
        aria-hidden
        onClick={() => { if (!busyRef.current) onClose(); }}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-title"
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:rounded-2xl"
      >
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          <div>
            <h2 id="usage-title" className="text-lg font-semibold text-foreground">
              Record usage: {item.materialName}
            </h2>
            <p className="text-sm text-muted-foreground">
              In stock: {formatQuantity(available)} {item.unitOfMeasure}
            </p>
          </div>

          <Input
            id="usage-quantity"
            label={`Quantity used (${item.unitOfMeasure})`}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={fieldError}
            data-autofocus
            required
          />
          <Input
            id="usage-reason"
            label="Reason"
            placeholder="e.g. Slab pour"
            value={usageReason}
            onChange={(e) => setUsageReason(e.target.value)}
          />
          <Input
            id="usage-work-area"
            label="Work area"
            placeholder="e.g. Block B, level 2"
            value={workArea}
            onChange={(e) => setWorkArea(e.target.value)}
          />
          <Input
            id="usage-note"
            label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {busy ? 'Saving…' : 'Record usage'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
