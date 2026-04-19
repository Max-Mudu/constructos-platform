/**
 * Invoices screen — Phase 2
 * List + detail with approve/dispute actions.
 * Visible only to company_admin, finance_officer, canViewFinance roles
 * (tab is hidden for everyone else via _layout.tsx).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList,
  TouchableOpacity, RefreshControl, ActivityIndicator,
  TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { invoicesApi } from '../../src/api/invoices';
import { useAuthStore } from '../../src/store/auth.store';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Badge';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { useSSEEvent } from '../../src/hooks/useSSEEvent';
import { Invoice, InvoiceStatus } from '../../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<InvoiceStatus, 'success' | 'warning' | 'error' | 'default'> = {
  approved:  'success',
  paid:      'success',
  submitted: 'warning',
  overdue:   'error',
  disputed:  'error',
  draft:     'default',
  cancelled: 'default',
};

function statusLabel(s: InvoiceStatus): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Invoice row ──────────────────────────────────────────────────────────────

function InvoiceRow({ invoice, onPress }: { invoice: Invoice; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.row} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
        <Text style={styles.vendorName} numberOfLines={1}>{invoice.vendorName}</Text>
        <Text style={styles.rowDate}>{formatDate(invoice.issueDate)}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.amount}>{formatCurrency(invoice.totalAmount, invoice.currency)}</Text>
        <Badge label={statusLabel(invoice.status)} variant={STATUS_VARIANT[invoice.status]} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Status filter bar ────────────────────────────────────────────────────────

const FILTERS: Array<{ label: string; value: string }> = [
  { label: 'All',       value: ''          },
  { label: 'Pending',   value: 'submitted' },
  { label: 'Approved',  value: 'approved'  },
  { label: 'Overdue',   value: 'overdue'   },
  { label: 'Disputed',  value: 'disputed'  },
  { label: 'Paid',      value: 'paid'      },
];

// ─── Line items table ─────────────────────────────────────────────────────────

function LineItemsTable({ invoice }: { invoice: Invoice }) {
  if (!invoice.lineItems?.length) return null;
  return (
    <View style={styles.lineItemsWrap}>
      <Text style={styles.lineItemsTitle}>Line Items</Text>
      {invoice.lineItems.map((li, i) => (
        <View key={li.id ?? i} style={[styles.lineItemRow, i > 0 && styles.lineItemBorder]}>
          <Text style={styles.lineItemDesc} numberOfLines={2}>{li.description}</Text>
          <View style={styles.lineItemMeta}>
            <Text style={styles.lineItemQty}>{li.quantity} × {formatCurrency(li.unitPrice, invoice.currency)}</Text>
            <Text style={styles.lineItemTotal}>{formatCurrency(li.totalPrice, invoice.currency)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Dispute modal ────────────────────────────────────────────────────────────

function DisputeModal({
  visible,
  onClose,
  onSubmit,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (notes: string) => void;
  loading: boolean;
}) {
  const [notes, setNotes] = useState('');

  function handleSubmit() {
    onSubmit(notes);
    setNotes('');
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Dispute Invoice</Text>
          <Text style={styles.modalSub}>Provide a reason for disputing this invoice:</Text>
          <TextInput
            style={styles.modalInput}
            multiline
            numberOfLines={4}
            placeholder="Describe the issue..."
            placeholderTextColor="#475569"
            value={notes}
            onChangeText={setNotes}
          />
          <View style={styles.modalActions}>
            <TouchableOpacity onPress={onClose} style={styles.modalCancelBtn} disabled={loading}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSubmit} style={styles.modalDisputeBtn} disabled={loading}>
              {loading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.modalDisputeText}>Dispute</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Invoice detail view ──────────────────────────────────────────────────────

function InvoiceDetail({
  invoiceId,
  onBack,
  canApprove,
}: {
  invoiceId: string;
  onBack: () => void;
  canApprove: boolean;
}) {
  const [invoice,        setInvoice]        = useState<Invoice | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [actionLoading,  setActionLoading]  = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [disputeVisible, setDisputeVisible] = useState(false);
  const [actionError,    setActionError]    = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      setInvoice(await invoicesApi.get(invoiceId));
    } catch {
      setError('Failed to load invoice');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [invoiceId]);

  async function handleApprove() {
    setActionLoading(true);
    setActionError(null);
    try {
      const updated = await invoicesApi.approve(invoiceId);
      setInvoice(updated);
    } catch {
      setActionError('Failed to approve invoice');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDispute(notes: string) {
    setActionLoading(true);
    setActionError(null);
    try {
      const updated = await invoicesApi.dispute(invoiceId, notes || undefined);
      setInvoice(updated);
      setDisputeVisible(false);
    } catch {
      setActionError('Failed to dispute invoice');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <LoadingSpinner />;

  if (error || !invoice) {
    return (
      <Screen>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'← Back'}</Text>
        </TouchableOpacity>
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error ?? 'Not found'}</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const outstanding = invoice.totalAmount - invoice.paidAmount;
  const canAct = canApprove && invoice.status === 'submitted';

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.detailScroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>{'← Invoices'}</Text>
        </TouchableOpacity>

        <View style={styles.detailHeader}>
          <View style={styles.detailTitleRow}>
            <Text style={styles.detailNumber}>{invoice.invoiceNumber}</Text>
            <Badge label={statusLabel(invoice.status)} variant={STATUS_VARIANT[invoice.status]} />
          </View>
          <Text style={styles.detailVendor}>{invoice.vendorName}</Text>
          <Text style={styles.detailVendorType}>{invoice.vendorType}</Text>
        </View>

        {/* Amount summary */}
        <Card style={styles.amountCard}>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>Subtotal</Text>
            <Text style={styles.amountValue}>{formatCurrency(invoice.subtotal, invoice.currency)}</Text>
          </View>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>Tax</Text>
            <Text style={styles.amountValue}>{formatCurrency(invoice.taxAmount, invoice.currency)}</Text>
          </View>
          <View style={[styles.amountRow, styles.amountTotal]}>
            <Text style={styles.amountTotalLabel}>Total</Text>
            <Text style={styles.amountTotalValue}>{formatCurrency(invoice.totalAmount, invoice.currency)}</Text>
          </View>
          {invoice.paidAmount > 0 && (
            <>
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>Paid</Text>
                <Text style={[styles.amountValue, styles.amountPaid]}>
                  {formatCurrency(invoice.paidAmount, invoice.currency)}
                </Text>
              </View>
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>Outstanding</Text>
                <Text style={[styles.amountValue, outstanding > 0 && styles.amountDue]}>
                  {formatCurrency(outstanding, invoice.currency)}
                </Text>
              </View>
            </>
          )}
        </Card>

        {/* Dates */}
        <Card style={styles.datesCard}>
          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>Issue Date</Text>
            <Text style={styles.dateValue}>{formatDate(invoice.issueDate)}</Text>
          </View>
          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>Due Date</Text>
            <Text style={[styles.dateValue, invoice.status === 'overdue' && styles.overdue]}>
              {formatDate(invoice.dueDate)}
            </Text>
          </View>
        </Card>

        {/* Line items */}
        <LineItemsTable invoice={invoice} />

        {/* Notes */}
        {invoice.notes && (
          <Card style={styles.notesCard}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </Card>
        )}

        {/* Actions */}
        {canAct && (
          <View style={styles.actions}>
            {actionError && <Text style={styles.actionError}>{actionError}</Text>}
            <TouchableOpacity
              style={styles.approveBtn}
              onPress={handleApprove}
              disabled={actionLoading}
            >
              {actionLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.approveBtnText}>Approve Invoice</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.disputeBtn}
              onPress={() => setDisputeVisible(true)}
              disabled={actionLoading}
            >
              <Text style={styles.disputeBtnText}>Dispute</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <DisputeModal
        visible={disputeVisible}
        onClose={() => setDisputeVisible(false)}
        onSubmit={handleDispute}
        loading={actionLoading}
      />
    </Screen>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function InvoicesScreen() {
  const user = useAuthStore((s) => s.user)!;

  const [invoices,    setInvoices]    = useState<Invoice[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [filter,      setFilter]      = useState('');
  const [selectedId,  setSelectedId]  = useState<string | null>(null);

  const canApprove = user.role === 'company_admin' || user.role === 'finance_officer' || user.canViewFinance;

  async function load(status?: string) {
    try {
      setError(null);
      setInvoices(await invoicesApi.list(status ? { status } : undefined));
    } catch {
      setError('Failed to load invoices');
    }
  }

  useEffect(() => {
    load(filter || undefined).finally(() => setLoading(false));
  }, [filter]);

  async function onRefresh() {
    setRefreshing(true);
    await load(filter || undefined);
    setRefreshing(false);
  }

  // Auto-refresh on invoice SSE events
  const refreshOnEvent = useCallback(() => { void load(filter || undefined); }, [filter]);
  useSSEEvent('invoice_updated', refreshOnEvent);
  useSSEEvent('invoice_created', refreshOnEvent);

  // Show detail if selected
  if (selectedId) {
    return (
      <InvoiceDetail
        invoiceId={selectedId}
        onBack={() => setSelectedId(null)}
        canApprove={canApprove}
      />
    );
  }

  if (loading) return <LoadingSpinner />;

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.heading}>Invoices</Text>
        {invoices.length > 0 && (
          <Text style={styles.count}>{invoices.length}</Text>
        )}
      </View>

      {/* Filter bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterChip, filter === f.value && styles.filterChipActive]}
            onPress={() => { setFilter(f.value); setLoading(true); }}
          >
            <Text style={[styles.filterChipText, filter === f.value && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {error ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => load(filter || undefined)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : invoices.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>No invoices found</Text>
        </View>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <InvoiceRow invoice={item} onPress={() => setSelectedId(item.id)} />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // List
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 },
  heading:     { color: '#f1f5f9', fontSize: 24, fontWeight: '700', flex: 1 },
  count:       { color: '#64748b', fontSize: 14, fontWeight: '600' },

  filterBar:        { flexGrow: 0 },
  filterBarContent: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  filterChip:       { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  filterChipActive: { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  filterChipText:      { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  filterChipTextActive:{ color: '#fff',    fontSize: 12, fontWeight: '600' },

  list:      { paddingHorizontal: 16, paddingBottom: 32 },
  separator: { height: 1, backgroundColor: '#1e293b' },

  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, backgroundColor: '#0f172a' },
  rowLeft:      { flex: 1, marginRight: 12 },
  rowRight:     { alignItems: 'flex-end', gap: 6 },
  invoiceNumber:{ color: '#f1f5f9', fontSize: 14, fontWeight: '700' },
  vendorName:   { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  rowDate:      { color: '#64748b', fontSize: 11, marginTop: 2 },
  amount:       { color: '#f1f5f9', fontSize: 15, fontWeight: '700' },

  // Detail
  detailScroll: { padding: 16, paddingBottom: 40 },

  backBtn:  { marginBottom: 16 },
  backText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },

  detailHeader:    { marginBottom: 16 },
  detailTitleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  detailNumber:    { color: '#f1f5f9', fontSize: 20, fontWeight: '700', flex: 1, marginRight: 8 },
  detailVendor:    { color: '#94a3b8', fontSize: 15, fontWeight: '600' },
  detailVendorType:{ color: '#64748b', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },

  amountCard:       { marginBottom: 12 },
  amountRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  amountTotal:      { borderTopWidth: 1, borderTopColor: '#334155', marginTop: 4, paddingTop: 10 },
  amountLabel:      { color: '#94a3b8', fontSize: 13 },
  amountValue:      { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  amountTotalLabel: { color: '#f1f5f9', fontSize: 15, fontWeight: '700' },
  amountTotalValue: { color: '#f1f5f9', fontSize: 15, fontWeight: '700' },
  amountPaid:       { color: '#22c55e' },
  amountDue:        { color: '#ef4444' },

  datesCard: { marginBottom: 12 },
  dateRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  dateLabel: { color: '#94a3b8', fontSize: 13 },
  dateValue: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  overdue:   { color: '#ef4444' },

  lineItemsWrap:  { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  lineItemsTitle: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  lineItemRow:    { paddingVertical: 8 },
  lineItemBorder: { borderTopWidth: 1, borderTopColor: '#334155' },
  lineItemDesc:   { color: '#f1f5f9', fontSize: 13, marginBottom: 4 },
  lineItemMeta:   { flexDirection: 'row', justifyContent: 'space-between' },
  lineItemQty:    { color: '#64748b', fontSize: 12 },
  lineItemTotal:  { color: '#94a3b8', fontSize: 12, fontWeight: '600' },

  notesCard:  { marginBottom: 16 },
  notesLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  notesText:  { color: '#cbd5e1', fontSize: 13, lineHeight: 19 },

  actions:     { gap: 10, marginTop: 8 },
  actionError: { color: '#ef4444', fontSize: 13, textAlign: 'center', marginBottom: 4 },

  approveBtn:     { backgroundColor: '#16a34a', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  approveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  disputeBtn:     { backgroundColor: '#1e293b', borderRadius: 10, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#ef4444' },
  disputeBtnText: { color: '#ef4444', fontSize: 15, fontWeight: '600' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard:    { backgroundColor: '#1e293b', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#334155' },
  modalTitle:   { color: '#f1f5f9', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  modalSub:     { color: '#94a3b8', fontSize: 13, marginBottom: 14 },
  modalInput:   {
    backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155',
    borderRadius: 8, padding: 12, color: '#f1f5f9', fontSize: 14,
    minHeight: 100, textAlignVertical: 'top',
  },
  modalActions:     { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalCancelBtn:   { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  modalCancelText:  { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  modalDisputeBtn:  { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#dc2626', alignItems: 'center' },
  modalDisputeText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Shared
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: '#ef4444', fontSize: 15, marginBottom: 16, textAlign: 'center' },
  retryBtn:  { backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#334155' },
  retryText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: '#64748b', fontSize: 15 },
});
