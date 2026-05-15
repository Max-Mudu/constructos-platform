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
  const color = TX_COLORS[tx.type];
  const sign  = txSign(tx.type);
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
        {tx.note ? <Text style={DV.txNote}>{tx.note}</Text> : null}
        <Text style={DV.txDate}>{fmtDateTime(tx.createdAt)}</Text>
      </View>
      <Text style={[DV.txQty, { color }]}>
        {sign}{fmt(tx.quantity)} {tx.unitOfMeasure}
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
  const [qty,    setQty]    = useState('');
  const [note,   setNote]   = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  function reset() { setQty(''); setNote(''); setError(null); setSaving(false); }
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
        quantity: n,
        note:     note.trim() || undefined,
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
            <Text style={UM.fieldLabel}>Quantity Used</Text>
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

            {/* Note */}
            <Text style={[UM.fieldLabel, { marginTop: 16 }]}>Reason / Note (optional)</Text>
            <View style={[UM.inputWrap, { height: 80, alignItems: 'flex-start', paddingTop: 12 }]}>
              <TextInput
                style={[UM.input, { height: 56, textAlignVertical: 'top' }]}
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Foundation pour, Block A"
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
  const [showModal,  setShowModal]  = useState(false);

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

  const low = isLowStock(initialItem);

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
          <View style={DV.stockCard}>
            <Text style={DV.stockValue}>
              {fmt(detail?.currentQuantity ?? initialItem.currentQuantity)}
            </Text>
            <Text style={DV.stockUnit}>{initialItem.unitOfMeasure}</Text>
            <Text style={DV.stockLabel}>In Stock</Text>
          </View>
          {initialItem.lowStockThreshold !== null && (
            <View style={DV.stockCard}>
              <Text style={[DV.stockValue, { color: '#f59e0b' }]}>
                {fmt(initialItem.lowStockThreshold)}
              </Text>
              <Text style={DV.stockUnit}>{initialItem.unitOfMeasure}</Text>
              <Text style={DV.stockLabel}>Low Stock Threshold</Text>
            </View>
          )}
        </View>
        {low && (
          <View style={DV.lowBanner}>
            <Text style={DV.lowBannerText}>⚠  Stock below threshold</Text>
          </View>
        )}

        {/* Record Usage */}
        <TouchableOpacity style={DV.usageBtn} onPress={() => setShowModal(true)} activeOpacity={0.85}>
          <Text style={DV.usageBtnText}>Record Usage</Text>
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
    </ScrollView>
  );
}

// ─── Inventory Screen ─────────────────────────────────────────────────────────

export default function InventoryScreen() {
  const [view,        setView]        = useState<'list' | 'detail'>('list');
  const [selected,    setSelected]    = useState<SiteInventoryItem | null>(null);
  const [items,       setItems]       = useState<SiteInventoryItem[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);

  const [projects,    setProjects]    = useState<Project[]>([]);
  const [sites,       setSites]       = useState<JobSite[]>([]);
  const [projectId,   setProjectId]   = useState('');
  const [siteId,      setSiteId]      = useState('');

  useEffect(() => {
    projectsApi.list().then((p) => setProjects(p ?? [])).catch(() => {});
  }, []);

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

  const lowItems = items.filter(isLowStock);

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Inventory</Text>
      </View>

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
              const low = isLowStock(item);
              return (
                <TouchableOpacity onPress={() => { setSelected(item); setView('detail'); }} activeOpacity={0.75}>
                  <Card style={styles.itemCard}>
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
  itemCard:     { marginBottom: 8 },
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

  usageBtn:     { marginTop: 14, backgroundColor: '#1d4ed8', borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: '#2563eb' },
  usageBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  section:      { marginHorizontal: 18, marginTop: 20 },
  sectionTitle: { color: '#3d6090', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 },

  emptyTx: { color: '#2d4f78', fontSize: 13, marginTop: 8 },

  txRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0d1e35', gap: 12 },
  txLeft: { flex: 1 },
  txType: { fontSize: 13, fontWeight: '700' },
  txMeta: { color: '#4a7ab5', fontSize: 12, marginTop: 2 },
  txNote: { color: '#2d4f78', fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  txDate: { color: '#1e3050', fontSize: 10, marginTop: 4 },
  txQty:  { fontSize: 14, fontWeight: '800', marginTop: 2 },
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
