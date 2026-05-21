/**
 * Inventory tab — read-only site material stock viewer.
 * Shows per-material current quantity, low-stock warnings, and transaction history.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useAuthStore } from '../../src/store/auth.store';
import { inventoryApi } from '../../src/api/inventory';
import { projectsApi } from '../../src/api/projects';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { EmptyState } from '../../src/components/EmptyState';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import {
  SiteInventoryItem, SiteInventoryItemDetail,
  InventoryTransaction, InventoryTxType, Project, JobSite,
} from '../../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmt(value: unknown): string {
  const n = toNumber(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
}

function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return s; }
}

function fmtDateTime(s: string): string {
  try {
    return new Date(s).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return s; }
}

function fmtRelative(iso: string): string {
  const diffMs  = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin <  1)  return 'just now';
  if (diffMin < 60)  return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr  < 24)  return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay <  7)  return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  return fmtDate(iso);
}

function isLowStock(item: SiteInventoryItem): boolean {
  return item.lowStockThreshold !== null && toNumber(item.currentQuantity) <= toNumber(item.lowStockThreshold);
}

const TX_LABELS: Record<InventoryTxType, string> = {
  delivery_in:    'Delivery In',
  usage_out:      'Usage Out',
  adjustment_in:  'Adjustment +',
  adjustment_out: 'Adjustment −',
  transfer_in:    'Transfer In',
  transfer_out:   'Transfer Out',
};

const TX_COLORS: Record<InventoryTxType, string> = {
  delivery_in:    '#22c55e',
  usage_out:      '#ef4444',
  adjustment_in:  '#3b82f6',
  adjustment_out: '#f59e0b',
  transfer_in:    '#a78bfa',
  transfer_out:   '#f97316',
};

function txSign(type: InventoryTxType): string {
  return ['delivery_in', 'adjustment_in', 'transfer_in'].includes(type) ? '+' : '−';
}

// ─── Transaction Row ──────────────────────────────────────────────────────────

function TxRow({ tx }: { tx: InventoryTransaction }) {
  const color    = TX_COLORS[tx.type];
  const sign     = txSign(tx.type);
  const absQty   = Math.abs(Number(tx.quantity));

  if (tx.type === 'usage_out') {
    const userName = tx.performedBy
      ? `${tx.performedBy.firstName} ${tx.performedBy.lastName}`
      : null;
    return (
      <View style={DV.txCard}>
        {/* Type badge + quantity */}
        <View style={DV.txCardTop}>
          <View style={[DV.txBadge, { borderColor: color + '55', backgroundColor: color + '18' }]}>
            <Text style={[DV.txBadgeText, { color }]}>Usage Out</Text>
          </View>
          <Text style={[DV.txUsageQty, { color }]}>
            {sign}{fmt(absQty)} {tx.unitOfMeasure}
          </Text>
        </View>
        {/* Usage reason */}
        {!!tx.usageReason && (
          <Text style={DV.txReason} numberOfLines={2}>{tx.usageReason}</Text>
        )}
        {/* Work area */}
        {!!tx.workArea && (
          <Text style={DV.txArea}>Area: {tx.workArea}</Text>
        )}
        {/* Notes preview */}
        {!!tx.note && (
          <Text style={DV.txNotePreview} numberOfLines={1}>{tx.note}</Text>
        )}
        {/* Footer: user · relative time */}
        <View style={DV.txCardFooter}>
          <Text style={DV.txUser}>{userName ?? '—'}</Text>
          <Text style={DV.txRelTime}>{fmtRelative(tx.createdAt)}</Text>
        </View>
      </View>
    );
  }

  // ── All other transaction types: compact original layout ──────────────────
  return (
    <View style={DV.txRow}>
      <View style={DV.txLeft}>
        <Text style={[DV.txType, { color }]}>{TX_LABELS[tx.type]}</Text>
        <Text style={DV.txMeta}>
          {tx.delivery
            ? `${tx.delivery.supplierName} · ${fmtDate(tx.delivery.deliveryDate)}`
            : tx.performedBy
              ? `${tx.performedBy.firstName} ${tx.performedBy.lastName}`
              : '—'}
        </Text>
        {!!tx.note && <Text style={DV.txNote}>{tx.note}</Text>}
        <Text style={DV.txDate}>{fmtDateTime(tx.createdAt)}</Text>
      </View>
      <Text style={[DV.txQty, { color }]}>
        {sign}{fmt(absQty)} {tx.unitOfMeasure}
      </Text>
    </View>
  );
}

