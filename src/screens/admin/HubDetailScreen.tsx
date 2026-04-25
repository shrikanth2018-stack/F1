/**
 * 1stOne F1 — Hub Detail Screen
 *
 * Create / Edit a delivery hub.
 *
 * Sections:
 *   Map    — polygon editor (reuses ZoneMap platform component)
 *   Identity — hub name, hub code (auto-suggested)
 *   Staff    — search employee roster by name or phone, assign as hub operator
 *   Coverage — extends_coverage toggle
 *   Status   — active toggle (edit mode only)
 *
 * On save: writes hub record, then assigns all addresses inside the polygon
 * to this hub via the get_addresses_for_hub_assignment RPC + client-side ray-cast.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ZoneMap } from '../../components/ZoneMap';
import { PhonePicker, type PickedProfile } from '../../components/PhonePicker';
import {
  useAddHub,
  useUpdateHub,
  useAssignHubAddresses,
  useAssignHubOperator,
} from '../../hooks/useDeliveryHubs';
import type { DeliveryHub } from '../../types';
import type { AdminScreenProps } from '../../navigation/types';

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const DEFAULT_REGION: Region = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
};

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export function HubDetailScreen({ route, navigation }: AdminScreenProps<'HubDetail'>) {
  const existingHub = route.params?.hub;
  const isEditing = existingHub != null;

  const insets = useSafeAreaInsets();

  // Map
  const [vertices, setVertices] = useState<{ lat: number; lng: number }[]>(
    () => existingHub?.polygon_geojson ?? []
  );
  const [mapRegion, setMapRegion] = useState<Region>(() => {
    if (existingHub?.polygon_geojson?.length) {
      const lats = existingHub.polygon_geojson.map((p) => p.lat);
      const lngs = existingHub.polygon_geojson.map((p) => p.lng);
      return {
        latitude: lats.reduce((a, b) => a + b, 0) / lats.length,
        longitude: lngs.reduce((a, b) => a + b, 0) / lngs.length,
        latitudeDelta: Math.max(...lats) - Math.min(...lats) + 0.05,
        longitudeDelta: Math.max(...lngs) - Math.min(...lngs) + 0.05,
      };
    }
    return DEFAULT_REGION;
  });

  // Identity
  const [hubName, setHubName] = useState(existingHub?.hub_name ?? '');
  const [hubCode, setHubCode] = useState(existingHub?.hub_code ?? '');

  // Economics — both optional
  const [deliveryFee, setDeliveryFee] = useState(
    existingHub?.delivery_fee_override != null ? String(existingHub.delivery_fee_override) : ''
  );
  const [commissionPct, setCommissionPct] = useState(
    existingHub?.commission_percent != null ? String(existingHub.commission_percent) : ''
  );

  // Hub Operator — any registered customer (unlocks My Hub Dashboard for them)
  const [operator, setOperator] = useState<PickedProfile | null>(
    existingHub?.staff_user_id
      ? {
          userId:     existingHub.staff_user_id,
          name:       existingHub.staff_name ?? '',
          phone:      existingHub.staff_phone ?? '',
          employeeId: null,
        }
      : null
  );

  // Driver — staff only (auto-fills display driver_code from employee_id)
  const [driver, setDriver] = useState<PickedProfile | null>(
    existingHub?.driver_user_id
      ? {
          userId:     existingHub.driver_user_id,
          name:       '',
          phone:      '',
          employeeId: existingHub.driver_code ?? null,
        }
      : null
  );

  // Settings
  const [extendsCoverage, setExtendsCoverage] = useState(existingHub?.extends_coverage ?? false);
  const [isActive, setIsActive] = useState(existingHub?.is_active ?? true);

  const addHub = useAddHub();
  const updateHub = useUpdateHub();
  const assignAddresses = useAssignHubAddresses();
  const assignOperator = useAssignHubOperator();

  const saving = addHub.isPending || updateHub.isPending || assignAddresses.isPending || assignOperator.isPending;

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
      // stay on default
    }
  };

  React.useEffect(() => {
    if (!isEditing) {
      centreOnDeviceLocation();
    }
  }, []);

  const computeCenter = (verts: { lat: number; lng: number }[]) => {
    if (verts.length === 0) return { lat: null, lng: null };
    return {
      lat: verts.reduce((a, v) => a + v.lat, 0) / verts.length,
      lng: verts.reduce((a, v) => a + v.lng, 0) / verts.length,
    };
  };

  const handleSave = async () => {
    if (!hubName.trim()) {
      Alert.alert('Required', 'Please enter a hub name.');
      return;
    }
    if (!driver) {
      Alert.alert('Required', 'Please assign a driver — branch driver who delivers to this hub.');
      return;
    }

    const center = computeCenter(vertices);
    const feeNum = deliveryFee.trim() ? parseFloat(deliveryFee) : null;
    const commissionNum = commissionPct.trim() ? parseFloat(commissionPct) : null;

    // Auto-derive the display driver_code from the staff's employee_id.
    // Fallback: "D-{last 4 of phone}" — keeps the staff dashboard filter chips populated
    // even if the staff somehow has no employee_id yet.
    const derivedDriverCode = driver.employeeId?.trim()
      || `D-${(driver.phone ?? '').slice(-4) || '????'}`;

    const payload = {
      hub_name: hubName.trim(),
      hub_code: hubCode.trim() || null,
      polygon_geojson: vertices.length >= 3 ? vertices : null,
      center_lat: center.lat,
      center_lng: center.lng,
      // staff fields: capture the operator profile (name/phone denormalized for quick display)
      staff_user_id: operator?.userId ?? null,
      staff_name:    operator?.name ?? null,
      staff_phone:   operator?.phone ?? null,
      extends_coverage: extendsCoverage,
      driver_code:    derivedDriverCode,
      driver_user_id: driver.userId,
      delivery_fee_override: feeNum != null && !isNaN(feeNum) && feeNum >= 0 ? feeNum : null,
      commission_percent:    commissionNum != null && !isNaN(commissionNum) && commissionNum >= 0 ? commissionNum : null,
    };

    try {
      let hubId: number;

      if (isEditing) {
        await updateHub.mutateAsync({ id: existingHub!.id, ...payload, is_active: isActive });
        hubId = existingHub!.id;
      } else {
        const createdHub = await addHub.mutateAsync(payload) as DeliveryHub | null;
        if (!createdHub) throw new Error('Hub could not be created. Check database permissions and try again.');
        hubId = createdHub.id;
      }

      // Sync profiles.assigned_hub_id so the operator unlocks My Hub Dashboard.
      // Only fires when the operator selection changed (or is being cleared).
      const prevOperatorId = existingHub?.staff_user_id ?? null;
      const newOperatorId = operator?.userId ?? null;
      if (prevOperatorId !== newOperatorId) {
        await assignOperator.mutateAsync({
          hubId,
          newUserId: newOperatorId,
          oldUserId: prevOperatorId,
        });
      }

      // Re-assign addresses if polygon is set
      if (vertices.length >= 3) {
        const savedHub: DeliveryHub = {
          ...(existingHub ?? {} as DeliveryHub),
          ...payload,
          id: hubId,
          is_active: isActive,
        };
        const count = await assignAddresses.mutateAsync(savedHub);
        if (count > 0) {
          Alert.alert(
            isEditing ? 'Hub Saved' : 'Hub Created',
            `${count} address${count !== 1 ? 'es' : ''} assigned to this hub.`,
            [{ text: 'OK', onPress: () => navigation.goBack() }]
          );
          return;
        }
      }

      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save hub.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top - 44, 0) }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          {isEditing ? 'Edit Hub' : 'New Hub'}
        </ThemedText>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          {saving
            ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
            : <ThemedText variant="body" color="mint" style={styles.save}>Save</ThemedText>
          }
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* ── Map ── */}
        <View style={styles.sectionHeader}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>SERVICE AREA</ThemedText>
          <ThemedText variant="small" color="muted" style={styles.sectionSub}>
            {vertices.length < 3
              ? `Tap to draw boundary  (${vertices.length}/3 min)`
              : `${vertices.length} points  ·  polygon closed`}
          </ThemedText>
        </View>

        <ZoneMap
          vertices={vertices}
          onChange={setVertices}
          initialRegion={mapRegion}
        />

        {vertices.length > 0 && (
          <TouchableOpacity style={styles.clearRow} onPress={() => setVertices([])}>
            <ThemedText variant="small" color="accent">Clear boundary</ThemedText>
          </TouchableOpacity>
        )}

        <View style={styles.divider} />

        {/* ── Identity ── */}
        <View style={styles.sectionHeader}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>IDENTITY</ThemedText>
        </View>

        <View style={styles.fieldRow}>
          <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Hub Name *</ThemedText>
          <TextInput
            style={styles.fieldInput}
            value={hubName}
            onChangeText={setHubName}
            placeholder="e.g. North Zone Hub"
            placeholderTextColor={Theme.colors.text.muted}
          />
        </View>
        <View style={styles.hairline} />

        <View style={styles.fieldRow}>
          <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Hub Code</ThemedText>
          <TextInput
            style={styles.fieldInput}
            value={hubCode}
            onChangeText={setHubCode}
            placeholder="e.g. HUB-001"
            placeholderTextColor={Theme.colors.text.muted}
            autoCapitalize="characters"
          />
        </View>
        <View style={styles.hairline} />

        {/* Driver — branch driver who delivers to this hub (phone-picked from staff) */}
        <View style={styles.fieldBlock}>
          <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Driver *</ThemedText>
          <PhonePicker
            value={driver}
            onChange={setDriver}
            roleFilter="staff"
            labelNotFound="Not a staff member. Elevate them via Manage → Staff first."
            labelPlaceholder="Enter driver's 10-digit phone"
          />
        </View>

        <View style={styles.divider} />

        {/* ── Economics ── */}
        <View style={styles.sectionHeader}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>ECONOMICS</ThemedText>
        </View>

        <View style={styles.fieldRow}>
          <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Delivery Fee Override (₹)</ThemedText>
          <TextInput
            style={styles.fieldInput}
            value={deliveryFee}
            onChangeText={setDeliveryFee}
            placeholder="Blank to use zone / store default"
            placeholderTextColor={Theme.colors.text.muted}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.hairline} />

        <View style={styles.fieldRow}>
          <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Commission %</ThemedText>
          <TextInput
            style={styles.fieldInput}
            value={commissionPct}
            onChangeText={setCommissionPct}
            placeholder="Blank for no commission"
            placeholderTextColor={Theme.colors.text.muted}
            keyboardType="decimal-pad"
          />
        </View>

        <View style={styles.divider} />

        {/* ── Hub Operator (phone-picked registered customer) ── */}
        <View style={styles.sectionHeader}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>HUB OPERATOR</ThemedText>
        </View>
        <ThemedText variant="small" color="muted" style={styles.sectionHint}>
          Enter the operator's phone. They must be a registered customer. Assigning them unlocks "My Hub Dashboard" inside their Profile.
        </ThemedText>

        <View style={styles.fieldBlock}>
          <PhonePicker
            value={operator}
            onChange={setOperator}
            roleFilter={null}
            labelNotFound="No customer with this phone. They must register on the app first."
            labelPlaceholder="Enter operator's 10-digit phone"
          />
        </View>

        <View style={styles.divider} />

        {/* ── Coverage ── */}
        <View style={styles.sectionHeader}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>COVERAGE</ThemedText>
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <ThemedText variant="body" color="primary" style={{ fontSize: B }}>Extends Delivery Area</ThemedText>
            <ThemedText variant="small" color="muted" style={styles.toggleSub}>
              This hub covers addresses outside the base delivery boundary
            </ThemedText>
          </View>
          <Switch
            value={extendsCoverage}
            onValueChange={setExtendsCoverage}
            trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
            thumbColor={Theme.colors.text.primary}
          />
        </View>

        {/* ── Status (edit only) ── */}
        {isEditing && (
          <>
            <View style={styles.divider} />
            <View style={styles.sectionHeader}>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>STATUS</ThemedText>
            </View>
            <View style={styles.toggleRow}>
              <ThemedText variant="body" color="primary" style={{ fontSize: B }}>Hub Active</ThemedText>
              <Switch
                value={isActive}
                onValueChange={setIsActive}
                trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
                thumbColor={Theme.colors.text.primary}
              />
            </View>
            {!isActive && extendsCoverage && (
              <View style={styles.warningRow}>
                <ThemedText variant="small" color="accent" style={styles.warningText}>
                  Addresses outside the base delivery area that rely on this hub may lose coverage when disabled.
                </ThemedText>
              </View>
            )}
          </>
        )}

        <View style={{ height: Theme.spacing.xl * 2 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
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
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  save: { fontSize: B, minWidth: 60, textAlign: 'right' },

  sectionHeader: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  sectionLabel: { letterSpacing: 1, fontSize: S },
  sectionHint: {
    paddingHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
    fontSize: S - 1,
    fontStyle: 'italic',
  },
  sectionSub: { fontSize: S - 1 },

  clearRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs + 2,
    alignItems: 'flex-end',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.text.mint,
    marginHorizontal: Theme.spacing.md,
    marginTop: Theme.spacing.sm,
  },

  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
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

  staffSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  staffInfo: { flex: 1 },
  staffName: { fontSize: B, marginBottom: 2 },
  staffClear: { paddingHorizontal: Theme.spacing.sm },
  staffPickBtn: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  toggleInfo: { flex: 1, marginRight: Theme.spacing.md },
  toggleSub: { marginTop: 2 },

  warningRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  warningText: { fontSize: S },
});

