/**
 * 1stOne F1 — Delivery Manager
 *
 * 3-tab screen: Cycles | Zones & Fees | Hubs
 * Cycles tab lists every delivery cycle; each card toggles whether it serves
 * essentials and holds the customer-facing essentials label.
 *
 * Food / Essentials Cycles — inline-editable delivery times.
 * Zones & Fees — polygon zone editor: draw on map, set name / fee / hub.
 * Hubs — list of hubs with toggle, edit, impact-warning on disable.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Modal,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { ZoneMap } from '../../components/ZoneMap';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { PhonePicker, type PickedProfile } from '../../components/PhonePicker';
import { useAllDeliveryCycles, useUpdateDeliveryCycle, useAddDeliveryCycle } from '../../hooks/useMenuManagement';
import { useDeliveryZones, useAddZone, useUpdateZone, useDeleteZone } from '../../hooks/useDeliveryZones';
import { useActiveHubs, useDeliveryHubs, useToggleHub } from '../../hooks/useDeliveryHubs';
import { supabase } from '../../api/supabaseClient';
import type { DeliveryCycle, DeliveryZone, DeliveryHub } from '../../types';
import type { AdminNavProp } from '../../navigation/types';

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;


type DeliveryTab = 'Hubs' | 'Zones & Fees' | 'Cycles';
const TABS: DeliveryTab[] = ['Hubs', 'Zones & Fees', 'Cycles'];

// Default map region — central India; overridden by device location when available
const DEFAULT_REGION: Region = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
};

// ── Helpers ──────────────────────────────────────────────────
function toHHMM(t?: string): string {
  if (!t) return '';
  return t.slice(0, 5);
}

// ── TimeField ────────────────────────────────────────────────
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  return (
    <View style={tf.row}>
      <ThemedText variant="small" color="muted" style={tf.label}>{label}</ThemedText>
      {editing ? (
        <TextInput
          style={tf.input}
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          autoFocus
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          placeholder="HH:MM"
          placeholderTextColor={Theme.colors.text.muted}
        />
      ) : (
        <TouchableOpacity onPress={() => { setDraft(toHHMM(value)); setEditing(true); }} activeOpacity={0.7}>
          <ThemedText variant="body" color="mint" style={tf.time}>
            {toHHMM(value) || '—'}{'  ✎'}
          </ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}

const tf = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.xs + 2,
  },
  label: { fontSize: S },
  time: { fontSize: B },
  input: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: 2,
    minWidth: 70,
    textAlign: 'right',
  },
});

// ── CycleCard ────────────────────────────────────────────────
function CycleCard({ cycle }: { cycle: DeliveryCycle }) {
  const update = useUpdateDeliveryCycle();
  const [essLabel, setEssLabel] = useState(cycle.essentials_label ?? '');
  const [cycleName, setCycleName] = useState(cycle.cycle_name);

  const save = (field: string, val: string) => {
    const formatted = val.length === 5 ? `${val}:00` : val;
    update.mutate({ id: cycle.id, [field]: formatted });
  };

  const saveEssLabel = () => {
    const trimmed = essLabel.trim();
    update.mutate({ id: cycle.id, essentials_label: trimmed.length > 0 ? trimmed : null });
  };

  const saveCycleName = () => {
    const trimmed = cycleName.trim();
    if (trimmed.length > 0 && trimmed !== cycle.cycle_name) {
      update.mutate({ id: cycle.id, cycle_name: trimmed });
    } else {
      setCycleName(cycle.cycle_name);
    }
  };

  return (
    <View style={card.container}>
      <View style={card.header}>
        <TextInput
          value={cycleName}
          onChangeText={setCycleName}
          onBlur={saveCycleName}
          style={card.nameInput}
          placeholder="Cycle name"
          placeholderTextColor={Theme.colors.text.muted}
        />
        <Switch
          value={cycle.is_active}
          onValueChange={(v) => update.mutate({ id: cycle.id, is_active: v })}
          trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
          thumbColor={Theme.colors.text.primary}
        />
      </View>
      <TimeField label="Order Cut-off" value={cycle.cutoff_time} onCommit={(v) => save('cutoff_time', v)} />
      <TimeField label="Kitchen Push" value={cycle.kitchen_push_time} onCommit={(v) => save('kitchen_push_time', v)} />
      <TimeField label="Dispatch" value={cycle.delivery_start} onCommit={(v) => save('delivery_start', v)} />

      {/* Essentials label — only meaningful when cycle supports essentials */}
      <View style={card.labelRow}>
        <ThemedText variant="small" color="muted" style={card.labelName}>Essentials Toggle</ThemedText>
        <Switch
          value={cycle.is_essentials}
          onValueChange={(v) => update.mutate({ id: cycle.id, is_essentials: v })}
          trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
          thumbColor={Theme.colors.text.primary}
        />
      </View>
      {cycle.is_essentials && (
        <View style={card.labelRow}>
          <ThemedText variant="small" color="muted" style={card.labelName}>Essentials Label</ThemedText>
          <TextInput
            value={essLabel}
            onChangeText={setEssLabel}
            onBlur={saveEssLabel}
            placeholder="e.g. Morning"
            placeholderTextColor={Theme.colors.text.muted}
            style={card.labelInput}
          />
        </View>
      )}
    </View>
  );
}

