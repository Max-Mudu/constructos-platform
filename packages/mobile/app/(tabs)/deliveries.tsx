/**
 * Deliveries tab — supervisor / PM / admin only
 * Phase 4: delivery detail + inspection/acceptance workflow.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Modal,
  ScrollView, Image, RefreshControl, TextInput, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { apiClient } from '../../src/api/client';
import { deliveriesApi } from '../../src/api/deliveries';
import { projectsApi } from '../../src/api/projects';
import { useAuthStore } from '../../src/store/auth.store';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { Badge } from '../../src/components/Badge';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { EmptyState } from '../../src/components/EmptyState';
import {
  DeliveryRecord, InspectionStatus, AcceptanceStatus, Project, JobSite,
} from '../../src/types';

const PAGE_SIZE = 25;
const BASE_URL  = process.env['EXPO_PUBLIC_API_URL']?.replace('/api/v1', '') ?? 'http://10.0.2.2:3000';

// ─── Option configs ───────────────────────────────────────────────────────────

const INSPECTION_OPTIONS: {
  value: InspectionStatus; label: string; color: string; bg: string; border: string;
}[] = [
  { value: 'pending', label: 'Pending', color: '#94a3b8', bg: '#0a1525', border: '#334155' },
  { value: 'passed',  label: 'Passed',  color: '#22c55e', bg: '#052e16', border: '#166534' },
  { value: 'failed',  label: 'Failed',  color: '#ef4444', bg: '#1c0a0a', border: '#7f1d1d' },
  { value: 'waived',  label: 'Waived',  color: '#a78bfa', bg: '#140d2b', border: '#4c1d95' },
];

const ACCEPTANCE_OPTIONS: {
  value: AcceptanceStatus; label: string; color: string; bg: string; border: string;
}[] = [
  { value: 'accepted',           label: 'Accept',         color: '#22c55e', bg: '#052e16', border: '#166534' },
  { value: 'partially_accepted', label: 'Partial Accept', color: '#f59e0b', bg: '#1c1000', border: '#92400e' },
  { value: 'rejected',           label: 'Reject',         color: '#ef4444', bg: '#1c0a0a', border: '#7f1d1d' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return s; }
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={DV.infoRow}>
      <Text style={DV.infoLabel}>{label}</Text>
      <Text style={DV.infoValue} numberOfLines={4}>{value}</Text>
    </View>
  );
}

// ─── Delivery Detail View ─────────────────────────────────────────────────────

function DeliveryDetailView({
  record, onBack, onUpdated,
}: {
  record:    DeliveryRecord;
  onBack:    () => void;
  onUpdated: (updated: DeliveryRecord) => void;
}) {
  const [inspection,  setInspection]  = useState<InspectionStatus>(record.inspectionStatus);
  const [acceptance,  setAcceptance]  = useState<AcceptanceStatus | null>(record.acceptanceStatus);
  // quantityAccepted: UI-only — backend field does not exist yet; reserved for inventory phase
  const [qtyAccepted, setQtyAccepted] = useState('');
  const [rejection,   setRejection]   = useState(record.rejectionReason  ?? '');
  const [discrepancy, setDiscrepancy] = useState(record.discrepancyNotes ?? '');
  const [saving,      setSaving]      = useState(false);

  const isDirty =
    inspection  !== record.inspectionStatus         ||
    acceptance  !== record.acceptanceStatus         ||
    rejection   !== (record.rejectionReason  ?? '') ||
    discrepancy !== (record.discrepancyNotes ?? '');

  async function save() {
    if (acceptance === 'rejected' && !rejection.trim()) {
      Alert.alert('Required', 'Please enter a rejection reason.'); return;
    }
    setSaving(true);
    try {
      const res = await apiClient.patch<{ delivery: DeliveryRecord }>(
        `/projects/${record.projectId}/sites/${record.siteId}/deliveries/${record.id}`,
        {
          inspectionStatus: inspection,
          acceptanceStatus: acceptance,
          rejectionReason:  rejection.trim()  || null,
          discrepancyNotes: discrepancy.trim() || null,
        },
      );
      onUpdated(res.data.delivery);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Failed to save changes';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  }

  const inspCfg = INSPECTION_OPTIONS.find((o) => o.value === inspection) ?? INSPECTION_OPTIONS[0]!;
  const acptCfg = acceptance !== null
    ? (ACCEPTANCE_OPTIONS.find((o) => o.value === acceptance) ?? ACCEPTANCE_OPTIONS[0]!)
    : null;

  return (
    <ScrollView
      style={DV.container}
      contentContainerStyle={DV.scroll}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Back nav ──────────────────────────────────────────────── */}
      <TouchableOpacity style={DV.backBtn} onPress={onBack} activeOpacity={0.7}>
        <Text style={DV.backArrow}>‹</Text>
        <Text style={DV.backLabel}>Deliveries</Text>
      </TouchableOpacity>

      {/* ── Header ────────────────────────────────────────────────── */}
      <View style={DV.headerBlock}>
        <Text style={DV.supplierTitle} numberOfLines={2}>{record.supplierName}</Text>
        <Text style={DV.deliveryDate}>{fmtDate(record.deliveryDate)}</Text>
        <View style={DV.statusRow}>
          <View style={[DV.statusPill, { backgroundColor: inspCfg.bg, borderColor: inspCfg.border }]}>
            <Text style={[DV.statusPillText, { color: inspCfg.color }]}>Insp: {inspCfg.label}</Text>
          </View>
          {acptCfg !== null ? (
            <View style={[DV.statusPill, { backgroundColor: acptCfg.bg, borderColor: acptCfg.border }]}>
              <Text style={[DV.statusPillText, { color: acptCfg.color }]}>{acptCfg.label}</Text>
            </View>
          ) : (
            <View style={[DV.statusPill, { backgroundColor: '#0d1525', borderColor: '#1e3050' }]}>
              <Text style={[DV.statusPillText, { color: '#3d6090' }]}>Awaiting Decision</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Delivery details ──────────────────────────────────────── */}
      <View style={DV.section}>
        <Text style={DV.sectionTitle}>Delivery Details</Text>
        <InfoRow label="Item / Material"  value={record.itemDescription} />
        <InfoRow label="Qty Ordered"      value={`${record.quantityOrdered} ${record.unitOfMeasure}`} />
        <InfoRow label="Qty Delivered"    value={`${record.quantityDelivered} ${record.unitOfMeasure}`} />
        <InfoRow label="Condition"        value={record.conditionOnArrival} />
        {record.driverName          ? <InfoRow label="Driver"   value={record.driverName}          /> : null}
        {record.deliveryNoteNumber  ? <InfoRow label="DN #"     value={record.deliveryNoteNumber}  /> : null}
        {record.purchaseOrderNumber ? <InfoRow label="PO #"     value={record.purchaseOrderNumber} /> : null}
        {(record.comments ?? record.notes)
          ? <InfoRow label="Notes" value={(record.comments ?? record.notes)!} />
          : null}
        {record.receivedBy && (
          <InfoRow
            label="Received By"
            value={`${record.receivedBy.firstName} ${record.receivedBy.lastName}`}
          />
        )}
      </View>

      {/* ── Photos ────────────────────────────────────────────────── */}
      {record.photos.length > 0 && (
        <View style={DV.section}>
          <Text style={DV.sectionTitle}>Photos ({record.photos.length})</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={DV.photoRow}
          >
            {record.photos.map((p) => (
              <Image
                key={p.id}
                source={{ uri: p.fileUrl.startsWith('http') ? p.fileUrl : `${BASE_URL}${p.fileUrl}` }}
                style={DV.photoThumb}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Inspection controls ───────────────────────────────────── */}
      <View style={DV.section}>
        <Text style={DV.sectionTitle}>Inspection</Text>
        <View style={DV.optionGrid}>
          {INSPECTION_OPTIONS.map((o) => (
            <TouchableOpacity
              key={o.value}
              style={[
                DV.optionBtn,
                inspection === o.value && { backgroundColor: o.bg, borderColor: o.border },
              ]}
              onPress={() => setInspection(o.value)}
              activeOpacity={0.75}
            >
              {inspection === o.value && (
                <View style={[DV.optionDot, { backgroundColor: o.color }]} />
              )}
              <Text style={[DV.optionBtnText, inspection === o.value && { color: o.color }]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Acceptance controls ───────────────────────────────────── */}
      <View style={DV.section}>
        <Text style={DV.sectionTitle}>Acceptance</Text>
        <View style={DV.optionRow}>
          {ACCEPTANCE_OPTIONS.map((o) => (
            <TouchableOpacity
              key={o.value}
              style={[
                DV.optionBtnFull,
                acceptance === o.value && { backgroundColor: o.bg, borderColor: o.border },
              ]}
              onPress={() => setAcceptance(o.value)}
              activeOpacity={0.75}
            >
              {acceptance === o.value && (
                <View style={[DV.optionDot, { backgroundColor: o.color }]} />
              )}
              <Text style={[DV.optionBtnText, acceptance === o.value && { color: o.color }]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Partial: qty accepted — UI-only, no backend field yet */}
        {acceptance !== null && acceptance === 'partially_accepted' && (
          <View style={DV.conditionalBlock}>
            <Text style={DV.conditionalLabel}>
              Quantity Accepted{' '}
              <Text style={DV.conditionalHint}>(UI preview — backend field pending)</Text>
            </Text>
            <TextInput
              style={DV.conditionalInput}
              value={qtyAccepted}
              onChangeText={setQtyAccepted}
              placeholder={`of ${record.quantityDelivered} ${record.unitOfMeasure}`}
              placeholderTextColor="#2d4060"
              keyboardType="decimal-pad"
            />
          </View>
        )}

        {/* Rejected: reason + discrepancy */}
        {acceptance !== null && acceptance === 'rejected' && (
          <View style={DV.conditionalBlock}>
            <Text style={DV.conditionalLabel}>Rejection Reason *</Text>
            <TextInput
              style={[DV.conditionalInput, { minHeight: 72, textAlignVertical: 'top' }]}
              value={rejection}
              onChangeText={setRejection}
              placeholder="Why was this delivery rejected?"
              placeholderTextColor="#2d4060"
              multiline
            />
            <Text style={[DV.conditionalLabel, { marginTop: 14 }]}>Discrepancy Notes</Text>
            <TextInput
              style={[DV.conditionalInput, { minHeight: 60, textAlignVertical: 'top' }]}
              value={discrepancy}
              onChangeText={setDiscrepancy}
              placeholder="Quantity shortages, damage details…"
              placeholderTextColor="#2d4060"
              multiline
            />
          </View>
        )}
      </View>

      {/* ── Save ─────────────────────────────────────────────────── */}
      {isDirty && (
        <Button title="Save Changes" onPress={save} loading={saving} style={DV.saveBtn} />
      )}

      <View style={{ height: 48 }} />
    </ScrollView>
  );
}

// ─── Create Delivery Modal ────────────────────────────────────────────────────

function CreateDeliveryModal({
  visible, onClose, onSaved, defaultProjectId: defProjId, defaultSiteId: defSiteId,
}: {
  visible:           boolean;
  onClose:           () => void;
  onSaved:           (projectId: string, siteId: string) => void;
  defaultProjectId?: string | null;
  defaultSiteId?:    string | null;
}) {
  const user = useAuthStore((s) => s.user)!;
  const hasDefaultContext = !!(defProjId && defSiteId);
  const [projects,     setProjects]     = useState<Project[]>([]);
  const [sites,        setSites]        = useState<JobSite[]>([]);
  const [projectId,    setProjectId]    = useState(defProjId ?? '');
  const [siteId,       setSiteId]       = useState(defSiteId ?? '');
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
    if (hasDefaultContext) return;
    projectsApi.list().then(setProjects).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function onProjectChange(pid: string) {
    setProjectId(pid); setSiteId('');
    try { setSites(await projectsApi.listSites(pid)); } catch { setSites([]); }
  }

  async function pickPhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission Required', 'Camera access is needed.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }

  async function save() {
    if (!projectId || !siteId || !supplier.trim() || !description.trim()) {
      Alert.alert('Validation', 'Project, site, supplier, and description are required'); return;
    }
    setSaving(true);
    try {
      const payload = {
        projectId, siteId,
        supplierName:       supplier.trim(),
        deliveryDate:       date,
        itemDescription:    description.trim(),
        quantityOrdered:    parseFloat(qtyOrdered)   || 1,
        quantityDelivered:  parseFloat(qtyDelivered) || 1,
        unitOfMeasure:      unit.trim() || 'units',
        conditionOnArrival: condition,
        receivedById:       user.id,
        comments:           notes || undefined,
      };
      const record = await deliveriesApi.create(payload);
      if (photoUri) {
        try { await deliveriesApi.uploadPhoto(record.id, photoUri); }
        catch { Alert.alert('Note', 'Delivery created but photo upload failed.'); }
      }
      onSaved(projectId, siteId); onClose();
    } catch (err) {
      const errData = (err as { response?: { data?: { error?: string; details?: Record<string, string[]> } } })?.response?.data;
      const msg = errData?.details
        ? Object.entries(errData.details).map(([f, msgs]) => `${f}: ${msgs.join(', ')}`).join('\n')
        : (errData?.error ?? 'Failed to create delivery');
      Alert.alert('Validation Error', msg);
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
          {!hasDefaultContext && (
            <>
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
            </>
          )}

          <Input label="Supplier Name *"     value={supplier}     onChangeText={setSupplier}     placeholder="Acme Supplies Ltd" />
          <Input label="Delivery Date *"     value={date}         onChangeText={setDate}         placeholder="2026-04-17" />
          <Input label="Item Description *"  value={description}  onChangeText={setDescription}  placeholder="Portland cement 50kg bags" multiline />
          <Input label="Qty Ordered"         value={qtyOrdered}   onChangeText={setQtyOrdered}   keyboardType="decimal-pad" placeholder="100" />
          <Input label="Qty Delivered"       value={qtyDelivered} onChangeText={setQtyDelivered} keyboardType="decimal-pad" placeholder="100" />
          <Input label="Unit of Measure"     value={unit}         onChangeText={setUnit}         placeholder="bags" />
          <Input label="Condition on Arrival" value={condition}   onChangeText={setCondition}    placeholder="good / damaged" />
          <Input label="Notes (optional)"    value={notes}        onChangeText={setNotes}        placeholder="Any notes…" multiline />

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

// ─── Deliveries Screen ────────────────────────────────────────────────────────

export default function DeliveriesScreen() {
  const authUser         = useAuthStore((s) => s.user);
  const defaultProjectId = authUser?.defaultProjectId ?? null;
  const defaultSiteId    = authUser?.defaultSiteId    ?? null;
  const hasDefaults      = !!(defaultProjectId && defaultSiteId);

  const [view,           setView]           = useState<'list' | 'detail'>('list');
  const [selectedRecord, setSelectedRecord] = useState<DeliveryRecord | null>(null);
  const [records,        setRecords]        = useState<DeliveryRecord[]>([]);
  const [total,          setTotal]          = useState(0);
  const [loading,        setLoading]        = useState(false);
  const [refreshing,     setRefreshing]     = useState(false);
  const [loadingMore,    setLoadingMore]    = useState(false);
  const [showModal,      setShowModal]      = useState(false);
  const [search,         setSearch]         = useState('');
  const [statusFilter,   setStatusFilter]   = useState('');
  const [offset,         setOffset]         = useState(0);

  // Project / site selection for list scope — pre-seeded from defaults when available
  const [listProjects,   setListProjects]   = useState<Project[]>([]);
  const [listSites,      setListSites]      = useState<JobSite[]>([]);
  const [listProjectId,  setListProjectId]  = useState(defaultProjectId ?? '');
  const [listSiteId,     setListSiteId]     = useState(defaultSiteId    ?? '');

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (hasDefaults) {
      setLoading(true);
      void load({ reset: true, pid: defaultProjectId!, sid: defaultSiteId! })
        .then(() => setLoading(false))
        .catch(() => setLoading(false));
      return;
    }
    projectsApi.list().then((p) => setListProjects(p ?? [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function onListProjectChange(pid: string) {
    setListProjectId(pid); setListSiteId(''); setRecords([]); setTotal(0);
    try {
      const sites = await projectsApi.listSites(pid);
      setListSites(Array.isArray(sites) ? sites : []);
    } catch { setListSites([]); }
  }

  async function onListSiteChange(sid: string, pid: string) {
    if (!sid || !pid) return;
    setListSiteId(sid); setOffset(0);
    setLoading(true);
    await load({ reset: true, pid, sid });
    setLoading(false);
  }

  async function load(opts: { reset?: boolean; searchVal?: string; statusF?: string; pid?: string; sid?: string } = {}) {
    const pid       = opts.pid       ?? listProjectId;
    const sid       = opts.sid       ?? listSiteId;
    if (!pid || !sid) return;
    const searchQ   = opts.searchVal ?? search;
    const statusQ   = opts.statusF   ?? statusFilter;
    const newOffset = opts.reset ? 0 : offset;

    try {
      const res      = await deliveriesApi.list({
        projectId:        pid,
        siteId:           sid,
        search:           searchQ || undefined,
        acceptanceStatus: statusQ || undefined,
        limit:  PAGE_SIZE,
        offset: newOffset,
      });
      const fetched  = Array.isArray(res?.records) ? res.records : [];

      // Backend ignores acceptanceStatus param — filter client-side
      const filtered =
        statusQ === ''                  ? fetched :
        statusQ === 'pending_inspection'? fetched.filter((d) => d.acceptanceStatus == null) :
                                          fetched.filter((d) => d.acceptanceStatus === statusQ);

      if (opts.reset || newOffset === 0) {
        setRecords(filtered);
      } else {
        setRecords((prev) => [...(prev ?? []), ...filtered]);
      }
      setTotal(filtered.length);
      setOffset(newOffset + filtered.length);
    } catch { /* non-fatal */ }
  }

  async function onRefresh() {
    setRefreshing(true); setOffset(0);
    await load({ reset: true });
    setRefreshing(false);
  }

  async function onLoadMore() {
    if (loadingMore || (records?.length ?? 0) >= total) return;
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

  function openDetail(record: DeliveryRecord) {
    setSelectedRecord(record);
    setView('detail');
  }

  function handleUpdated(updated: DeliveryRecord) {
    setRecords((prev) => (prev ?? []).map((r) => r.id === updated.id ? updated : r));
    setSelectedRecord(updated);
  }

  if (loading) return <LoadingSpinner />;

  if (view === 'detail' && selectedRecord) {
    return (
      <Screen>
        <DeliveryDetailView
          record={selectedRecord}
          onBack={() => setView('list')}
          onUpdated={handleUpdated}
        />
      </Screen>
    );
  }

  const hasMore = records.length < total;

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Deliveries</Text>
        <Button
          title="+ Add"
          onPress={() => setShowModal(true)}
          variant="secondary"
          style={{ height: 36, paddingHorizontal: 12 }}
        />
      </View>

      {/* Project / site pickers — legacy users only; hidden when defaults are active */}
      {!hasDefaults && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterBar}
            contentContainerStyle={styles.filterBarContent}
          >
            {listProjects.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.filterChip, listProjectId === p.id && styles.filterChipActive]}
                onPress={() => void onListProjectChange(p.id)}
              >
                <Text style={[styles.filterChipText, listProjectId === p.id && styles.filterChipTextActive]}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {listSites.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterBar}
              contentContainerStyle={styles.filterBarContent}
            >
              {listSites.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.filterChip, listSiteId === s.id && styles.filterChipActive]}
                  onPress={() => void onListSiteChange(s.id, listProjectId)}
                >
                  <Text style={[styles.filterChipText, listSiteId === s.id && styles.filterChipTextActive]}>
                    {s.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </>
      )}

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

      {/* Filter chips */}
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

      {total > 0 && (
        <Text style={styles.countText}>{total} deliveries{search ? ` for "${search}"` : ''}</Text>
      )}

      <View style={styles.listArea}>
      {records.length === 0
        ? (
          <EmptyState
            title={
              hasDefaults
                ? (search ? 'No results' : 'No deliveries')
                : (!listProjectId ? 'Select a project' : !listSiteId ? 'Select a site' : 'No deliveries')
            }
            description={
              hasDefaults
                ? (search ? `No results for "${search}"` : 'Tap + Add to record the first delivery.')
                : (!listProjectId ? 'Choose a project above to view its deliveries.' :
                   !listSiteId    ? 'Choose a site above to view its deliveries.' :
                   search         ? `No results for "${search}"` :
                                    'Tap + Add to record a new delivery.')
            }
          />
        ) : (
          <FlatList
            data={records}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => {
              const insp = INSPECTION_OPTIONS.find((o) => o.value === item.inspectionStatus);
              return (
                <TouchableOpacity onPress={() => openDetail(item)} activeOpacity={0.75}>
                  <Card style={styles.recordCard}>
                    <View style={styles.recordRow}>
                      <Text style={styles.supplierName} numberOfLines={1}>{item.supplierName}</Text>
                      <Badge
                        label={item.acceptanceStatus ?? 'Pending'}
                        variant={
                          item.acceptanceStatus === 'accepted' ? 'success' :
                          item.acceptanceStatus === 'rejected' ? 'error'   :
                          item.acceptanceStatus === null       ? 'default' : 'warning'
                        }
                      />
                    </View>
                    <Text style={styles.recordMeta} numberOfLines={1}>{item.itemDescription}</Text>
                    <View style={styles.recordMetaRow}>
                      <Text style={styles.recordMeta}>{fmtDate(item.deliveryDate)}</Text>
                      <Text style={styles.recordMeta}>
                        {item.quantityDelivered}/{item.quantityOrdered} {item.unitOfMeasure}
                      </Text>
                      {item.inspectionStatus !== 'pending' && insp && (
                        <View style={[styles.inspChip, { backgroundColor: insp.bg, borderColor: insp.border }]}>
                          <Text style={[styles.inspChipText, { color: insp.color }]}>
                            {insp.label}
                          </Text>
                        </View>
                      )}
                    </View>
                  </Card>
                </TouchableOpacity>
              );
            }}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
            }
            onEndReached={onLoadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              hasMore ? (
                <View style={styles.footer}>
                  {loadingMore
                    ? <ActivityIndicator size="small" color="#3b82f6" />
                    : (
                      <TouchableOpacity onPress={onLoadMore} style={styles.loadMoreBtn}>
                        <Text style={styles.loadMoreText}>
                          Load More ({total - records.length} remaining)
                        </Text>
                      </TouchableOpacity>
                    )
                  }
                </View>
              ) : null
            }
          />
        )
      }

      </View>

      <CreateDeliveryModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        defaultProjectId={defaultProjectId}
        defaultSiteId={defaultSiteId}
        onSaved={(pid, sid) => {
          if (pid !== listProjectId || sid !== listSiteId) {
            setListProjectId(pid);
            setListSiteId(sid);
          }
          setOffset(0);
          void load({ reset: true, pid, sid });
        }}
      />
    </Screen>
  );
}

// ─── List styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  pageTitle: { color: '#f1f5f9', fontSize: 22, fontWeight: '700' },

  searchRow:       { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155', paddingHorizontal: 12, alignSelf: 'stretch' },
  searchInput:     { flex: 1, color: '#f1f5f9', fontSize: 14, paddingVertical: 10, minWidth: 0 },
  searchClear:     { padding: 4 },
  searchClearText: { color: '#64748b', fontSize: 14 },

  filterBar:            { flexGrow: 0, flexShrink: 0, alignSelf: 'stretch' },
  filterBarContent:     { paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  filterChip:           { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', flexShrink: 0 },
  filterChipActive:     { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  filterChipText:       { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#fff',    fontSize: 12, fontWeight: '600' },

  countText: { color: '#64748b', fontSize: 12, paddingHorizontal: 16, marginBottom: 4 },

  listArea:      { flex: 1, overflow: 'hidden' },
  list:          { padding: 16, paddingBottom: 32 },
  recordCard:    { marginBottom: 8 },
  recordRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  recordMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  supplierName:  { color: '#f1f5f9', fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  recordMeta:    { color: '#94a3b8', fontSize: 12 },

  inspChip:     { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  inspChipText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },

  footer:       { alignItems: 'center', paddingVertical: 16 },
  loadMoreBtn:  { backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#334155' },
  loadMoreText: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },

  modal:       { flex: 1, backgroundColor: '#0f172a' },
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

// ─── Detail view styles ───────────────────────────────────────────────────────

const DV = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060d1b' },
  scroll:    { paddingBottom: 20 },

  backBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 16, paddingBottom: 8 },
  backArrow: { color: '#3b82f6', fontSize: 24, lineHeight: 26 },
  backLabel: { color: '#3b82f6', fontSize: 15, fontWeight: '600' },

  headerBlock:   { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#0d1e35' },
  supplierTitle: { color: '#dde9f8', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  deliveryDate:  { color: '#4a7ab5', fontSize: 13, marginTop: 4, marginBottom: 10 },
  statusRow:     { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statusPill:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  statusPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  section:      { marginHorizontal: 18, marginTop: 20 },
  sectionTitle: { color: '#3d6090', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 },

  infoRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#0d1e35', gap: 12 },
  infoLabel: { color: '#2d4f78', fontSize: 12, fontWeight: '600', flex: 1 },
  infoValue: { color: '#8aabcc', fontSize: 12, flex: 2, textAlign: 'right' },

  photoRow:   { gap: 8, paddingVertical: 2 },
  photoThumb: { width: 100, height: 80, borderRadius: 8, backgroundColor: '#0a1628' },

  // 2×2 grid for 4 inspection options
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionBtn:  {
    width: '47%',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0a1628', borderRadius: 10, padding: 13,
    borderWidth: 1, borderColor: '#142238',
  },

  // Equal-width row for 3 acceptance options
  optionRow:    { flexDirection: 'row', gap: 8 },
  optionBtnFull: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#0a1628', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#142238',
  },

  optionDot:    { width: 7, height: 7, borderRadius: 4 },
  optionBtnText: { color: '#3d5a7a', fontSize: 12, fontWeight: '700' },

  conditionalBlock: {
    marginTop: 14, backgroundColor: '#080e1c',
    borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#0f1e35',
  },
  conditionalLabel: {
    color: '#4a7ab5', fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },
  conditionalHint:  { color: '#2d4060', fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
  conditionalInput: {
    backgroundColor: '#0a1628', borderRadius: 8, borderWidth: 1,
    borderColor: '#142238', color: '#dde9f8', fontSize: 14, padding: 12,
  },

  saveBtn: { marginHorizontal: 18, marginTop: 24 },
});
