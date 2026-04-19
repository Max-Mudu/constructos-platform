'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { deliveryApi, supplierApi, ApiError } from '@/lib/api';
import { DeliveryRecord, DeliveryCondition, InspectionStatus, AcceptanceStatus, Supplier } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Separator } from '@/components/ui/Separator';
import { Skeleton } from '@/components/ui/Skeleton';
import { ArrowLeft, AlertCircle } from 'lucide-react';

// ── Styles ────────────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const selectCls = inputCls + ' appearance-none';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EditDeliveryPage() {
  const { projectId, siteId, deliveryId } =
    useParams<{ projectId: string; siteId: string; deliveryId: string }>();
  const router = useRouter();

  const [delivery, setDelivery] = useState<DeliveryRecord | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading]   = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // ── Controlled field state (pre-filled from delivery) ──────────────────────
  const [supplierName, setSupplierName]           = useState('');
  const [supplierContact, setSupplierContact]     = useState('');
  const [deliveryDate, setDeliveryDate]           = useState('');
  const [deliveryTime, setDeliveryTime]           = useState('');
  const [driverName, setDriverName]               = useState('');
  const [vehicleRegistration, setVehicleReg]      = useState('');
  const [purchaseOrderNumber, setPONumber]        = useState('');
  const [deliveryNoteNumber, setDNNumber]         = useState('');
  const [invoiceNumber, setInvoiceNumber]         = useState('');
  const [itemDescription, setItemDescription]     = useState('');
  const [unitOfMeasure, setUnitOfMeasure]         = useState('');
  const [quantityOrdered, setQtyOrdered]          = useState('');
  const [quantityDelivered, setQtyDelivered]      = useState('');
  const [conditionOnArrival, setCondition]        = useState<DeliveryCondition>('good');
  const [inspectionStatus, setInspection]         = useState<InspectionStatus>('pending');
  const [acceptanceStatus, setAcceptance]         = useState<AcceptanceStatus>('accepted');
  const [rejectionReason, setRejectionReason]     = useState('');
  const [discrepancyNotes, setDiscrepancyNotes]   = useState('');
  const [comments, setComments]                   = useState('');

  useEffect(() => {
    if (!projectId || !siteId || !deliveryId) return;
    Promise.all([
      deliveryApi.get(projectId, siteId, deliveryId),
      supplierApi.list().catch(() => ({ suppliers: [] })),
    ]).then(([deliveryRes, suppliersRes]) => {
      const d = deliveryRes.delivery;
      setDelivery(d);
      setSuppliers(suppliersRes.suppliers);

      // Pre-fill all fields
      setSupplierName(d.supplierName);
      setSupplierContact(d.supplierContact ?? '');
      setDeliveryDate(d.deliveryDate.slice(0, 10));
      setDeliveryTime(d.deliveryTime ?? '');
      setDriverName(d.driverName ?? '');
      setVehicleReg(d.vehicleRegistration ?? '');
      setPONumber(d.purchaseOrderNumber ?? '');
      setDNNumber(d.deliveryNoteNumber ?? '');
      setInvoiceNumber(d.invoiceNumber ?? '');
      setItemDescription(d.itemDescription);
      setUnitOfMeasure(d.unitOfMeasure);
      setQtyOrdered(String(d.quantityOrdered));
      setQtyDelivered(String(d.quantityDelivered));
      setCondition(d.conditionOnArrival);
      setInspection(d.inspectionStatus);
      setAcceptance(d.acceptanceStatus);
      setRejectionReason(d.rejectionReason ?? '');
      setDiscrepancyNotes(d.discrepancyNotes ?? '');
      setComments(d.comments ?? '');
    }).catch((err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to load delivery record');
    }).finally(() => setLoading(false));
  }, [projectId, siteId, deliveryId]);

  function handleSupplierSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const s = suppliers.find((s) => s.id === e.target.value);
    if (s) {
      setSupplierName(s.name);
      setSupplierContact(s.contactPerson ?? s.phone ?? '');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setSubmitting(true);

    const nullIfEmpty = (v: string) => v.trim() || null;

    try {
      await deliveryApi.update(projectId, siteId, deliveryId, {
        supplierName:        supplierName.trim(),
        supplierContact:     nullIfEmpty(supplierContact),
        deliveryDate,
        deliveryTime:        nullIfEmpty(deliveryTime),
        driverName:          nullIfEmpty(driverName),
        vehicleRegistration: nullIfEmpty(vehicleRegistration),
        purchaseOrderNumber: nullIfEmpty(purchaseOrderNumber),
        deliveryNoteNumber:  nullIfEmpty(deliveryNoteNumber),
        invoiceNumber:       nullIfEmpty(invoiceNumber),
        itemDescription:     itemDescription.trim(),
        unitOfMeasure:       unitOfMeasure.trim(),
        quantityOrdered:     Number(quantityOrdered),
        quantityDelivered:   Number(quantityDelivered),
        conditionOnArrival,
        inspectionStatus,
        acceptanceStatus,
        rejectionReason:     nullIfEmpty(rejectionReason),
        discrepancyNotes:    nullIfEmpty(discrepancyNotes),
        comments:            nullIfEmpty(comments),
      });
      router.push(`/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setFieldErrors(err.details);
        else setError(err.message);
      } else {
        setError('Failed to update delivery record');
      }
      setSubmitting(false);
    }
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="max-w-3xl space-y-6 animate-fade-in">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6 space-y-3">
              {[1, 2, 3].map((j) => <Skeleton key={j} className="h-10 rounded" />)}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error && !delivery) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">

      {/* Header */}
      <div>
        <Link
          href={`/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Delivery
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit Delivery Record</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update the details for this delivery.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">

        {/* ── Supplier Quick-fill ── */}
        {suppliers.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Quick-fill from Supplier</CardTitle></CardHeader>
            <Separator />
            <CardContent className="pt-6">
              <Field label="Select Supplier (optional)">
                <select
                  className={selectCls}
                  defaultValue=""
                  onChange={handleSupplierSelect}
                >
                  <option value="">— select to auto-fill —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Selecting a supplier pre-fills the name and contact fields below.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Supplier & Logistics ── */}
        <Card>
          <CardHeader><CardTitle className="text-base">Supplier &amp; Logistics</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">

            <Field label="Supplier Name" required>
              <input
                required
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="East Africa Cement Ltd"
                className={inputCls}
              />
              {fieldErrors.supplierName && (
                <p className="text-xs text-destructive">{fieldErrors.supplierName[0]}</p>
              )}
            </Field>

            <Field label="Supplier Contact">
              <input
                value={supplierContact}
                onChange={(e) => setSupplierContact(e.target.value)}
                placeholder="+254 700 000 000"
                className={inputCls}
              />
            </Field>

            <Field label="Delivery Date" required>
              <input
                type="date"
                required
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Delivery Time">
              <input
                type="time"
                value={deliveryTime}
                onChange={(e) => setDeliveryTime(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Driver Name">
              <input
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Peter Kariuki"
                className={inputCls}
              />
            </Field>

            <Field label="Vehicle Registration">
              <input
                value={vehicleRegistration}
                onChange={(e) => setVehicleReg(e.target.value)}
                placeholder="KCA 456B"
                className={inputCls}
              />
            </Field>

          </CardContent>
        </Card>

        {/* ── Reference Numbers ── */}
        <Card>
          <CardHeader><CardTitle className="text-base">Reference Numbers</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Purchase Order No.">
              <input
                value={purchaseOrderNumber}
                onChange={(e) => setPONumber(e.target.value)}
                placeholder="PO-2026-001"
                className={inputCls}
              />
            </Field>
            <Field label="Delivery Note No.">
              <input
                value={deliveryNoteNumber}
                onChange={(e) => setDNNumber(e.target.value)}
                placeholder="DN-EAC-0041"
                className={inputCls}
              />
            </Field>
            <Field label="Invoice No.">
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="INV-2026-001"
                className={inputCls}
              />
            </Field>
          </CardContent>
        </Card>

        {/* ── Items ── */}
        <Card>
          <CardHeader><CardTitle className="text-base">Items Delivered</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">

            <div className="sm:col-span-2">
              <Field label="Item / Material Description" required>
                <input
                  required
                  value={itemDescription}
                  onChange={(e) => setItemDescription(e.target.value)}
                  placeholder="Portland Cement 50kg bags"
                  className={inputCls}
                />
                {fieldErrors.itemDescription && (
                  <p className="text-xs text-destructive">{fieldErrors.itemDescription[0]}</p>
                )}
              </Field>
            </div>

            <Field label="Unit of Measure" required>
              <input
                required
                value={unitOfMeasure}
                onChange={(e) => setUnitOfMeasure(e.target.value)}
                placeholder="bags, bars, m³, litres…"
                className={inputCls}
              />
            </Field>

            <Field label="Quantity Ordered" required>
              <input
                type="number"
                min={0}
                required
                value={quantityOrdered}
                onChange={(e) => setQtyOrdered(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Quantity Delivered" required>
              <input
                type="number"
                min={0}
                required
                value={quantityDelivered}
                onChange={(e) => setQtyDelivered(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Condition on Arrival">
              <select
                value={conditionOnArrival}
                onChange={(e) => setCondition(e.target.value as DeliveryCondition)}
                className={selectCls}
              >
                <option value="good">Good</option>
                <option value="partial">Partial / Some damaged</option>
                <option value="damaged">Damaged</option>
                <option value="incorrect">Incorrect items</option>
              </select>
            </Field>

          </CardContent>
        </Card>

        {/* ── Inspection & Acceptance ── */}
        <Card>
          <CardHeader><CardTitle className="text-base">Inspection &amp; Acceptance</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">

            <Field label="Inspection Status">
              <select
                value={inspectionStatus}
                onChange={(e) => setInspection(e.target.value as InspectionStatus)}
                className={selectCls}
              >
                <option value="pending">Pending</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="waived">Waived</option>
              </select>
            </Field>

            <Field label="Acceptance Status">
              <select
                value={acceptanceStatus}
                onChange={(e) => setAcceptance(e.target.value as AcceptanceStatus)}
                className={selectCls}
              >
                <option value="accepted">Accepted</option>
                <option value="partially_accepted">Partially Accepted</option>
                <option value="rejected">Rejected</option>
              </select>
            </Field>

            <div className="sm:col-span-2">
              <Field label="Rejection Reason">
                <textarea
                  rows={2}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Reason for rejecting the delivery…"
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="Discrepancy Notes">
                <textarea
                  rows={2}
                  value={discrepancyNotes}
                  onChange={(e) => setDiscrepancyNotes(e.target.value)}
                  placeholder="e.g. 20 bars short — supplier to deliver balance by 5 Apr"
                  className={inputCls}
                />
              </Field>
            </div>

          </CardContent>
        </Card>

        {/* ── Comments ── */}
        <Card>
          <CardHeader><CardTitle className="text-base">Additional Notes</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-6">
            <Field label="Comments">
              <textarea
                rows={3}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Any additional observations…"
                className={inputCls}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end pb-8">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              router.push(`/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}`)
            }
          >
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save Changes
          </Button>
        </div>

      </form>
    </div>
  );
}