const card = StyleSheet.create({
  container: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.xs,
  },
  nameInput: {
    flex: 1,
    fontSize: B,
    fontWeight: '600',
    color: Theme.colors.text.primary,
    paddingVertical: 0,
    marginRight: Theme.spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.xs,
  },
  labelName: { fontSize: S, minWidth: 130 },
  labelInput: {
    flex: 1,
    fontSize: S,
    color: Theme.colors.text.primary,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    textAlign: 'right',
  },
});

// ── AddCycleModal ────────────────────────────────────────────
function AddCycleModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const addCycle = useAddDeliveryCycle();
  const [name, setName] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [dispatch, setDispatch] = useState('');
  const [isEss, setIsEss] = useState(false);
  const [essLabel, setEssLabel] = useState('');

  React.useEffect(() => {
    if (visible) {
      setName('');
      setCutoff('');
      setDispatch('');
      setIsEss(false);
      setEssLabel('');
    }
  }, [visible]);

  const toHHMMSS = (v: string) => (v.length === 5 ? `${v}:00` : v);

  const save = async () => {
    if (!name.trim()) { Alert.alert('Missing', 'Enter a cycle name'); return; }
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(cutoff)) { Alert.alert('Missing', 'Enter cut-off as HH:MM'); return; }
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(dispatch)) { Alert.alert('Missing', 'Enter dispatch as HH:MM'); return; }
    try {
      await addCycle.mutateAsync({
        cycle_name: name.trim(),
        cutoff_time: toHHMMSS(cutoff),
        delivery_start: toHHMMSS(dispatch),
        kitchen_push_time: toHHMMSS(cutoff),
        is_essentials: isEss,
        essentials_label: isEss ? (essLabel.trim() || null) : null,
      });
      onClose();
    } catch (e: any) {
      Alert.alert('Failed', e?.message ?? 'Could not create cycle');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={addModal.backdrop}>
        <View style={addModal.sheet}>
          <ThemedText variant="subtitle" color="primary" style={addModal.title}>Add Cycle</ThemedText>

          <View style={addModal.row}>
            <ThemedText variant="small" color="muted" style={addModal.label}>Name</ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Late Dinner"
              placeholderTextColor={Theme.colors.text.muted}
              style={addModal.input}
            />
          </View>

          <View style={addModal.row}>
            <ThemedText variant="small" color="muted" style={addModal.label}>Cut-off (HH:MM)</ThemedText>
            <TextInput
              value={cutoff}
              onChangeText={setCutoff}
              placeholder="21:00"
              placeholderTextColor={Theme.colors.text.muted}
              style={addModal.input}
              maxLength={5}
            />
          </View>

          <View style={addModal.row}>
            <ThemedText variant="small" color="muted" style={addModal.label}>Dispatch (HH:MM)</ThemedText>
            <TextInput
              value={dispatch}
              onChangeText={setDispatch}
              placeholder="22:00"
              placeholderTextColor={Theme.colors.text.muted}
              style={addModal.input}
              maxLength={5}
            />
          </View>

          <View style={addModal.row}>
            <ThemedText variant="small" color="muted" style={addModal.label}>Essentials cycle</ThemedText>
            <Switch
              value={isEss}
              onValueChange={setIsEss}
              trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
              thumbColor={Theme.colors.text.primary}
            />
          </View>

          {isEss && (
            <View style={addModal.row}>
              <ThemedText variant="small" color="muted" style={addModal.label}>Essentials Label</ThemedText>
              <TextInput
                value={essLabel}
                onChangeText={setEssLabel}
                placeholder="e.g. Morning"
                placeholderTextColor={Theme.colors.text.muted}
                style={addModal.input}
              />
            </View>
          )}

          <View style={addModal.actions}>
            <TouchableOpacity onPress={onClose} style={addModal.btn}>
              <ThemedText variant="body" color="muted">Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={addModal.btn} disabled={addCycle.isPending}>
              {addCycle.isPending ? (
                <ActivityIndicator color={Theme.colors.text.mint} />
              ) : (
                <ThemedText variant="body" color="mint">Save</ThemedText>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const addBtn = StyleSheet.create({
  row: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
});

const addModal = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Theme.colors.layout.overlayHeavy,
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.md,
  },
  sheet: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 12,
    padding: Theme.spacing.md,
  },
  title: { marginBottom: Theme.spacing.sm, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  label: { minWidth: 140, fontSize: S },
  input: {
    flex: 1,
    fontSize: S,
    color: Theme.colors.text.primary,
    textAlign: 'right',
    paddingHorizontal: Theme.spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Theme.spacing.lg,
    marginTop: Theme.spacing.md,
  },
  btn: { paddingVertical: Theme.spacing.xs },
});

