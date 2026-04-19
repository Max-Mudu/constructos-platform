'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { deliveryApi, ApiError } from '@/lib/api';
import { DeliveryRecord, DeliveryPhoto, DeliveryDocument } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Separator } from '@/components/ui/Separator';
import {
  ArrowLeft, Truck, Calendar, User, FileText,
  ClipboardCheck, AlertCircle, Trash2, Upload, X, Image, File,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const WRITE_ROLES  = ['company_admin', 'project_manager', 'site_supervisor'] as const;
const DELETE_ROLES = ['company_admin', 'project_manager'] as const;

function canWrite(role: string) { return (WRITE_ROLES as readonly string[]).includes(role); }
function canDelete(role: string) { return (DELETE_ROLES as readonly string[]).includes(role); }

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-start">
      <dt className="w-full text-xs font-medium uppercase tracking-wider text-muted-foreground sm:w-44 shrink-0 pt-0.5">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function acceptanceBadge(status: DeliveryRecord['acceptanceStatus']) {
  if (status === 'accepted')           return <Badge variant="active">Accepted</Badge>;
  if (status === 'partially_accepted') return <Badge variant="secondary">Partially Accepted</Badge>;
  return                                      <Badge variant="destructive">Rejected</Badge>;
}

function inspectionBadge(status: DeliveryRecord['inspectionStatus']) {
  if (status === 'passed')  return <Badge variant="active">Passed</Badge>;
  if (status === 'failed')  return <Badge variant="destructive">Failed</Badge>;
  if (status === 'waived')  return <Badge variant="outline">Waived</Badge>;
  return                           <Badge variant="secondary">Pending</Badge>;
}

function conditionBadge(c: DeliveryRecord['conditionOnArrival']) {
  if (c === 'good')      return <Badge variant="active">Good</Badge>;
  if (c === 'partial')   return <Badge variant="secondary">Partial</Badge>;
  if (c === 'damaged')   return <Badge variant="destructive">Damaged</Badge>;
  return                        <Badge variant="outline">Incorrect</Badge>;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DeliveryDetailPage() {
  const { projectId, siteId, deliveryId } =
    useParams<{ projectId: string; siteId: string; deliveryId: string }>();
  const router = useRouter();
  const user   = useAuthStore((s) => s.user);

  const [delivery, setDelivery]     = useState<DeliveryRecord | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [deleting, setDeleting]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // File upload state
  const [uploadingPhoto, setUploadingPhoto]   = useState(false);
  const [uploadingDoc, setUploadingDoc]       = useState(false);
  const [uploadError, setUploadError]         = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!projectId || !siteId || !deliveryId) return;
    deliveryApi
      .get(projectId, siteId, deliveryId)
      .then((d) => setDelivery(d.delivery))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load delivery record'),
      )
      .finally(() => setLoading(false));
  }, [projectId, siteId, deliveryId]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deliveryApi.delete(projectId, siteId, deliveryId);
      router.push(`/projects/${projectId}/sites/${siteId}/deliveries`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete delivery record');
      setDeleting(false);
      setShowConfirm(false);
    }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploadingPhoto(true);
    try {
      const { photo } = await deliveryApi.uploadPhoto(projectId, siteId, deliveryId, file);
      setDelivery((d) => d ? { ...d, photos: [...d.photos, photo] } : d);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploadingDoc(true);
    try {
      const { document } = await deliveryApi.uploadDocument(projectId, siteId, deliveryId, file);
      setDelivery((d) => d ? { ...d, documents: [...d.documents, document] } : d);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Failed to upload document');
    } finally {
      setUploadingDoc(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  }

  async function handleDeletePhoto(photo: DeliveryPhoto) {
    try {
      await deliveryApi.deletePhoto(projectId, siteId, deliveryId, photo.id);
      setDelivery((d) => d ? { ...d, photos: d.photos.filter((p) => p.id !== photo.id) } : d);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Failed to delete photo');
    }
  }

  async function handleDeleteDoc(doc: DeliveryDocument) {
    try {
      await deliveryApi.deleteDocument(projectId, siteId, deliveryId, doc.id);
      setDelivery((d) => d ? { ...d, documents: d.documents.filter((doc2) => doc2.id !== doc.id) } : d);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Failed to delete document');
    }
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="max-w-3xl space-y-6 animate-fade-in">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        <Card><CardContent className="pt-6 space-y-3">
          {[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-6 rounded" />)}
        </CardContent></Card>
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

  if (!delivery) return null;

  const hasDiscrepancy =
    delivery.acceptanceStatus === 'partially_accepted' || delivery.acceptanceStatus === 'rejected';

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">

      {/* Breadcrumb */}
      <div>
        <Link
          href={`/projects/${projectId}/sites/${siteId}/deliveries`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Deliveries
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {acceptanceBadge(delivery.acceptanceStatus)}
              {inspectionBadge(delivery.inspectionStatus)}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight truncate">
              {delivery.supplierName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {delivery.itemDescription} &middot; {formatDate(delivery.deliveryDate)}
            </p>
          </div>

          {/* Actions */}
          {user && canDelete(user.role) && (
            <div className="shrink-0">
              {!showConfirm ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConfirm(true)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Are you sure?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    loading={deleting}
                    onClick={handleDelete}
                  >
                    Delete
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Supplier & Logistics ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Supplier &amp; Logistics</CardTitle>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-2">
          <dl className="divide-y divide-border">
            <DetailRow label="Supplier"        value={delivery.supplierName} />
            <DetailRow label="Supplier Contact" value={delivery.supplierContact} />
            <DetailRow label="Delivery Date"   value={formatDate(delivery.deliveryDate)} />
            <DetailRow label="Delivery Time"   value={delivery.deliveryTime} />
            <DetailRow label="Driver"          value={delivery.driverName} />
            <DetailRow label="Vehicle Reg."    value={delivery.vehicleRegistration} />
          </dl>
        </CardContent>
      </Card>

      {/* ── Reference Numbers ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Reference Numbers</CardTitle>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-2">
          <dl className="divide-y divide-border">
            <DetailRow label="Purchase Order"  value={delivery.purchaseOrderNumber} />
            <DetailRow label="Delivery Note"   value={delivery.deliveryNoteNumber} />
            <DetailRow label="Invoice No."     value={delivery.invoiceNumber} />
          </dl>
          {!delivery.purchaseOrderNumber && !delivery.deliveryNoteNumber && !delivery.invoiceNumber && (
            <p className="py-3 text-sm text-muted-foreground">No reference numbers recorded.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Items ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Items &amp; Quantities</CardTitle>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-2">
          <dl className="divide-y divide-border">
            <DetailRow label="Item Description"  value={delivery.itemDescription} />
            <DetailRow label="Unit of Measure"   value={delivery.unitOfMeasure} />
            <DetailRow
              label="Quantity Ordered"
              value={`${delivery.quantityOrdered.toLocaleString()} ${delivery.unitOfMeasure}`}
            />
            <DetailRow
              label="Quantity Delivered"
              value={`${delivery.quantityDelivered.toLocaleString()} ${delivery.unitOfMeasure}`}
            />
            <DetailRow label="Condition on Arrival" value={conditionBadge(delivery.conditionOnArrival)} />
          </dl>
        </CardContent>
      </Card>

      {/* ── Inspection & Acceptance ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Inspection &amp; Acceptance</CardTitle>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-2">
          <dl className="divide-y divide-border">
            <DetailRow label="Inspection"   value={inspectionBadge(delivery.inspectionStatus)} />
            <DetailRow label="Acceptance"   value={acceptanceBadge(delivery.acceptanceStatus)} />
            {hasDiscrepancy && (
              <>
                <DetailRow label="Rejection Reason"   value={delivery.rejectionReason} />
                <DetailRow label="Discrepancy Notes"  value={delivery.discrepancyNotes} />
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* ── Reception ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Reception</CardTitle>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-2">
          <dl className="divide-y divide-border">
            <DetailRow
              label="Received By"
              value={`${delivery.receivedBy.firstName} ${delivery.receivedBy.lastName}`}
            />
            <DetailRow label="Comments" value={delivery.comments} />
            <DetailRow label="Recorded"  value={formatDateTime(delivery.createdAt)} />
            <DetailRow label="Last Updated" value={formatDateTime(delivery.updatedAt)} />
          </dl>
        </CardContent>
      </Card>

      {/* Upload error */}
      {uploadError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{uploadError}</AlertDescription>
        </Alert>
      )}

      {/* ── Photos ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">
                Photos {delivery.photos.length > 0 && `(${delivery.photos.length})`}
              </CardTitle>
            </div>
            {user && canWrite(user.role) && (
              <>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
                <Button
                  size="sm"
                  variant="outline"
                  loading={uploadingPhoto}
                  onClick={() => photoInputRef.current?.click()}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Upload Photo
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          {delivery.photos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No photos uploaded yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {delivery.photos.map((photo) => (
                <div key={photo.id} className="group relative rounded-md border border-border overflow-hidden bg-muted">
                  <img
                    src={`/api/v1${photo.fileUrl}`}
                    alt={photo.fileName}
                    className="h-32 w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="p-1.5 flex items-center justify-between gap-1">
                    <span className="text-xs text-muted-foreground truncate">{photo.fileName}</span>
                    {user && canWrite(user.role) && (
                      <button
                        onClick={() => handleDeletePhoto(photo)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Documents ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <File className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">
                Documents {delivery.documents.length > 0 && `(${delivery.documents.length})`}
              </CardTitle>
            </div>
            {user && canWrite(user.role) && (
              <>
                <input
                  ref={docInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                  className="hidden"
                  onChange={handleDocUpload}
                />
                <Button
                  size="sm"
                  variant="outline"
                  loading={uploadingDoc}
                  onClick={() => docInputRef.current?.click()}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Upload Document
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          {delivery.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No documents uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {delivery.documents.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 py-2">
                  <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/api/v1${doc.fileUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium hover:underline truncate block"
                    >
                      {doc.fileName}
                    </a>
                    <span className="text-xs text-muted-foreground">
                      {(doc.fileSizeBytes / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  {user && canWrite(user.role) && (
                    <button
                      onClick={() => handleDeleteDoc(doc)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Edit button for write roles */}
      {user && canWrite(user.role) && (
        <div className="flex justify-end pb-8">
          <Button asChild variant="outline">
            <Link href={`/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}/edit`}>
              Edit Record
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
