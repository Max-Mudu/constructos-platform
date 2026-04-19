'use client';

import { useState, useEffect, FormEvent, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { deliveryApi, supplierApi, ApiError } from '@/lib/api';
import { DeliveryCondition, InspectionStatus, AcceptanceStatus, Supplier } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Separator } from '@/components/ui/Separator';
import { ArrowLeft, AlertCircle } from 'lucide-react';

// ── Field helpers ─────────────────────────────────────────────────────────────

function Field({
  label, required, children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}{required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const selectCls = inputCls + ' appearance-none';

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NewDeliveryPage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();
  const router = useRouter();
  const user   = useAuthStore((s) => s.user);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [suppliers, setSuppliers]   = useState<Supplier[]>([]);

  // Controlled fields for supplier quick-fill
  const [supplierName, setSupplierName]       = useState('');
  const [supplierContact, setSupplierContact] = useState('');

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    supplierApi.list().then((r) => setSuppliers(r.suppliers)).catch(() => {});
  }, []);

  function handleSupplierSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const s = suppliers.find((s) => s.id === e.target.value);
    if (s) {
      setSupplierName(s.name);
      setSupplierContact(s.contactPerson ?? s.phone ?? '');
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setSubmitting(true);

    const fd = new FormData(e.currentTarget);
    const get = (k: string) => (fd.get(k) as string | null)?.trim() || undefined;
    const getNum = (k: string) => {
      const v = fd.get(k) as string;
      return v ? Number(v) : 0;
    };

    try {
      await deliveryApi.create(projectId, siteId, {
        supplierName:        supplierName.trim() || get('supplierName')!,
        supplierContact:     supplierContact.trim() || get('supplierContact'),
        deliveryDate:        get('deliveryDate')!,
        deliveryTime:        get('deliveryTime'),
        driverName:          get('driverName'),
        vehicleRegistration: get('vehicleRegistration'),
        purchaseOrderNumber: get('purchaseOrderNumber'),
        deliveryNoteNumber:  get('deliveryNoteNumber'),
        invoiceNumber:       get('invoiceNumber'),
        itemDescription:     get('itemDescription')!,
        unitOfMeasure:       get('unitOfMeasure')!,
        quantityOrdered:     getNum('quantityOrdered'),
        quantityDelivered:   getNum('quantityDelivered'),
        conditionOnArrival:  get('conditionOnArrival') as DeliveryCondition,
        inspectionStatus:    get('inspectionStatus') as InspectionStatus,
        acceptanceStatus:    get('acceptanceStatus') as AcceptanceStatus,
        rejectionReason:     get('rejectionReason'),
        discrepancyNotes:    get('discrepancyNotes'),
        receivedById:        get('receivedById') || user?.id || '',
        comments:            get('comments'),
      });
      router.push(`/projects/${projectId}/sites/${siteId}/deliveries`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) setFieldErrors(err.details);
        else setError(err.message);
      } else {
        setError('Failed to save delivery record');
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">

      {/* Header */}
      <div>
        <Link
          href={`/projects/${projectId}/sites/${siteId}/deliveries`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Deliveries
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Record Delivery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Log a new material or equipment delivery to this site.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-8">

        {/* ── Supplier Quick-fill ── */}
        {suppliers.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Quick-fill from Supplier</CardTitle></CardHeader>
            <Separator />
            <CardContent className="pt-6">
              <Field label="Select Supplier (optional)">
                <select className={selectCls} defaultValue="" onChange={handleSupplierSelect}>
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
                name="supplierName"
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
                name="supplierContact"
                value={supplierContact}
                onChange={(e) => setSupplierContact(e.target.value)}
                placeholder="+254 700 000 000"
                className={inputCls}
              />
            </Field>

            <Field label="Delivery Date" required>
              <input
                name="deliveryDate"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputCls}
              />
              {fieldErrors.deliveryDate && (
                <p className="text-xs text-destructive">{fieldErrors.deliveryDate[0]}</p>
              )}
            </Field>

            <Field label="Delivery Time">
              <input name="deliveryTime" type="time" className={inputCls} />
            </Field>

            <Field label="Driver Name">
              <input name="driverName" placeholder="Peter Kariuki" className={inputCls} />
            </Field>

            <Field label="Vehicle Registration">
              <input name="vehicleRegistration" placeholder="KCA 456B" className={inputCls} />
            </Field>

          </CardContent>
        </Card>

        {/* ── Reference Numbers ── */}
        <Card>
          <CardHeader><CardTitle className="text-base">Reference Numbers</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Purchase Order No.">
              <input name="purchaseOrderNumber" placeholder="PO-2026-001" className={inputCls} />
            </Field>
            <Field label="Delivery Note No.">
              <input name="deliveryNoteNumber" placeholder="DN-EAC-0041" className={inputCls} />
            </Field>
            <Field label="Invoice No.">
              <input name="invoiceNumber" placeholder="INV-2026-001" className={inputCls} />
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
                  name="itemDescription"
                  required
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
                name="unitOfMeasure"
                required
                placeholder="bags, bars, m³, litres…"
                className={inputCls}
              />
            </Field>

            <Field label="Quantity Ordered" required>
              <input
                name="quantityOrdered"
                type="number"
                min={0}
                required
                placeholder="500"
                className={inputCls}
              />
            </Field>

            <Field label="Quantity Delivered" required>
              <input
                name="quantityDelivered"
                type="number"
                min={0}
                required
                placeholder="500"
                className={inputCls}
              />
            </Field>

            <Field label="Condition on Arrival">
              <select name="conditionOnArrival" defaultValue="good" className={selectCls}>
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
              <select name="inspectionStatus" defaultValue="pending" className={selectCls}>
                <option value="pending">Pending</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="waived">Waived</option>
              </select>
            </Field>

            <Field label="Acceptance Status">
              <select name="acceptanceStatus" defaultValue="accepted" className={selectCls}>
                <option value="accepted">Accepted</option>
                <option value="partially_accepted">Partially Accepted</option>
                <option value="rejected">Rejected</option>
              </select>
            </Field>

            <div className="sm:col-span-2">
              <Field label="Rejection Reason">
                <textarea
                  name="rejectionReason"
                  rows={2}
                  placeholder="Reason for rejecting the delivery…"
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="Discrepancy Notes">
                <textarea
                  name="discrepancyNotes"
                  rows={2}
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
          <CardContent className="pt-6 space-y-4">
            <Field label="Comments">
              <textarea
                name="comments"
                rows={3}
                placeholder="Any additional observations about the delivery…"
                className={inputCls}
              />
            </Field>
            {/* Received by defaults to logged-in user; hidden field */}
            <input type="hidden" name="receivedById" value={user?.id ?? ''} />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end pb-8">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/projects/${projectId}/sites/${siteId}/deliveries`)}
          >
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save Delivery Record
          </Button>
        </div>

      </form>
    </div>
  );
}