// ── ZoneEditorModal ──────────────────────────────────────────
interface ZoneEditorModalProps {
  visible: boolean;
  editingZone: DeliveryZone | null;
  onClose: () => void;
}

function ZoneEditorModal({ visible, editingZone, onClose }: ZoneEditorModalProps) {
  const insets = useSafeAreaInsets();
  const { data: hubs = [] } = useActiveHubs();
  const addZone = useAddZone();
  const updateZone = useUpdateZone();

  const isEditing = editingZone != null;

  const [vertices, setVertices] = useState<{ lat: number; lng: number }[]>(
    () => editingZone?.polygon_geojson ?? []
  );
  const [zoneName, setZoneName] = useState(editingZone?.zone_name ?? '');
  const [feeOverride, setFeeOverride] = useState(
    editingZone?.delivery_fee_override != null ? String(editingZone.delivery_fee_override) : ''
  );
  const [selectedHubId, setSelectedHubId] = useState<number | null>(editingZone?.hub_id ?? null);
  // Driver phone-picker state — seeded from existing zone if set
  const [driver, setDriver] = useState<PickedProfile | null>(
    editingZone?.driver_user_id
      ? {
          userId:     editingZone.driver_user_id,
          name:       '',
          phone:      '',
          employeeId: editingZone.driver_code ?? null,
        }
      : null
  );
  const [mapRegion, setMapRegion] = useState<Region>(DEFAULT_REGION);

  const centreOnDeviceLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMapRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    } catch {
      // stay on default region
    }
  };

  const handleModalShow = () => {
    if (!isEditing) {
      setVertices([]);
      setZoneName('');
      setFeeOverride('');
      setSelectedHubId(null);
      setDriver(null);
      centreOnDeviceLocation();
    } else if (editingZone?.polygon_geojson?.length) {
      const lats = editingZone.polygon_geojson.map((p) => p.lat);
      const lngs = editingZone.polygon_geojson.map((p) => p.lng);
      setMapRegion({
        latitude: lats.reduce((a, b) => a + b, 0) / lats.length,
        longitude: lngs.reduce((a, b) => a + b, 0) / lngs.length,
        latitudeDelta: Math.max(...lats) - Math.min(...lats) + 0.02,
        longitudeDelta: Math.max(...lngs) - Math.min(...lngs) + 0.02,
      });
    }
  };

  const handleSave = async () => {
    if (!zoneName.trim()) {
      Alert.alert('Required', 'Please enter a zone name.');
      return;
    }
    if (vertices.length < 3) {
      Alert.alert('Required', 'Tap at least 3 points on the map to define the zone boundary.');
      return;
    }
    if (!driver) {
      Alert.alert('Required', 'Please assign a driver — orders in this zone need one.');
      return;
    }

    const polygon_geojson = vertices;
    const fee = feeOverride.trim() ? parseFloat(feeOverride) : null;
    // Display token mirrors staff's employee_id; fallback to last-4 phone.
    const derivedDriverCode = driver.employeeId?.trim()
      || `D-${(driver.phone ?? '').slice(-4) || '????'}`;

    try {
      if (isEditing) {
        await updateZone.mutateAsync({
          id: editingZone!.id,
          zone_name: zoneName.trim(),
          polygon_geojson,
          delivery_fee_override: fee,
          hub_id: selectedHubId,
          driver_code: derivedDriverCode,
          driver_user_id: driver.userId,
        });
      } else {
        await addZone.mutateAsync({
          zone_name: zoneName.trim(),
          polygon_geojson,
          delivery_fee_override: fee,
          hub_id: selectedHubId,
          driver_code: derivedDriverCode,
          driver_user_id: driver.userId,
        });
      }
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save zone.');
    }
  };

  const saving = addZone.isPending || updateZone.isPending;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onShow={handleModalShow}
    >
      <View style={[em.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Header */}
        <View style={em.header}>
          <TouchableOpacity onPress={onClose}>
            <ThemedText variant="body" color="accent">Cancel</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">
            {isEditing ? 'Edit Zone' : 'Draw Zone'}
          </ThemedText>
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            {saving
              ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
              : <ThemedText variant="body" color="mint">Save</ThemedText>
            }
          </TouchableOpacity>
        </View>

        {/* Map — platform-aware: ZoneMap.native.tsx on iOS/Android, ZoneMap.tsx on web */}
        <ZoneMap
          vertices={vertices}
          onChange={setVertices}
          initialRegion={mapRegion}
        />

        {/* Clear button */}
        {vertices.length > 0 && (
          <TouchableOpacity style={em.clearRow} onPress={() => setVertices([])}>
            <ThemedText variant="small" color="accent">Clear all points</ThemedText>
          </TouchableOpacity>
        )}

        <ScrollView style={em.form} keyboardShouldPersistTaps="handled">
          {/* Zone name */}
          <View style={em.fieldRow}>
            <ThemedText variant="small" color="muted" style={em.fieldLabel}>Zone Name</ThemedText>
            <TextInput
              style={em.fieldInput}
              value={zoneName}
              onChangeText={setZoneName}
              placeholder="e.g. North Bangalore"
              placeholderTextColor={Theme.colors.text.muted}
            />
          </View>
          <View style={em.hairline} />

          {/* Driver — phone-picked from staff; display driver_code auto-fills from employee_id */}
          <View style={em.fieldBlock}>
            <ThemedText variant="small" color="muted" style={em.fieldLabel}>Driver *</ThemedText>
            <PhonePicker
              value={driver}
              onChange={setDriver}
              roleFilter="staff"
              labelNotFound="Not a staff member. Elevate them via Manage → Staff first."
              labelPlaceholder="Enter driver's 10-digit phone"
            />
          </View>
          <View style={em.hairline} />

          {/* Delivery fee override */}
          <View style={em.fieldRow}>
            <ThemedText variant="small" color="muted" style={em.fieldLabel}>Delivery Fee Override</ThemedText>
            <TextInput
              style={em.fieldInput}
              value={feeOverride}
              onChangeText={setFeeOverride}
              placeholder="Leave blank to use default"
              placeholderTextColor={Theme.colors.text.muted}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={em.hairline} />

          {/* Hub picker */}
          {hubs.length > 0 && (
            <>
              <ThemedText variant="small" color="muted" style={em.sectionLabel}>
                Assigned Hub (optional)
              </ThemedText>
              <View style={em.hubRow}>
                <TouchableOpacity
                  style={[em.hubChip, selectedHubId == null && em.hubChipActive]}
                  onPress={() => setSelectedHubId(null)}
                  activeOpacity={0.7}
                >
                  <ThemedText variant="small" color={selectedHubId == null ? 'mint' : 'muted'}>
                    None
                  </ThemedText>
                </TouchableOpacity>
                {(hubs as any[]).map((h) => (
                  <TouchableOpacity
                    key={h.id}
                    style={[em.hubChip, selectedHubId === h.id && em.hubChipActive]}
                    onPress={() => setSelectedHubId(h.id)}
                    activeOpacity={0.7}
                  >
                    <ThemedText variant="small" color={selectedHubId === h.id ? 'mint' : 'muted'}>
                      {h.hub_name}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={em.hairline} />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const em = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  clearRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs + 2,
    alignItems: 'flex-end',
  },
  form: { flex: 1 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  fieldBlock: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  fieldLabel: { fontSize: S, flex: 1 },
  fieldInput: {
    flex: 2,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    textAlign: 'right',
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
    marginHorizontal: Theme.spacing.md,
  },
  sectionLabel: {
    fontSize: S,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xs,
  },
  hubRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  hubChip: {
    paddingHorizontal: Theme.spacing.sm + 2,
    paddingVertical: Theme.spacing.xs + 2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Theme.colors.text.muted,
  },
  hubChipActive: { borderColor: Theme.colors.text.mint },
});

// ── ZonesTab ─────────────────────────────────────────────────
function ZonesTab() {
  const { data: zones = [], isLoading } = useDeliveryZones();
  const updateZone = useUpdateZone();
  const deleteZone = useDeleteZone();

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingZone, setEditingZone] = useState<DeliveryZone | null>(null);

  const openNew = () => {
    setEditingZone(null);
    setEditorVisible(true);
  };

  const openEdit = (zone: DeliveryZone) => {
    setEditingZone(zone);
    setEditorVisible(true);
  };

  const handleDelete = (zone: DeliveryZone) => {
    Alert.alert(
      'Delete Zone',
      `Delete "${zone.zone_name}"? Existing addresses mapped to this zone will retain their zone_id but the zone won't be used for new serviceability checks.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteZone.mutate({ id: zone.id }),
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={zt.center}>
        <ActivityIndicator color={Theme.colors.text.mint} />
      </View>
    );
  }

  return (
    <View style={zt.container}>
      {/* Add zone button */}
      <TouchableOpacity style={zt.addRow} onPress={openNew} activeOpacity={0.7}>
        <ThemedText variant="body" color="mint" style={zt.addText}>+ New Zone</ThemedText>
      </TouchableOpacity>
      <View style={zt.hairline} />

      {zones.length === 0 && (
        <View style={zt.empty}>
          <ThemedText variant="body" color="muted">No zones yet. Draw your first delivery zone.</ThemedText>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false}>
        {(zones as DeliveryZone[]).map((zone) => (
          <View key={zone.id} style={zt.zoneRow}>
            <View style={zt.zoneInfo}>
              <ThemedText variant="body" color="primary" style={zt.zoneName}>
                {zone.zone_name}
              </ThemedText>
              <ThemedText variant="small" color="muted">
                {zone.polygon_geojson?.length ?? 0} vertices
                {zone.delivery_fee_override != null ? `  ·  ₹${zone.delivery_fee_override} fee` : ''}
              </ThemedText>
            </View>

            <View style={zt.zoneActions}>
              <Switch
                value={zone.is_active}
                onValueChange={(v) => updateZone.mutate({ id: zone.id, is_active: v })}
                trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
                thumbColor={Theme.colors.text.primary}
              />
              <TouchableOpacity onPress={() => openEdit(zone)} style={zt.editBtn} activeOpacity={0.7}>
                <ThemedText variant="small" color="mint">Edit</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(zone)} style={zt.delBtn} activeOpacity={0.7}>
                <ThemedText variant="small" color="accent">✕</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      <ZoneEditorModal
        visible={editorVisible}
        editingZone={editingZone}
        onClose={() => setEditorVisible(false)}
      />
    </View>
  );
}

const zt = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  addRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  addText: { fontSize: B },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.text.mint,
    marginHorizontal: Theme.spacing.md,
  },
  empty: { padding: Theme.spacing.md },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  zoneInfo: { flex: 1 },
  zoneName: { fontSize: B, fontWeight: '600', marginBottom: 2 },
  zoneActions: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  editBtn: { paddingHorizontal: Theme.spacing.xs + 2 },
  delBtn: { paddingHorizontal: Theme.spacing.xs + 2 },
});

// ── HubsTab ───────────────────────────────────────────────────
function HubsTab({ navigation }: { navigation: AdminNavProp }) {
  const { data: hubs = [], isLoading } = useDeliveryHubs();
  const toggleHub = useToggleHub();

  const handleToggle = (hub: DeliveryHub, newValue: boolean) => {
    // Disabling a hub that extends coverage — check impact first
    if (!newValue && hub.extends_coverage) {
      checkImpactAndDisable(hub);
    } else {
      toggleHub.mutate({ id: hub.id, is_active: newValue });
    }
  };

  const checkImpactAndDisable = async (hub: DeliveryHub) => {
    try {
      const { data } = await supabase.rpc('get_hub_impact_addresses', { p_hub_id: hub.id });
      const count = (data ?? []).length;

      if (count > 0) {
        Alert.alert(
          'Hub Covers Extended Area',
          `${count} address${count !== 1 ? 'es' : ''} in this hub's area have no base zone coverage. Disabling may affect their deliveries.\n\nDisable anyway?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Disable Hub',
              style: 'destructive',
              onPress: () => toggleHub.mutate({ id: hub.id, is_active: false }),
            },
          ]
        );
      } else {
        toggleHub.mutate({ id: hub.id, is_active: false });
      }
    } catch {
      toggleHub.mutate({ id: hub.id, is_active: false });
    }
  };

  if (isLoading) {
    return (
      <View style={ht.center}>
        <ActivityIndicator color={Theme.colors.text.mint} />
      </View>
    );
  }

  return (
    <View style={ht.container}>
      <TouchableOpacity
        style={ht.addRow}
        onPress={() => navigation.navigate('HubDetail', {})}
        activeOpacity={0.7}
      >
        <ThemedText variant="body" color="mint" style={ht.addText}>+ New Hub</ThemedText>
      </TouchableOpacity>
      <View style={ht.headHairline} />

      {(hubs as DeliveryHub[]).length === 0 && (
        <View style={ht.empty}>
          <ThemedText variant="body" color="muted">
            No hubs yet. Create your first delivery hub.
          </ThemedText>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false}>
        {(hubs as DeliveryHub[]).map((hub) => (
          <TouchableOpacity
            key={hub.id}
            style={ht.hubRow}
            onPress={() => navigation.navigate('HubDetail', { hub })}
            activeOpacity={0.7}
          >
            <View style={ht.hubInfo}>
              <View style={ht.hubNameRow}>
                <ThemedText variant="body" color="primary" style={ht.hubName}>
                  {hub.hub_name}
                </ThemedText>
                {hub.hub_code ? (
                  <ThemedText variant="small" color="muted" style={ht.hubCode}>
                    {hub.hub_code}
                  </ThemedText>
                ) : null}
              </View>
              <ThemedText variant="small" color="muted">
                {hub.staff_name ?? 'No operator assigned'}
                {hub.polygon_geojson?.length
                  ? `  ·  ${hub.polygon_geojson.length} vertices`
                  : '  ·  No boundary drawn'}
                {hub.extends_coverage ? '  ·  Extended area' : ''}
              </ThemedText>
            </View>

            <View style={ht.hubActions}>
              <Switch
                value={hub.is_active}
                onValueChange={(v) => handleToggle(hub, v)}
                trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
                thumbColor={Theme.colors.text.primary}
              />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const ht = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  addRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  addText: { fontSize: B },
  headHairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.text.mint,
    marginHorizontal: Theme.spacing.md,
  },
  empty: { padding: Theme.spacing.md },
  hubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  hubInfo: { flex: 1 },
  hubNameRow: { flexDirection: 'row', alignItems: 'baseline', gap: Theme.spacing.sm, marginBottom: 2 },
  hubName: { fontSize: B, fontWeight: '600' },
  hubCode: { fontSize: S },
  hubActions: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
});

// ── Main screen ──────────────────────────────────────────────
export function DeliveryManagerScreen({ navigation }: { navigation: AdminNavProp }) {
  const [activeTab, setActiveTab] = useState<DeliveryTab>('Hubs');

  const { data: allCycles = [] } = useAllDeliveryCycles();

  // One unified list — each card shows the is_essentials toggle + essentials label.
  const cycles = React.useMemo(() => (allCycles as DeliveryCycle[]), [allCycles]);

  const [addCycleOpen, setAddCycleOpen] = useState(false);

  const renderCycles = () => (
    <>
      <TouchableOpacity style={addBtn.row} onPress={() => setAddCycleOpen(true)} activeOpacity={0.6}>
        <ThemedText variant="body" color="mint">+ Add Cycle</ThemedText>
      </TouchableOpacity>
      {cycles.map((c) => (
        <CycleCard key={c.id} cycle={c} />
      ))}
    </>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Delivery Manager
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map((tab, idx) => (
          <React.Fragment key={tab}>
            {idx > 0 && (
              <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>
            )}
            <TouchableOpacity style={styles.topTab} onPress={() => setActiveTab(tab)}>
              <ThemedText
                variant="body"
                color={activeTab === tab ? 'primary' : 'muted'}
                style={[styles.tabText, activeTab === tab && styles.tabActive]}
              >
                {tab}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </ScrollView>

      {activeTab === 'Cycles' ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          {renderCycles()}
        </ScrollView>
      ) : activeTab === 'Zones & Fees' ? (
        <ZonesTab />
      ) : (
        <HubsTab navigation={navigation} />
      )}

      <AddCycleModal
        visible={addCycleOpen}
        onClose={() => setAddCycleOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },
  tabBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    flexGrow: 0,
  },
  tabBarContent: {
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  topTab: { paddingHorizontal: Theme.spacing.sm },
  tabText: { fontSize: B + 4 },
  tabActive: { fontWeight: '600' },
});
