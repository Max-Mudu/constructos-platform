'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError, inventoryApi } from '@/lib/api';
import type {
  InventoryAdjustmentDirection,
  InventoryAdjustmentReason,
  SiteInventoryItem,
} from '@/lib/types';
import { formatQuantity } from '@/components/projects/format-quantity';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

/**
 * Roles the API lets adjust stock (inventory.routes.ts ADJUST_ROLES).
 * Narrower than usage: site supervisors record usage but do not adjust.
 */
export const INVENTORY_ADJUST_ROLES = ['company_admin', 'project_manager'] as const;

export function canAdjustStock(role: string | undefined | null): boolean {
  return !!role && (INVENTORY_ADJUST_ROLES as readonly string[]).includes(role);
}

export const ADJUSTMENT_REASON_LABELS: Record<InventoryAdjustmentReason, string> = {
  stock_count_correction: 'Stock count correction',
  damaged:                'Damaged',
  lost_or_stolen:         'Lost or stolen',
  returned_to_supplier:   'Returned to supplier',
  found:                  'Found',
  data_entry_error:       'Data entry error',
  other:                  'Other',
};

/** Human label for a stored adjustment reason; unknown values are shown as-is. */
export function adjustmentReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (ADJUSTMENT_REASON_LABELS as Record<string, string>)[reason] ?? reason;
}

/** Wording for a failed adjustment; the API's own message wins when it has one. */
export function adjustErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You do not have permission to adjust stock on this site.';
    if (err.status === 404) return 'This inventory item no longer exists. Refresh the list.';
    if (err.status === 0 || err.status === 408) return 'Could not reach the server. Check your connection and try again.';
    return err.message || 'The adjustment could not be saved.';
  }
  return 'The adjustment could not be saved.';
}

export interface AdjustStockDialogProps {
  projectId: string;
  siteId:    string;
  item:      SiteInventoryItem;
  onClose:   () => void;
  /** Called with the stock quantity the API returned after the adjustment. */
  onDone:    (result: { currentQuantity: string; isLowStock: boolean }) => void;
}

/**
 * Corrects the book stock up or down with a reason. The API refuses an
 * adjustment out larger than the current stock; the form checks the same up
 * front, and requires a note when the reason is "Other".
 */
export function AdjustStockDialog({ projectId, siteId, item, onClose, onDone }: AdjustStockDialogProps) {
  const [direction, setDirection] = useState<InventoryAdjustmentDirection>('out');
  const [quantity, setQuantity]   = useState('');
  const [reason, setReason]       = useState<InventoryAdjustmentReason | ''>('');
  const [note, setNote]           = useState('');
  const [errors, setErrors]       = useState<{ quantity?: string; reason?: string; note?: string }>({});
  const [error, setError]         = useState('');
  const [busy, setBusy]           = useState(false);
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
    const next: typeof errors = {};
    const qty = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(qty) || qty <= 0) {
      next.quantity = 'Enter a quantity greater than 0.';
    } else if (direction === 'out' && Number.isFinite(available) && qty > available) {
      next.quantity = `Only ${formatQuantity(available)} ${item.unitOfMeasure} in stock.`;
    }
    if (!reason) next.reason = 'Choose a reason.';
    if (reason === 'other' && !note.trim()) next.note = 'Add a note explaining the adjustment.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !reason) return;

    setError('');
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await inventoryApi.adjust(projectId, siteId, item.id, {
        direction,
        quantity: qty,
        reason,
        ...(note.trim() && { note: note.trim() }),
      });
      busyRef.current = false;
      onDone({ currentQuantity: res.item.currentQuantity, isLowStock: res.item.isLowStock });
    } catch (err) {
      setError(adjustErrorMessage(err));
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
        aria-labelledby="adjust-title"
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:rounded-2xl"
      >
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          <div>
            <h2 id="adjust-title" className="text-lg font-semibold text-foreground">
              Adjust stock: {item.materialName}
            </h2>
            <p className="text-sm text-muted-foreground">
              In stock: {formatQuantity(available)} {item.unitOfMeasure}
            </p>
          </div>

          <Select
            id="adjust-direction"
            label="Direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as InventoryAdjustmentDirection)}
            data-autofocus
          >
            <option value="out">Decrease stock (out)</option>
            <option value="in">Increase stock (in)</option>
          </Select>
          <Input
            id="adjust-quantity"
            label={`Quantity (${item.unitOfMeasure})`}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={errors.quantity}
            required
          />
          <Select
            id="adjust-reason"
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as InventoryAdjustmentReason | '')}
            error={errors.reason}
            required
          >
            <option value="">Choose a reason…</option>
            {(Object.keys(ADJUSTMENT_REASON_LABELS) as InventoryAdjustmentReason[]).map((r) => (
              <option key={r} value={r}>{ADJUSTMENT_REASON_LABELS[r]}</option>
            ))}
          </Select>
          <Input
            id="adjust-note"
            label={reason === 'other' ? 'Note (required)' : 'Note'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={errors.note}
            maxLength={1000}
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
              {busy ? 'Saving…' : 'Save adjustment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
