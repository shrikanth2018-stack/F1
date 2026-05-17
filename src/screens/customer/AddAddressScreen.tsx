/**
 * 1stOne F1 — Add Address Screen
 *
 * Interactive map pin — drag or tap anywhere to set delivery location.
 * GPS "Use my location" button centers the pin on current position.
 * Being away from home is fine — pin wherever you want delivery.
 *
 * On save:
 *   1. Zone check (polygon serviceability)
 *   2. Hub assignment (if hub_delivery_active)
 *   3. Non-serviceable addresses saved with notify-when-available note
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  Alert,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedInput } from '../../components/ThemedInput';
import { PinMap } from '../../components/PinMap';
import { useAddAddress, useUpdateAddress, useAddresses } from '../../hooks/useAddresses';
import { useAuth } from '../../hooks/useAuth';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { isNonEmpty, isValidIndianPhone, normalizePhone } from '../../utils/validators';
import { checkZone, pointInPolygon, ZoneCheckResult } from '../../utils/serviceability';
import { supabase } from '../../api/supabaseClient';

const LABELS = ['Home', 'Office', 'Other'] as const;
type LabelType = typeof LABELS[number];

interface Props {
  navigation?: any;
  route?: { params?: { addressId?: number } };
  onComplete?: () => void;
}

export function AddAddressScreen({ navigation, route, onComplete }: Props) {
  const editingId = route?.params?.addressId;
  const isEditMode = editingId != null;
  const [label, setLabel] = useState<LabelType>('Home');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [locating, setLocating] = useState(false);
  const [zoneResult, setZoneResult] = useState<ZoneCheckResult | null>(null);

  const { mutateAsync: addAddress, isPending: isAdding } = useAddAddress();
  const { mutateAsync: updateAddress, isPending: isUpdating } = useUpdateAddress();
  const isPending = isAdding || isUpdating;
  const { data: existingAddresses } = useAddresses();
  const editingAddress = isEditMode
    ? existingAddresses?.find((a) => a.id === editingId)
    : undefined;
  const { session } = useAuth();
  const hubDeliveryActive = useFeatureFlag('hub_delivery_active');

  const runChecks = async (lat: number, lng: number) => {
    const result = await checkZone(lat, lng);
    setZoneResult(result);
  };

  const handleUseMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location access is needed to use your current position.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = loc.coords;
      setLatitude(lat);
      setLongitude(lng);
      await runChecks(lat, lng);
    } catch {
      Alert.alert('Error', 'Could not fetch location. Please tap the map to set your delivery pin.');
    } finally {
      setLocating(false);
    }
  };

  const handleMapPin = async (lat: number, lng: number) => {
    setLatitude(lat);
    setLongitude(lng);
    await runChecks(lat, lng);
  };

  // Edit mode: prefill all fields from the existing address row.
  // Add mode: prefill phone only, from the login phone.
  useEffect(() => {
    if (isEditMode && editingAddress) {
      if (LABELS.includes(editingAddress.label as LabelType)) {
        setLabel(editingAddress.label as LabelType);
      }
      setFullName(editingAddress.full_name ?? '');
      setPhone(editingAddress.phone_number ?? session?.user.phone ?? '');
      setAddressLine(editingAddress.address_line ?? '');
      setLandmark(editingAddress.landmark ?? '');
      setCity(editingAddress.city ?? '');
      if (editingAddress.latitude != null && editingAddress.longitude != null) {
        setLatitude(editingAddress.latitude);
        setLongitude(editingAddress.longitude);
        runChecks(editingAddress.latitude, editingAddress.longitude);
      }
    } else if (!isEditMode && !phone && session?.user.phone) {
      setPhone(session.user.phone);
    }
  }, [isEditMode, editingAddress?.id, session?.user.phone]);

  // Auto-fetch GPS on mount so the map opens centered on user's current spot.
  // Silent failure: if permission denied, user can still tap the map manually.
  // Skip in edit mode — we're showing the address's saved pin, not a fresh GPS lock.
  useEffect(() => {
    if (isEditMode) return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          const req = await Location.requestForegroundPermissionsAsync();
          if (req.status !== 'granted') return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const { latitude: lat, longitude: lng } = loc.coords;
        setLatitude(lat);
        setLongitude(lng);
        await runChecks(lat, lng);
      } catch {
        // Silent — user can pin manually or tap "Use my current location" button.
      }
    })();
    return () => { cancelled = true; };
  }, [isEditMode]);

  const handleAdd = async () => {
    if (!isNonEmpty(fullName)) {
      Alert.alert('Required', 'Please enter full name');
      return;
    }
    if (!isValidIndianPhone(phone)) {
      Alert.alert('Required', 'Please enter a valid 10-digit phone number for this address');
      return;
    }
    if (!isNonEmpty(addressLine)) {
      Alert.alert('Required', 'Please enter address');
      return;
    }
    if (latitude == null || longitude == null) {
      Alert.alert('Location Required', 'Please tap the map or use GPS to set your delivery location.');
      return;
    }

    if (zoneResult?.result === 'not_serviceable') {
      Alert.alert(
        'Outside Delivery Area',
        "We don't deliver to this pin yet. You can move the pin to a valid location (e.g., your office), or enter anyway to browse — we'll notify you when we expand.",
        [
          { text: 'Adjust the Pin' },
          { text: 'Enter Anyway', onPress: () => saveAddress() },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    await saveAddress();
  };

  const saveAddress = async () => {
    try {
      // Hub assignment — find which hub polygon this address falls in
      let hubId: number | null = null;
      if (hubDeliveryActive && latitude != null && longitude != null) {
        const { data: hubs } = await supabase
          .from('delivery_hubs')
          .select('id, polygon_geojson')
          .eq('is_active', true);

        const matchingHub = (hubs ?? []).find(
          (h: any) =>
            Array.isArray(h.polygon_geojson) &&
            h.polygon_geojson.length >= 3 &&
            pointInPolygon(latitude!, longitude!, h.polygon_geojson)
        );
        hubId = matchingHub?.id ?? null;
      }

      const basePayload = {
        label,
        full_name: fullName.trim(),
        phone_number: normalizePhone(phone),
        address_line: addressLine.trim(),
        landmark: landmark.trim() || undefined,
        city: city.trim() || undefined,
        latitude,
        longitude,
        zone_id: zoneResult?.zoneId ?? null,
        hub_id: hubId,
        is_serviceable: zoneResult?.result === 'serviceable',
      };

      if (isEditMode && editingId != null) {
        // Edit mode: update in place, leave is_default untouched.
        await updateAddress({ id: editingId, ...basePayload });
      } else {
        // Add mode: only auto-mark as default if this is the user's first active
        // address. Otherwise leave default unchanged so they can pick via
        // the "Set default" toggle on AddressesScreen — the partial unique
        // index would reject a second default anyway.
        let isFirstAddress = true;
        const userId = session?.user.id;
        if (userId) {
          const { count } = await supabase
            .from('customer_addresses')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_active', true);
          isFirstAddress = (count ?? 0) === 0;
        }
        await addAddress({ ...basePayload, is_default: isFirstAddress });
      }

      if (onComplete) {
        onComplete();
      } else {
        navigation?.goBack();
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save address');
    }
  };

  const indicatorColor =
    zoneResult?.result === 'serviceable'
      ? Theme.colors.status.success
      : zoneResult?.result === 'not_serviceable'
      ? Theme.colors.status.error
      : Theme.colors.text.muted;

  const indicatorText =
    zoneResult?.result === 'serviceable'
      ? `✓  Serviceable${zoneResult.zoneName ? ` · ${zoneResult.zoneName}` : zoneResult.hubName ? ` · ${zoneResult.hubName} (hub delivery)` : ''}`
      : zoneResult?.result === 'not_serviceable'
      ? '✕  Outside delivery area — we will notify you when available'
      : '';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <ThemedText variant="header" color="primary">{isEditMode ? 'Edit Address' : 'Add Address'}</ThemedText>
          <TouchableOpacity onPress={() => onComplete ? onComplete() : navigation?.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ThemedText variant="body" color="muted">Close</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Label tabs */}
        <View style={styles.labelRow}>
          {LABELS.map((l) => (
            <TouchableOpacity
              key={l}
              style={[styles.labelTab, label === l && styles.labelTabActive]}
              onPress={() => setLabel(l)}
              activeOpacity={0.6}
            >
              <ThemedText
                variant="body"
                color={label === l ? 'mint' : 'muted'}
                style={label === l ? styles.labelTabTextActive : undefined}
              >
                {l}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.hairline} />

        {/* Interactive map pin */}
        <PinMap
          latitude={latitude}
          longitude={longitude}
          onLocationChange={handleMapPin}
        />

        {/* GPS helper + zone indicator */}
        <View style={styles.mapFooter}>
          <TouchableOpacity
            onPress={handleUseMyLocation}
            activeOpacity={0.6}
            disabled={locating}
            style={styles.gpsBtn}
          >
            {locating ? (
              <ActivityIndicator color={Theme.colors.text.mint} size="small" />
            ) : (
              <ThemedText variant="small" color="mint">⊕  Use my current location</ThemedText>
            )}
          </TouchableOpacity>

          {indicatorText !== '' && (
            <ThemedText variant="small" color="primary" style={[styles.indicator, { color: indicatorColor }]}>
              {indicatorText}
            </ThemedText>
          )}
        </View>

        <View style={styles.hairline} />

        <ThemedInput mode="underline" placeholder="Full name" value={fullName} onChangeText={setFullName} />
        <ThemedInput
          mode="underline"
          placeholder="Phone for delivery (10 digits)"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <ThemedInput mode="underline" placeholder="Building, street, area" value={addressLine} onChangeText={setAddressLine} multiline />
        <ThemedInput mode="underline" placeholder="Landmark (optional)" value={landmark} onChangeText={setLandmark} />
        <ThemedInput mode="underline" placeholder="City (optional)" value={city} onChangeText={setCity} />

        <View style={styles.hairline} />

        <TouchableOpacity
          style={styles.submitRow}
          onPress={handleAdd}
          activeOpacity={0.6}
          disabled={isPending}
        >
          {isPending
            ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
            : <ThemedText variant="subtitle" color="mint">{isEditMode ? 'Save Changes  ›' : 'Add Address  ›'}</ThemedText>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { paddingBottom: Theme.spacing.xl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.text.mint,
    marginHorizontal: Theme.spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.sm + 4,
    gap: Theme.spacing.lg,
  },
  labelTab: {
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  labelTabActive: { borderBottomColor: Theme.colors.text.mint },
  labelTabTextActive: {  },
  mapFooter: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    gap: Theme.spacing.xs,
  },
  gpsBtn: { alignSelf: 'flex-start' },
  indicator: { marginTop: 2 },
  submitRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    alignItems: 'flex-end',
  },
});
