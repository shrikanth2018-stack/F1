/**
 * 1stOne F1 — Delivery zone editor modal
 *
 * Full-screen zone editor: draw a polygon boundary on the map, set the
 * zone name, assign a driver (phone-picked), set a delivery-fee override
 * and an optional hub. Extracted from DeliveryManagerScreen (audit D22).
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { ZoneMap } from '../../../components/ZoneMap';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { PhonePicker, type PickedProfile } from '../../../components/PhonePicker';
import { useAddZone, useUpdateZone } from '../../../hooks/useDeliveryZones';
import { useActiveHubs } from '../../../hooks/useDeliveryHubs';
import type { DeliveryZone } from '../../../types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

// Default map region — central India; overridden by device location when available
const DEFAULT_REGION: Region = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
};

export interface ZoneEditorModalProps {
  visible: boolean;
  editingZone: DeliveryZone | null;
  onClose: () => void;
}

export function ZoneEditorModal({ visible, editingZone, onClose }: ZoneEditorModalProps) {
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
