'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError, inventoryApi } from '@/lib/api';
import type { SiteInventoryItem } from '@/lib/types';
import { formatQuantity } from '@/components/projects/format-quantity';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Roles the API lets change an item's low-stock level
 * (inventory.routes.ts WRITE_ROLES on PATCH /inventory/:inventoryId).
 */
export const LOW_STOCK_LEVEL_ROLES = ['company_admin', 'project_manager', 'site_supervisor'] as const;

export function canSetLowStockLevel(role: string | undefined | null): boolean {
  return !!role && (LOW_STOCK_LEVEL_ROLES as readonly string[]).includes(role);
}

/** The stock columns are Decimal(12,3). */
const MAX_LEVEL = 999_999_999;
const threeDecimals = (n: number) => Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6;

/** Wording for a failed save; the API's own message wins when it has one. */
export function lowStockLevelErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You do not have permission to change the low-stock level on this site.';
    if (err.status === 404) return 'This inventory item no longer exists. Refresh the list.';
    if (err.status === 0 || err.status === 408) return 'Could not reach the server. Check your connection and try again.';
    return err.message || 'The low-stock level could not be saved.';
  }
  return 'The low-stock level could not be saved.';
}

export interface LowStockLevelDialogProps {
  projectId: string;
  siteId:    string;
  item:      SiteInventoryItem;
  onClose:   () => void;
  /** Called with the level the API stored (null when the alert was removed). */
  onDone:    (result: { lowStockThreshold: string | null; isLowStock: boolean }) => void;
}

/**
 * Sets, changes or removes the quantity at which an item counts as low stock.
 * The item is flagged when its stock is at or below this level.
 */
export function LowStockLevelDialog({ projectId, siteId, item, onClose, onDone }: LowStockLevelDialogProps) {
  const hasLevel = item.lowStockThreshold !== null;
  const [level, setLevel]           = useState(hasLevel ? String(Number(item.lowStockThreshold)) : '');
  const [levelError, setLevelError] = useState('');
  const [error, setError]           = useState('');
  const [busy, setBusy]             = useState<'save' | 'remove' | null>(null);
  const ref     = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

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

  async function send(value: number | null) {
    setError('');
    busyRef.current = true;
    setBusy(value === null ? 'remove' : 'save');
    try {
      const res = await inventoryApi.setLowStockLevel(projectId, siteId, item.id, value);
      busyRef.current = false;
      onDone({ lowStockThreshold: res.item.lowStockThreshold, isLowStock: res.item.isLowStock });
    } catch (err) {
      setError(lowStockLevelErrorMessage(err));
      busyRef.current = false;
      setBusy(null);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const n = Number(level);
    let msg = '';
    if (!level.trim() || !Number.isFinite(n) || n < 0) msg = 'Enter a level of 0 or more.';
    else if (n > MAX_LEVEL) msg = 'The level is too large.';
    else if (!threeDecimals(n)) msg = 'Use at most 3 decimal places.';
    setLevelError(msg);
    if (msg) return;
    void send(n);
  }

  function remove() {
    if (busyRef.current) return;
    setLevelError('');
    void send(null);
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
        aria-labelledby="low-stock-level-title"
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:rounded-2xl"
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <h2 id="low-stock-level-title" className="text-lg font-semibold text-foreground">
              Low-stock level: {item.materialName}
            </h2>
            <p className="text-sm text-muted-foreground">
              In stock: {formatQuantity(Number(item.currentQuantity))} {item.unitOfMeasure}.{' '}
              {hasLevel
                ? `Current level: ${formatQuantity(Number(item.lowStockThreshold))} ${item.unitOfMeasure}.`
                : 'No level is set, so this item is never flagged as low.'}
            </p>
          </div>

          <Input
            id="low-stock-level"
            label={`Low-stock level (${item.unitOfMeasure})`}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            error={levelError}
            hint="The item is flagged as low stock when its quantity is at or below this level."
            data-autofocus
          />

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy !== null}>Cancel</Button>
            {hasLevel && (
              <Button
                type="button"
                variant="outline"
                onClick={remove}
                loading={busy === 'remove'}
                disabled={busy !== null}
              >
                {busy === 'remove' ? 'Removing…' : 'Remove level'}
              </Button>
            )}
            <Button type="submit" loading={busy === 'save'} disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save level'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
