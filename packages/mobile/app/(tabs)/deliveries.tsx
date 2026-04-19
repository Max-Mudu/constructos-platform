/**
 * Deliveries tab — supervisor / PM / admin only
 * Phase 3: search bar, acceptance status filters, pagination.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Modal,
  ScrollView, Image, RefreshControl, TextInput, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { deliveriesApi } from '../../src/api/deliveries';
import { projectsApi } from '../../src/api/projects';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { Badge } from '../../src/components/Badge';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { EmptyState } from '../../src/components/EmptyState';
import { DeliveryRecord, Project, JobSite } from '../../src/types';

const PAGE_SIZE = 25;

// ─── Create Delivery Modal ────────────────────────────────────────────────────

function CreateDeliveryModal({
  visible, onClose, onSaved,
}: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [projects,     setProjects]     = useState<Project[]>([]);
  const [sites,        setSites]        = useState<JobSite[]>([]);
  const [projectId,    setProjectId]    = useState('');
  const [siteId,       setSiteId]       = useState('');
  const [supplier,     setSupplier]     = useState('');
  const [date,         setDate]         = useState(new Date().toISOString().split('T')[0]!);
  const [description,  setDescription]  = useState('');
  const [qtyOrdered,   setQtyOrdered]   = useState('');
  const [qtyDelivered, setQtyDelivered] = useState('');
  const [unit,         setUnit]         = useState('');
  const [condition,    setCondition]    = useState('good');
  const [notes,        setNotes]        = useState('');
  const [photoUri,     setPhotoUri]     = useState<string | null>(null);
  const [saving,       setSaving]       = useState(false);

  useEffect(() => {
    if (!visible) return;
    projectsApi.list().then(setProjects).catch(() => {});
  }, [visible]);

  async function onProjectChange(pid: string) {
    setProjectId(pid); setSiteId('');
    try { setSites(await projectsApi.listSites(pid)); } catch { setSites([]); }
  }

  async function pickPhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission Required', 'Camera access is needed.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function save() {
    if (!projectId || !siteId || !supplier.trim() || !description.trim()) {
      Alert.alert('Validation', 'Project, site, supplier, and description are required'); return;
    }
    setSaving(true);
    try {
      const record = await deliveriesApi.create({
        projectId, siteId,
        supplierName:       supplier.trim(),
        deliveryDate:       date,
        itemDescription:    description.trim(),
        quantityOrdered:    parseFloat(qtyOrdered)   || 1,
        quantityDelivered:  parseFloat(qtyDelivered) || 1,
        unitOfMeasure:      unit.trim() || 'units',
        conditionOnArrival: condition,
        acceptanceStatus:   'accepted',
        notes:              notes || undefined,
      });
      if (photoUri) {
        try { await deliveriesApi.uploadPhoto(record.id, photoUri); }
        catch { Alert.alert('Note', 'Delivery created but photo upload failed.'); }
      }
      onSaved(); onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create delivery';
      Alert.alert('Error', msg);
    } finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New Delivery</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Project *</Text>
          {projects.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.selectItem, projectId === p.id && styles.selectItemActive]}
              onPress={() => void onProjectChange(p.id)}
            >
              <Text style={styles.selectItemText}>{p.name}</Text>
              {projectId === p.id && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}

          {sites.length > 0 && (
            <>
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Site *</Text>
              {sites.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.selectItem, siteId === s.id && styles.selectItemActive]}
                  onPress={() => setSiteId(s.id)}
                >
                  <Text style={styles.selectItemText}>{s.name}</Text>
                  {siteId === s.id && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))}
            </>
          )}

          <Input label="Supplier Name *" value={supplier} onChangeText={setSupplier} placeholder="Acme Supplies Ltd" />
          <Input label="Delivery Date *" value={date} onChangeText={setDate} placeholder="2026-04-17" />
          <Input label="Item Description *" value={description} onChangeText={setDescription} placeholder="Portland cement 50kg bags" multiline />
          <Input label="Qty Ordered" value={qtyOrdered} onChangeText={setQtyOrdered} keyboardType="decimal-pad" placeholder="100" />
          <Input label="Qty Delivered" value={qtyDelivered} onChangeText={setQtyDelivered} keyboardType="decimal-pad" placeholder="100" />
          <Input label="Unit of Measure" value={unit} onChangeText={setUnit} placeholder="bags" />
          <Input label="Condition on Arrival" value={condition} onChangeText={setCondition} placeholder="good / damaged" />
          <Input label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Any notes..." multiline />

          <Text style={[styles.fieldLabel, { marginTop: 4 }]}>Delivery Photo (optional)</Text>
          {photoUri ? (
            <View style={styles.photoWrap}>
              <Image source={{ uri: photoUri }} style={styles.photo} />
              <TouchableOpacity onPress={() => setPhotoUri(null)} style={styles.removePhoto}>
                <Text style={styles.removePhotoText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.cameraBtn} onPress={pickPhoto}>
              <Text style={styles.cameraBtnText}>📷  Take Photo</Text>
            </TouchableOpacity>
          )}

          <Button title="Create Delivery" onPress={save} loading={saving} style={{ marginTop: 16 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

const ACCEPTANCE_FILTERS = [
  { label: 'All',      value: ''                   },
  { label: 'Accepted', value: 'accepted'            },
  { label: 'Partial',  value: 'partially_accepted'  },
  { label: 'Rejected', value: 'rejected'            },
  { label: 'Pending',  value: 'pending_inspection'  },
];

// ─── Deliveries List ──────────────────────────────────────────────────────────

export default function DeliveriesScreen() {
  const [records,       setRecords]       = useState<DeliveryRecord[]>([]);
  const [total,         setTotal]         = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [loadingMore,   setLoadingMore]   = useState(false);
  const [showModal,     setShowModal]     = useState(false);
  const [search,        setSearch]        = useState('');
  const [statusFilter,  setStatusFilter]  = useState('');
  const [offset,        setOffset]        = useState(0);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  async function load(opts: { reset?: boolean; searchVal?: string; statusF?: string } = {}) {
    const searchQ   = opts.searchVal ?? search;
    const statusQ   = opts.statusF   ?? statusFilter;
    const newOffset = opts.reset ? 0 : offset;

    try {
      const res = await deliveriesApi.list({
        search:           searchQ || undefined,
        acceptanceStatus: statusQ || undefined,
        limit:  PAGE_SIZE,
        offset: newOffset,
      });
      if (opts.reset || newOffset === 0) {
        setRecords(res.records);
      } else {
        setRecords((prev) => [...prev, ...res.records]);
      }
      setTotal(res.pagination.total);
      setOffset(newOffset + res.records.length);
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    load({ reset: true }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRefresh() {
    setRefreshing(true); setOffset(0);
    await load({ reset: true });
    setRefreshing(false);
  }

  async function onLoadMore() {
    if (loadingMore || records.length >= total) return;
    setLoadingMore(true);
    await load();
    setLoadingMore(false);
  }

  function onSearchChange(text: string) {
    setSearch(text);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setOffset(0);
      void load({ reset: true, searchVal: text });
    }, 350);
  }

  function onStatusFilterChange(f: string) {
    setStatusFilter(f); setOffset(0);
    void load({ reset: true, statusF: f });
  }

  if (loading) return <LoadingSpinner />;

  const hasMore = records.length < total;

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Deliveries</Text>
        <Button title="+ Add" onPress={() => setShowModal(true)} variant="secondary" style={{ height: 36, paddingHorizontal: 12 }} />
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search supplier..."
          placeholderTextColor="#475569"
          value={search}
          onChangeText={onSearchChange}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => onSearchChange('')} style={styles.searchClear}>
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Acceptance status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
      >
        {ACCEPTANCE_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.filterChip, statusFilter === f.value && styles.filterChipActive]}
            onPress={() => onStatusFilterChange(f.value)}
          >
            <Text style={[styles.filterChipText, statusFilter === f.value && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Count */}
      {total > 0 && (
        <Text style={styles.countText}>{total} deliveries{search ? ` for "${search}"` : ''}</Text>
      )}

      {records.length === 0
        ? <EmptyState title="No deliveries" description={search ? `No results for "${search}"` : 'Tap + Add to record a new delivery.'} />
        : (
          <FlatList
            data={records}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => (
              <Card style={styles.recordCard}>
                <View style={styles.recordRow}>
                  <Text style={styles.supplierName}>{item.supplierName}</Text>
                  <Badge
                    label={item.acceptanceStatus}
                    variant={item.acceptanceStatus === 'accepted' ? 'success' : item.acceptanceStatus === 'rejected' ? 'error' : 'warning'}
                  />
                </View>
                <Text style={styles.recordMeta}>{item.itemDescription}</Text>
                <Text style={styles.recordMeta}>
                  {item.deliveryDate} ·{' '}
                  {item.quantityDelivered}/{item.quantityOrdered} {item.unitOfMeasure}
                </Text>
              </Card>
            )}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
            onEndReached={onLoadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              hasMore ? (
                <View style={styles.footer}>
                  {loadingMore
                    ? <ActivityIndicator size="small" color="#3b82f6" />
                    : <TouchableOpacity onPress={onLoadMore} style={styles.loadMoreBtn}>
                        <Text style={styles.loadMoreText}>Load More ({total - records.length} remaining)</Text>
                      </TouchableOpacity>
                  }
                </View>
              ) : null
            }
          />
        )
      }

      <CreateDeliveryModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onSaved={() => { setOffset(0); void load({ reset: true }); }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  pageTitle: { color: '#f1f5f9', fontSize: 22, fontWeight: '700' },

  searchRow:       { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 12 },
  searchInput:     { flex: 1, color: '#f1f5f9', fontSize: 14, paddingVertical: 10 },
  searchClear:     { padding: 4 },
  searchClearText: { color: '#64748b', fontSize: 14 },

  filterBar:         { flexGrow: 0 },
  filterBarContent:  { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  filterChip:        { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  filterChipActive:  { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  filterChipText:       { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#fff',    fontSize: 12, fontWeight: '600' },

  countText: { color: '#64748b', fontSize: 12, paddingHorizontal: 16, marginBottom: 4 },

  list:         { padding: 16, paddingBottom: 32 },
  recordCard:   { marginBottom: 8 },
  recordRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  supplierName: { color: '#f1f5f9', fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  recordMeta:   { color: '#94a3b8', fontSize: 12, marginTop: 2 },

  footer:       { alignItems: 'center', paddingVertical: 16 },
  loadMoreBtn:  { backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#334155' },
  loadMoreText: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },

  modal: { flex: 1, backgroundColor: '#0f172a' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#334155' },
  modalTitle:  { color: '#f1f5f9', fontSize: 18, fontWeight: '700' },
  modalClose:  { color: '#94a3b8', fontSize: 20, padding: 4 },

  fieldLabel:       { color: '#94a3b8', fontSize: 13, fontWeight: '500', marginBottom: 8 },
  selectItem:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e293b', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#334155', marginBottom: 8 },
  selectItemActive: { borderColor: '#3b82f6', backgroundColor: '#1e3a5f' },
  selectItemText:   { color: '#f1f5f9', fontSize: 14, flex: 1 },
  checkmark:        { color: '#3b82f6', fontSize: 16 },

  cameraBtn:       { backgroundColor: '#1e293b', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#334155', alignItems: 'center', marginBottom: 8 },
  cameraBtnText:   { color: '#f1f5f9', fontSize: 14 },
  photoWrap:       { marginBottom: 12 },
  photo:           { width: '100%', height: 180, borderRadius: 8, marginBottom: 6 },
  removePhoto:     { alignSelf: 'flex-end' },
  removePhotoText: { color: '#ef4444', fontSize: 13 },
});
