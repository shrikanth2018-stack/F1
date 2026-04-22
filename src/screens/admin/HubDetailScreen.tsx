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

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ZoneMap } from '../../components/ZoneMap';
import { useAddHub, useUpdateHub, useAssignHubAddresses } from '../../hooks/useDeliveryHubs';
import { useAllStaff } from '../../hooks/useStaffManagement';
import type { DeliveryHub } from '../../types';

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

interface Props {
  route: { params?: { hub?: DeliveryHub } };
  navigation: any;
}

export function HubDetailScreen({ route, navigation }: Props) {
  const existingHub = route.params?.hub as DeliveryHub | undefined;
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

  // Staff
  const [staffUserId, setStaffUserId] = useState<string | null>(existingHub?.staff_user_id ?? null);
  const [staffName, setStaffName] = useState(existingHub?.staff_name ?? '');
  const [staffPhone, setStaffPhone] = useState(existingHub?.staff_phone ?? '');
  const [staffSearch, setStaffSearch] = useState('');
  const [staffPickerVisible, setStaffPickerVisible] = useState(false);

  // Settings
  const [extendsCoverage, setExtendsCoverage] = useState(existingHub?.extends_coverage ?? false);
  const [isActive, setIsActive] = useState(existingHub?.is_active ?? true);

  const { data: allStaff = [] } = useAllStaff();
  const addHub = useAddHub();
  const updateHub = useUpdateHub();
  const assignAddresses = useAssignHubAddresses();

  const saving = addHub.isPending || updateHub.isPending || assignAddresses.isPending;

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

  const filteredStaff = useMemo(() => {
    const q = staffSearch.toLowerCase().trim();
    if (!q) return (allStaff as any[]).slice(0, 20);
    return (allStaff as any[]).filter(
      (s) =>
        s.full_name?.toLowerCase().includes(q) ||
        s.phone_number?.includes(q) ||
        s.employee_id?.toLowerCase().includes(q)
    );
  }, [allStaff, staffSearch]);

  const selectStaff = (staff: any) => {
    setStaffUserId(staff.id);
    setStaffName(staff.full_name ?? '');
    setStaffPhone(staff.phone_number ?? '');
    setStaffSearch('');
    setStaffPickerVisible(false);
  };

  const clearStaff = () => {
    setStaffUserId(null);
    setStaffName('');
    setStaffPhone('');
  };

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

    const center = computeCenter(vertices);
    const payload = {
      hub_name: hubName.trim(),
      hub_code: hubCode.trim() || null,
      polygon_geojson: vertices.length >= 3 ? vertices : null,
      center_lat: center.lat,
      center_lng: center.lng,
      staff_user_id: staffUserId,
      staff_name: staffName.trim() || null,
      staff_phone: staffPhone.trim() || null,
      extends_coverage: extendsCoverage,
    };

    try {
      if (isEditing) {
        await updateHub.mutateAsync({ id: existingHub!.id, ...payload, is_active: isActive });

        // Re-assign addresses if polygon is set
        if (vertices.length >= 3) {
          const savedHub: DeliveryHub = { ...existingHub!, ...payload, is_active: isActive };
          const count = await assignAddresses.mutateAsync(savedHub);
          if (count > 0) {
            Alert.alert(
              'Hub Saved',
              `${count} address${count !== 1 ? 'es' : ''} assigned to this hub.`,
              [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
            return;
          }
        }
      } else {
        const createdHub = await addHub.mutateAsync(payload) as DeliveryHub | null;
        if (!createdHub) throw new Error('Hub could not be created. Check database permissions and try again.');

        if (vertices.length >= 3) {
          const count = await assignAddresses.mutateAsync(createdHub);
          if (count > 0) {
            Alert.alert(
              'Hub Created',
              `${count} address${count !== 1 ? 'es' : ''} assigned to this hub.`,
              [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
            return;
          }
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

        <View style={styles.divider} />

        {/* ── Staff ── */}
        <View style={styles.sectionHeader}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>HUB OPERATOR</ThemedText>
        </View>

        {staffUserId ? (
          <View style={styles.staffSelected}>
            <View style={styles.staffInfo}>
              <ThemedText variant="body" color="primary" style={styles.staffName}>
                {staffName}
              </ThemedText>
              <ThemedText variant="small" color="muted">{staffPhone}</ThemedText>
            </View>
            <TouchableOpacity onPress={clearStaff} style={styles.staffClear}>
              <ThemedText variant="small" color="accent">Remove</ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.staffPickBtn} onPress={() => setStaffPickerVisible(true)} activeOpacity={0.7}>
            <ThemedText variant="body" color="muted" style={{ fontSize: B }}>
              Assign operator  ›
            </ThemedText>
          </TouchableOpacity>
        )}

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

      {/* Staff Picker Modal */}
      <Modal
        visible={staffPickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setStaffPickerVisible(false)}
      >
        <View style={[sp.container, { paddingTop: insets.top }]}>
          <View style={sp.header}>
            <TouchableOpacity onPress={() => setStaffPickerVisible(false)}>
              <ThemedText variant="body" color="accent">Cancel</ThemedText>
            </TouchableOpacity>
            <ThemedText variant="header" color="primary">Select Staff</ThemedText>
            <View style={{ width: 60 }} />
          </View>

          <View style={sp.searchRow}>
            <TextInput
              style={sp.searchInput}
              value={staffSearch}
              onChangeText={setStaffSearch}
              placeholder="Search by name, phone, or ID"
              placeholderTextColor={Theme.colors.text.muted}
              autoFocus
            />
          </View>

          <FlatList
            data={filteredStaff}
            keyExtractor={(item: any) => item.id}
            renderItem={({ item }: { item: any }) => (
              <TouchableOpacity style={sp.staffRow} onPress={() => selectStaff(item)} activeOpacity={0.7}>
                <View>
                  <ThemedText variant="body" color="primary" style={sp.staffName}>
                    {item.full_name}
                  </ThemedText>
                  <ThemedText variant="small" color="muted">
                    {item.phone_number}
                    {item.employee_id ? `  ·  ${item.employee_id}` : ''}
                    {item.designation ? `  ·  ${item.designation}` : ''}
                  </ThemedText>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={sp.empty}>
                <ThemedText variant="body" color="muted">No staff found</ThemedText>
              </View>
            }
            ItemSeparatorComponent={() => <View style={sp.separator} />}
          />
        </View>
      </Modal>
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

const sp = StyleSheet.create({
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
  searchRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  searchInput: {
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  staffRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  staffName: { fontSize: B, marginBottom: 2 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
    marginHorizontal: Theme.spacing.md,
  },
  empty: { padding: Theme.spacing.md },
});