// ─── Record Usage Modal ───────────────────────────────────────────────────────

function RecordUsageModal({
  visible, item, projectId, siteId, onClose, onSaved,
}: {
  visible:   boolean;
  item:      SiteInventoryItem;
  projectId: string;
  siteId:    string;
  onClose:   () => void;
  onSaved:   () => void;
}) {
  const [qty,         setQty]         = useState('');
  const [usageReason, setUsageReason] = useState('');
  const [workArea,    setWorkArea]    = useState('');
  const [note,        setNote]        = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  function reset() {
    setQty(''); setUsageReason(''); setWorkArea(''); setNote('');
    setError(null); setSaving(false);
  }
  function handleClose() { reset(); onClose(); }

  async function save() {
    setError(null);
    const n = parseFloat(qty.trim());
    if (!qty.trim() || isNaN(n) || n <= 0) {
      setError('Enter a quantity greater than 0.');
      return;
    }
    const available = Number(item.currentQuantity);
    if (n > available) {
      setError(`Insufficient stock — available: ${fmt(available)} ${item.unitOfMeasure}.`);
      return;
    }
    setSaving(true);
    try {
      await inventoryApi.recordUsage(projectId, siteId, item.id, {
        quantity:     n,
        usageReason:  usageReason.trim() || undefined,
        workArea:     workArea.trim()    || undefined,
        note:         note.trim()        || undefined,
      });
      reset();
      onSaved();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to record usage. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={UM.root}>

          {/* Header */}
          <View style={UM.header}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={UM.title}>Record Usage</Text>
              <Text style={UM.subtitle} numberOfLines={1}>{item.materialName}</Text>
            </View>
            <TouchableOpacity style={UM.closeBtn} onPress={handleClose} activeOpacity={0.7}>
              <Text style={UM.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={UM.content} keyboardShouldPersistTaps="handled">

            {/* Available stock */}
            <View style={UM.stockInfo}>
              <Text style={UM.stockInfoLabel}>Available</Text>
              <Text style={UM.stockInfoValue}>
                {fmt(Number(item.currentQuantity))} {item.unitOfMeasure}
              </Text>
            </View>

            {/* Quantity */}
            <Text style={UM.fieldLabel}>Quantity Used *</Text>
            <View style={UM.inputWrap}>
              <TextInput
                style={UM.input}
                value={qty}
                onChangeText={(t) => { setQty(t); setError(null); }}
                placeholder={`Max ${fmt(Number(item.currentQuantity))}`}
                placeholderTextColor="#1e3050"
                keyboardType="decimal-pad"
                returnKeyType="next"
              />
              <Text style={UM.inputUnit}>{item.unitOfMeasure}</Text>
            </View>

            {/* Usage Reason */}
            <Text style={[UM.fieldLabel, { marginTop: 16 }]}>Usage Reason (optional)</Text>
            <View style={UM.inputWrap}>
              <TextInput
                style={UM.input}
                value={usageReason}
                onChangeText={setUsageReason}
                placeholder="e.g. Foundation pour, Block A plastering"
                placeholderTextColor="#1e3050"
                returnKeyType="next"
              />
            </View>

            {/* Work Area */}
            <Text style={[UM.fieldLabel, { marginTop: 16 }]}>Work Area (optional)</Text>
            <View style={UM.inputWrap}>
              <TextInput
                style={UM.input}
                value={workArea}
                onChangeText={setWorkArea}
                placeholder="e.g. Block A, Foundation, Roof"
                placeholderTextColor="#1e3050"
                returnKeyType="next"
              />
            </View>

            {/* Notes */}
            <Text style={[UM.fieldLabel, { marginTop: 16 }]}>Notes (optional)</Text>
            <View style={[UM.inputWrap, { height: 80, alignItems: 'flex-start', paddingTop: 12 }]}>
              <TextInput
                style={[UM.input, { height: 56, textAlignVertical: 'top' }]}
                value={note}
                onChangeText={setNote}
                placeholder="Any additional notes"
                placeholderTextColor="#1e3050"
                multiline
              />
            </View>

            {error ? <Text style={UM.errorText}>{error}</Text> : null}

            {/* Buttons */}
            <View style={UM.btnRow}>
              <TouchableOpacity style={UM.cancelBtn} onPress={handleClose} activeOpacity={0.75}>
                <Text style={UM.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[UM.saveBtn, saving && UM.saveBtnLoading]}
                onPress={() => void save()}
                activeOpacity={0.85}
                disabled={saving}
              >
                <Text style={UM.saveBtnText}>{saving ? 'Recording…' : 'Record Usage'}</Text>
              </TouchableOpacity>
            </View>

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Set Threshold Modal ──────────────────────────────────────────────────────

function SetThresholdModal({
  visible, item, projectId, siteId, onClose, onSaved,
}: {
  visible:   boolean;
  item:      SiteInventoryItem;
  projectId: string;
  siteId:    string;
  onClose:   () => void;
  onSaved:   () => void;
}) {
  const existing = item.lowStockThreshold !== null ? String(toNumber(item.lowStockThreshold)) : '';
  const [input,    setInput]    = useState(existing);
  const [saving,   setSaving]   = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setInput(item.lowStockThreshold !== null ? String(toNumber(item.lowStockThreshold)) : '');
      setError(null);
    }
  }, [visible, item.lowStockThreshold]);

  function handleClose() { setError(null); onClose(); }

  async function save() {
    setError(null);
    const n = parseFloat(input.trim());
    if (!input.trim() || isNaN(n)) { setError('Enter a valid number.'); return; }
    if (n < 0) { setError('Threshold must be 0 or greater.'); return; }
    setSaving(true);
    try {
      await inventoryApi.updateThreshold(projectId, siteId, item.id, n);
      onSaved();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to update threshold.');
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setError(null);
    setClearing(true);
    try {
      await inventoryApi.updateThreshold(projectId, siteId, item.id, null);
      onSaved();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to clear threshold.');
    } finally {
      setClearing(false);
    }
  }

  const hasThreshold = item.lowStockThreshold !== null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={UM.root}>

          {/* Header */}
          <View style={UM.header}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={UM.title}>Set Low Stock Limit</Text>
              <Text style={UM.subtitle} numberOfLines={1}>{item.materialName}</Text>
            </View>
            <TouchableOpacity style={UM.closeBtn} onPress={handleClose} activeOpacity={0.7}>
              <Text style={UM.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={UM.content} keyboardShouldPersistTaps="handled">

            {/* Info row */}
            <View style={ST.infoRow}>
              <View style={ST.infoCell}>
                <Text style={ST.infoCellLabel}>In Stock</Text>
                <Text style={ST.infoCellValue}>{fmt(item.currentQuantity)} {item.unitOfMeasure}</Text>
              </View>
              <View style={ST.infoDivider} />
              <View style={ST.infoCell}>
                <Text style={ST.infoCellLabel}>Current Limit</Text>
                <Text style={[ST.infoCellValue, !hasThreshold && { color: '#2d4f78' }]}>
                  {hasThreshold ? `${fmt(item.lowStockThreshold!)} ${item.unitOfMeasure}` : 'Not set'}
                </Text>
              </View>
            </View>

            {/* Threshold input */}
            <Text style={UM.fieldLabel}>New Low Stock Limit</Text>
            <View style={UM.inputWrap}>
              <TextInput
                style={UM.input}
                value={input}
                onChangeText={(t) => { setInput(t); setError(null); }}
                placeholder="e.g. 10"
                placeholderTextColor="#1e3050"
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
              <Text style={UM.inputUnit}>{item.unitOfMeasure}</Text>
            </View>
            <Text style={ST.hint}>
              A warning will appear when stock falls to or below this level.
            </Text>

            {error ? <Text style={UM.errorText}>{error}</Text> : null}

            {/* Save button */}
            <TouchableOpacity
              style={[UM.saveBtn, { marginTop: 20 }, saving && UM.saveBtnLoading]}
              onPress={() => void save()}
              activeOpacity={0.85}
              disabled={saving || clearing}
            >
              <Text style={UM.saveBtnText}>{saving ? 'Saving…' : 'Save Limit'}</Text>
            </TouchableOpacity>

            {/* Clear button — only if threshold is currently set */}
            {hasThreshold && (
              <TouchableOpacity
                style={[ST.clearBtn, clearing && ST.clearBtnLoading]}
                onPress={() => void clear()}
                activeOpacity={0.75}
                disabled={saving || clearing}
              >
                <Text style={ST.clearBtnText}>{clearing ? 'Clearing…' : 'Clear Threshold'}</Text>
              </TouchableOpacity>
            )}

            {/* Cancel */}
            <TouchableOpacity style={[UM.cancelBtn, { marginTop: 10 }]} onPress={handleClose} activeOpacity={0.75}>
              <Text style={UM.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Inventory Detail View ────────────────────────────────────────────────────

function InventoryDetailView({
  item: initialItem,
  projectId,
  siteId,
  onBack,
}: {
  item:      SiteInventoryItem;
  projectId: string;
  siteId:    string;
  onBack:    () => void;
}) {
  const [detail,     setDetail]     = useState<SiteInventoryItemDetail | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal,          setShowModal]          = useState(false);
  const [showThresholdModal, setShowThresholdModal] = useState(false);

  async function load() {
    try {
      const d = await inventoryApi.get(projectId, siteId, initialItem.id);
      setDetail(d);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useEffect(() => { void load(); }, []);

  const activeItem = detail ?? initialItem;
  const low = activeItem.isLowStock ?? isLowStock(activeItem);

  return (
    <ScrollView
      style={DV.container}
      contentContainerStyle={DV.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
      }
    >
      {/* Back nav */}
      <TouchableOpacity style={DV.backBtn} onPress={onBack} activeOpacity={0.7}>
        <Text style={DV.backArrow}>‹</Text>
        <Text style={DV.backLabel}>Inventory</Text>
      </TouchableOpacity>

      {/* Header */}
      <View style={DV.headerBlock}>
        <Text style={DV.materialTitle} numberOfLines={2}>{initialItem.materialName}</Text>
        <Text style={DV.siteName}>{initialItem.site.name}</Text>
        <View style={DV.stockRow}>
          <View style={[DV.stockCard, low && DV.stockCardLow]}>
            <Text style={[DV.stockValue, low && { color: '#f59e0b' }]}>
              {fmt(activeItem.currentQuantity)}
            </Text>
            <Text style={DV.stockUnit}>{initialItem.unitOfMeasure}</Text>
            <Text style={DV.stockLabel}>In Stock</Text>
          </View>
          {activeItem.lowStockThreshold !== null && (
            <View style={DV.stockCard}>
              <Text style={[DV.stockValue, { color: '#f59e0b' }]}>
                {fmt(activeItem.lowStockThreshold)}
              </Text>
              <Text style={DV.stockUnit}>{initialItem.unitOfMeasure}</Text>
              <Text style={DV.stockLabel}>Low Stock Threshold</Text>
            </View>
          )}
        </View>
        {low && (
          <View style={DV.lowBanner}>
            <Text style={DV.lowBannerText}>⚠  Low stock — reorder soon</Text>
            <Text style={DV.lowBannerSub}>
              {fmt(activeItem.currentQuantity)} {initialItem.unitOfMeasure} remaining
              {activeItem.lowStockThreshold !== null
                ? `  ·  threshold ${fmt(activeItem.lowStockThreshold)} ${initialItem.unitOfMeasure}`
                : ''}
            </Text>
          </View>
        )}

        {/* Record Usage */}
        <TouchableOpacity style={DV.usageBtn} onPress={() => setShowModal(true)} activeOpacity={0.85}>
          <Text style={DV.usageBtnText}>Record Usage</Text>
        </TouchableOpacity>

        {/* Set Low Stock Limit */}
        <TouchableOpacity style={DV.thresholdBtn} onPress={() => setShowThresholdModal(true)} activeOpacity={0.8}>
          <Text style={DV.thresholdBtnText}>
            {activeItem.lowStockThreshold !== null ? 'Edit Low Stock Limit' : 'Set Low Stock Limit'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Transactions */}
      <View style={DV.section}>
        <Text style={DV.sectionTitle}>Recent Transactions</Text>
        {loading ? (
          <ActivityIndicator color="#3b82f6" style={{ marginTop: 20 }} />
        ) : !detail || detail.transactions.length === 0 ? (
          <Text style={DV.emptyTx}>No transactions yet.</Text>
        ) : (
          detail.transactions.map((tx) => <TxRow key={tx.id} tx={tx} />)
        )}
      </View>

      <View style={{ height: 48 }} />

      <RecordUsageModal
        visible={showModal}
        item={detail ?? initialItem}
        projectId={projectId}
        siteId={siteId}
        onClose={() => setShowModal(false)}
        onSaved={() => { setShowModal(false); void load(); }}
      />

      <SetThresholdModal
        visible={showThresholdModal}
        item={detail ?? initialItem}
        projectId={projectId}
        siteId={siteId}
        onClose={() => setShowThresholdModal(false)}
        onSaved={() => { setShowThresholdModal(false); void load(); }}
      />
    </ScrollView>
  );
}

// ─── Inventory Screen ─────────────────────────────────────────────────────────

export default function InventoryScreen() {
  const authUser         = useAuthStore((s) => s.user);
  const defaultProjectId = authUser?.defaultProjectId ?? null;
  const defaultSiteId    = authUser?.defaultSiteId    ?? null;
  const hasDefaults      = !!(defaultProjectId && defaultSiteId);

  const [view,        setView]        = useState<'list' | 'detail'>('list');
  const [selected,    setSelected]    = useState<SiteInventoryItem | null>(null);
  const [items,       setItems]       = useState<SiteInventoryItem[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);

  const [projects,    setProjects]    = useState<Project[]>([]);
  const [sites,       setSites]       = useState<JobSite[]>([]);
  const [projectId,   setProjectId]   = useState(defaultProjectId ?? '');
  const [siteId,      setSiteId]      = useState(defaultSiteId ?? '');

  useEffect(() => {
    if (hasDefaults) {
      void load(defaultProjectId!, defaultSiteId!);
      return;
    }
    projectsApi.list().then((p) => setProjects(p ?? [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function onProjectChange(pid: string) {
    setProjectId(pid); setSiteId(''); setItems([]);
    try {
      const s = await projectsApi.listSites(pid);
      setSites(Array.isArray(s) ? s : []);
    } catch { setSites([]); }
  }

  async function load(pid: string, sid: string) {
    if (!pid || !sid) return;
    setLoading(true);
    try {
      const data = await inventoryApi.list(pid, sid);
      setItems(data);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }

  async function onSiteChange(sid: string) {
    setSiteId(sid); setItems([]);
    await load(projectId, sid);
  }

  async function onRefresh() {
    setRefreshing(true);
    await load(projectId, siteId);
    setRefreshing(false);
  }

  if (view === 'detail' && selected) {
    return (
      <Screen>
        <InventoryDetailView
          item={selected}
          projectId={projectId}
          siteId={siteId}
          onBack={() => { setView('list'); void load(projectId, siteId); }}
        />
      </Screen>
    );
  }

  const lowItems = items.filter((i) => i.isLowStock ?? isLowStock(i));

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Inventory</Text>
      </View>

      {!hasDefaults && (
        <>
          {/* Project picker */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterBar}
            contentContainerStyle={styles.filterBarContent}
          >
            {projects.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.filterChip, projectId === p.id && styles.filterChipActive]}
                onPress={() => void onProjectChange(p.id)}
              >
                <Text style={[styles.filterChipText, projectId === p.id && styles.filterChipTextActive]}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Site picker */}
          {sites.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterBar}
              contentContainerStyle={styles.filterBarContent}
            >
              {sites.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.filterChip, siteId === s.id && styles.filterChipActive]}
                  onPress={() => void onSiteChange(s.id)}
                >
                  <Text style={[styles.filterChipText, siteId === s.id && styles.filterChipTextActive]}>
                    {s.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </>
      )}

      {/* Low stock summary banner */}
      {lowItems.length > 0 && (
        <View style={styles.lowBanner}>
          <Text style={styles.lowBannerText}>
            ⚠  {lowItems.length} item{lowItems.length > 1 ? 's' : ''} below low-stock threshold
          </Text>
        </View>
      )}

      {items.length > 0 && (
        <Text style={styles.countText}>{items.length} material{items.length > 1 ? 's' : ''}</Text>
      )}

      <View style={styles.listArea}>
        {loading ? (
          <LoadingSpinner />
        ) : items.length === 0 ? (
          <EmptyState
            title={!projectId ? 'Select a project' : !siteId ? 'Select a site' : 'No inventory'}
            description={
              !projectId ? 'Choose a project above to view its inventory.' :
              !siteId    ? 'Choose a site above to view its inventory.'    :
                           'Inventory is created automatically when accepted deliveries are recorded.'
            }
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
            }
            renderItem={({ item }) => {
              const low = item.isLowStock ?? isLowStock(item);
              return (
                <TouchableOpacity onPress={() => { setSelected(item); setView('detail'); }} activeOpacity={0.75}>
                  <Card style={[styles.itemCard, low ? styles.itemCardLow : null]}>
                    <View style={styles.itemRow}>
                      <Text style={styles.materialName} numberOfLines={1}>{item.materialName}</Text>
                      {low && (
                        <View style={styles.lowBadge}>
                          <Text style={styles.lowBadgeText}>LOW</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.qtyRow}>
                      <Text style={[styles.qtyValue, low && { color: '#f59e0b' }]}>
                        {fmt(item.currentQuantity)}
                      </Text>
                      <Text style={styles.qtyUnit}> {item.unitOfMeasure}</Text>
                    </View>
                    {item.lowStockThreshold !== null && (
                      <Text style={styles.thresholdText}>
                        Threshold: {fmt(item.lowStockThreshold)} {item.unitOfMeasure}
                      </Text>
                    )}
                  </Card>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </Screen>
  );
}

// ─── List styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  pageTitle: { color: '#f1f5f9', fontSize: 22, fontWeight: '700' },

  filterBar:            { flexGrow: 0, flexShrink: 0, alignSelf: 'stretch' },
  filterBarContent:     { paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  filterChip:           { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', flexShrink: 0 },
  filterChipActive:     { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  filterChipText:       { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#fff',    fontSize: 12, fontWeight: '600' },

  lowBanner:     { marginHorizontal: 16, marginBottom: 8, backgroundColor: '#1c1000', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#92400e' },
  lowBannerText: { color: '#f59e0b', fontSize: 12, fontWeight: '700' },

  countText: { color: '#64748b', fontSize: 12, paddingHorizontal: 16, marginBottom: 4 },

  listArea:     { flex: 1, overflow: 'hidden' },
  list:         { padding: 16, paddingBottom: 32 },
  itemCard:    { marginBottom: 8 },
  itemCardLow: { borderWidth: 1, borderColor: '#92400e' },
  itemRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  materialName: { color: '#f1f5f9', fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },

  lowBadge:     { backgroundColor: '#1c1000', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#92400e' },
  lowBadgeText: { color: '#f59e0b', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  qtyRow:        { flexDirection: 'row', alignItems: 'baseline' },
  qtyValue:      { color: '#3b82f6', fontSize: 24, fontWeight: '800' },
  qtyUnit:       { color: '#4a7ab5', fontSize: 14, fontWeight: '600' },
  thresholdText: { color: '#475569', fontSize: 11, marginTop: 4 },
});

// ─── Detail styles ────────────────────────────────────────────────────────────

const DV = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060d1b' },
  scroll:    { paddingBottom: 20 },

  backBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 16, paddingBottom: 8 },
  backArrow: { color: '#3b82f6', fontSize: 24, lineHeight: 26 },
  backLabel: { color: '#3b82f6', fontSize: 15, fontWeight: '600' },

  headerBlock:   { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#0d1e35' },
  materialTitle: { color: '#dde9f8', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  siteName:      { color: '#4a7ab5', fontSize: 13, marginTop: 4, marginBottom: 14 },

  stockRow:   { flexDirection: 'row', gap: 12 },
  stockCard:  { flex: 1, backgroundColor: '#0a1628', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#142238', alignItems: 'center' },
  stockValue: { color: '#3b82f6', fontSize: 28, fontWeight: '800' },
  stockUnit:  { color: '#4a7ab5', fontSize: 12, fontWeight: '600', marginTop: 2 },
  stockLabel: { color: '#2d4f78', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },

  lowBanner:     { marginTop: 12, backgroundColor: '#1c1000', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#92400e' },
  lowBannerText: { color: '#f59e0b', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  lowBannerSub:  { color: '#b45309', fontSize: 11, textAlign: 'center', marginTop: 3 },

  stockCardLow: { borderWidth: 1, borderColor: '#92400e' },

  usageBtn:     { marginTop: 14, backgroundColor: '#1d4ed8', borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#2563eb' },
  usageBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  thresholdBtn:     { marginTop: 8, borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: '#1e3a6e', backgroundColor: '#0a1628' },
  thresholdBtnText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },

  section:      { marginHorizontal: 18, marginTop: 20 },
  sectionTitle: { color: '#3d6090', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 },

  emptyTx: { color: '#2d4f78', fontSize: 13, marginTop: 8 },

  // ── compact row (non-usage types) ──
  txRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0d1e35', gap: 12 },
  txLeft: { flex: 1 },
  txType: { fontSize: 13, fontWeight: '700' },
  txMeta: { color: '#4a7ab5', fontSize: 12, marginTop: 2 },
  txNote: { color: '#2d4f78', fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  txDate: { color: '#1e3050', fontSize: 10, marginTop: 4 },
  txQty:  { fontSize: 14, fontWeight: '800', marginTop: 2 },

  // ── usage_out card ──
  txCard:       { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0d1e35' },
  txCardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  txBadge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  txBadgeText:  { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  txUsageQty:   { fontSize: 18, fontWeight: '800' },
  txReason:     { color: '#cbd5e1', fontSize: 13, fontWeight: '600', marginBottom: 3 },
  txArea:       { color: '#4a7ab5', fontSize: 11, marginBottom: 2 },
  txNotePreview:{ color: '#3d6090', fontSize: 11, fontStyle: 'italic', marginBottom: 4 },
  txCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  txUser:       { color: '#3d6090', fontSize: 11 },
  txRelTime:    { color: '#2d4f78', fontSize: 10 },
});

// ─── Set Threshold Modal styles ───────────────────────────────────────────────

const ST = StyleSheet.create({
  infoRow:     { flexDirection: 'row', backgroundColor: '#0a1628', borderRadius: 10, borderWidth: 1, borderColor: '#142238', marginBottom: 20, overflow: 'hidden' },
  infoCell:    { flex: 1, padding: 14, alignItems: 'center' },
  infoDivider: { width: 1, backgroundColor: '#142238' },
  infoCellLabel: { color: '#3d6090', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  infoCellValue: { color: '#3b82f6', fontSize: 16, fontWeight: '800' },

  hint: { color: '#2d4f78', fontSize: 11, marginTop: 6, marginBottom: 4, lineHeight: 16 },

  clearBtn:        { marginTop: 10, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#7f1d1d', backgroundColor: '#150a0a' },
  clearBtnLoading: { borderColor: '#3d0f0f', backgroundColor: '#0d0606' },
  clearBtnText:    { color: '#ef4444', fontSize: 15, fontWeight: '600' },
});

// ─── Usage Modal styles ───────────────────────────────────────────────────────

const UM = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060d1b' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0e1f38',
  },
  title:        { color: '#e8f0fe', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  subtitle:     { color: '#2d5070', fontSize: 12, fontWeight: '500', marginTop: 2 },
  closeBtn:     { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0a1628', borderWidth: 1, borderColor: '#142240', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#3d6090', fontSize: 15, fontWeight: '600' },

  content: { padding: 20, paddingBottom: 56 },

  stockInfo:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0a1628', borderRadius: 10, borderWidth: 1, borderColor: '#142238', padding: 14, marginBottom: 20 },
  stockInfoLabel: { color: '#3d6090', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  stockInfoValue: { color: '#3b82f6', fontSize: 20, fontWeight: '800' },

  fieldLabel: { color: '#3d6090', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  inputWrap:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#060e1c', borderRadius: 12, borderWidth: 1, borderColor: '#112036', paddingHorizontal: 14, height: 52, gap: 10, marginBottom: 4 },
  input:      { flex: 1, color: '#d0e0f5', fontSize: 15, padding: 0 },
  inputUnit:  { color: '#2d4f78', fontSize: 14, fontWeight: '600' },

  errorText: { color: '#ef4444', fontSize: 13, marginTop: 10, marginBottom: 2 },

  btnRow:        { flexDirection: 'row', gap: 10, marginTop: 24 },
  cancelBtn:     { flex: 1, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: '#142240', backgroundColor: '#0a1628' },
  cancelBtnText: { color: '#3d6090', fontSize: 15, fontWeight: '600' },
  saveBtn:        { flex: 2, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: '#2563eb', backgroundColor: '#1d4ed8' },
  saveBtnLoading: { backgroundColor: '#1e3a70', borderColor: '#1e3a70' },
  saveBtnText:    { color: '#fff', fontSize: 15, fontWeight: '700' },
});
