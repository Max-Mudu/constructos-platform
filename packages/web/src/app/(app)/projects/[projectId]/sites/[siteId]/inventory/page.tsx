'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { inventoryApi, ApiError } from '@/lib/api';
import { SiteInventoryItem, SiteInventoryItemDetail, InventoryTxType } from '@/lib/types';
import {
  Table, TableHeader, TableBody, TableRow,
  TableHead, TableCell,
} from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ArrowLeft, Layers, AlertCircle, X, ChevronRight } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isLowStock(item: SiteInventoryItem): boolean {
  if (item.lowStockThreshold === null) return false;
  return parseFloat(item.currentQuantity) <= parseFloat(item.lowStockThreshold);
}

function formatQty(qty: string): string {
  const n = parseFloat(qty);
  return isNaN(n) ? qty : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const TX_LABELS: Record<InventoryTxType, string> = {
  delivery_in:    'Delivery In',
  usage_out:      'Usage Out',
  adjustment_in:  'Adj. In',
  adjustment_out: 'Adj. Out',
  transfer_in:    'Transfer In',
  transfer_out:   'Transfer Out',
};

function txSign(type: InventoryTxType): '+' | '-' {
  return type.endsWith('_in') ? '+' : '-';
}

function txBadge(type: InventoryTxType) {
  const label = TX_LABELS[type] ?? type;
  if (type.endsWith('_in'))  return <Badge variant="active">{label}</Badge>;
  if (type.endsWith('_out')) return <Badge variant="destructive">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  projectId: string;
  siteId:    string;
  itemId:    string;
  onClose:   () => void;
}

function DetailPanel({ projectId, siteId, itemId, onClose }: DetailPanelProps) {
  const [detail, setDetail]   = useState<SiteInventoryItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    inventoryApi
      .get(projectId, siteId, itemId)
      .then((res) => setDetail(res.item))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load details'))
      .finally(() => setLoading(false));
  }, [projectId, siteId, itemId]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-50 flex h-full w-full max-w-lg flex-col bg-navy-base shadow-xl border-l border-border overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">
              {detail ? detail.materialName : 'Inventory Detail'}
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {loading && (
          <div className="space-y-3 p-6">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 rounded" />)}
          </div>
        )}

        {error && (
          <div className="p-6">
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        {!loading && !error && detail && (
          <div className="space-y-6 p-6">
            {/* Stock summary */}
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Current Stock</p>
                  <p className="text-2xl font-bold text-primary tabular-nums">
                    {formatQty(detail.currentQuantity)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{detail.unitOfMeasure}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Low Stock Alert</p>
                  {detail.lowStockThreshold !== null ? (
                    <>
                      <p className="text-2xl font-bold tabular-nums text-foreground">
                        {formatQty(detail.lowStockThreshold)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{detail.unitOfMeasure}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-1">Not set</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {isLowStock(detail) && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>
                  Stock is at or below the low-stock threshold.
                </AlertDescription>
              </Alert>
            )}

            <div className="text-xs text-muted-foreground">
              Last updated: {formatDateTime(detail.updatedAt)}
            </div>

            {/* Transactions */}
            <div>
              <h3 className="text-sm font-semibold mb-3">
                Recent Transactions
                {detail.transactions.length > 0 && (
                  <span className="ml-2 text-muted-foreground font-normal">
                    ({detail.transactions.length})
                  </span>
                )}
              </h3>

              {detail.transactions.length === 0 && (
                <p className="text-sm text-muted-foreground">No transactions recorded yet.</p>
              )}

              {detail.transactions.length > 0 && (
                <div className="space-y-2">
                  {detail.transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-start justify-between rounded-lg border border-border bg-card px-4 py-3 gap-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        {txBadge(tx.type)}
                        {tx.delivery && (
                          <p className="text-xs text-muted-foreground truncate">
                            {tx.delivery.supplierName} · {formatDate(tx.delivery.deliveryDate)}
                          </p>
                        )}
                        {tx.performedBy && (
                          <p className="text-xs text-muted-foreground">
                            By {tx.performedBy.firstName} {tx.performedBy.lastName}
                          </p>
                        )}
                        {tx.note && (
                          <p className="text-xs text-muted-foreground italic">{tx.note}</p>
                        )}
                        <p className="text-xs text-muted-foreground">{formatDateTime(tx.createdAt)}</p>
                      </div>
                      <span
                        className={`text-sm font-semibold tabular-nums whitespace-nowrap ${
                          txSign(tx.type) === '+' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {txSign(tx.type)}{formatQty(tx.quantity)} {tx.unitOfMeasure}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();

  const [inventory, setInventory] = useState<SiteInventoryItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [selected, setSelected]   = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !siteId) return;
    inventoryApi
      .list(projectId, siteId)
      .then((res) => setInventory(res.inventory))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load inventory'))
      .finally(() => setLoading(false));
  }, [projectId, siteId]);

  const lowStockCount = inventory.filter(isLowStock).length;

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div>
        <Link
          href={`/projects/${projectId}/sites/${siteId}`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Site
        </Link>
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        </div>
      </div>

      {/* Low stock banner */}
      {!loading && !error && lowStockCount > 0 && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            {lowStockCount} {lowStockCount === 1 ? 'item is' : 'items are'} at or below the low-stock threshold.
          </AlertDescription>
        </Alert>
      )}

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded" />)}
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!loading && !error && inventory.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Layers className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-sm font-medium text-foreground">No inventory items yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Inventory is credited automatically when deliveries are accepted.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {!loading && !error && inventory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {inventory.length} {inventory.length === 1 ? 'Item' : 'Items'}
            </CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Current Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="whitespace-nowrap">Last Updated</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.map((item) => {
                  const low = isLowStock(item);
                  return (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-navy-elevated transition-colors"
                      onClick={() => setSelected(item.id)}
                    >
                      <TableCell className="font-medium max-w-[220px] truncate">
                        {item.materialName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-primary font-semibold">
                        {formatQty(item.currentQuantity)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.unitOfMeasure}
                      </TableCell>
                      <TableCell>
                        {low
                          ? <Badge variant="destructive">Low Stock</Badge>
                          : <Badge variant="active">OK</Badge>
                        }
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDate(item.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          projectId={projectId}
          siteId={siteId}
          itemId={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
