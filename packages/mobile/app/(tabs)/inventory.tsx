/**
 * Inventory tab — read-only site material stock viewer.
 * Shows per-material current quantity, low-stock warnings, and transaction history.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, ActivityIndicator,
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

function fmt(n: number): string {
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
  return item.lowStockThreshold !== null && item.currentQuantity <= item.lowStockThreshold;
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
  const [detail,    setDetail]    = useState<SiteInventoryItemDetail | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
          onBack={() => setView('list')}
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
