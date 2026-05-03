/**
 * 1stOne F1 — Combined Onboarding Screen
 *
 * Single-screen flow for new customers after OTP verify:
 * - Profile: full name (writes to both profiles.full_name and customer_addresses.full_name)
 * - First delivery address: label + map pin/GPS + address fields
 * - Atomic save via complete_onboarding_atomic RPC
 *
 * Replaces the legacy two-screen flow (RegistrationScreen +
 * post-OTP AddAddressScreen). The customer-flow AddAddressScreen
 * for adding additional addresses is unchanged.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  Alert,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedInput } from '../../components/ThemedInput';
import { PinMap } from '../../components/PinMap';
import { useCompleteOnboarding } from '../../hooks/useCompleteOnboarding';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useAuth } from '../../hooks/useAuth';
import { isNonEmpty } from '../../utils/validators';
import { checkZone, pointInPolygon, ZoneCheckResult } from '../../utils/serviceability';
import { supabase } from '../../api/supabaseClient';

const LABELS = ['Home', 'Office', 'Other'] as const;
type LabelType = typeof LABELS[number];

interface OnboardingScreenProps {
  phone: string;
  onComplete: () => void;
  onBack: () => void;
}

export function OnboardingScreen({ phone, onComplete, onBack }: OnboardingScreenProps) {
  const { session } = useAuth();
  const { mutateAsync: completeOnboarding, isPending } = useCompleteOnboarding();
  const hubDeliveryActive = useFeatureFlag('hub_delivery_active');

  // Profile field
  const [fullName, setFullName] = useState('');

  // Address fields
  const [label, setLabel] = useState<LabelType>('Home');
  const [addressLine, setAddressLine] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');

  // Location
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [locating, setLocating] = useState(false);
  const [zoneResult, setZoneResult] = useState<ZoneCheckResult | null>(null);

  // Submit-side spinner — covers the hub query plus the RPC call
  // (isPending only covers the RPC).
  const [submitting, setSubmitting] = useState(false);

  // Once the user types in the pincode field, stop auto-filling from
  // reverse-geocode. Ref instead of state so async geocode callbacks
  // see the latest value without stale-closure issues.
  const pincodeManuallyEditedRef = useRef(false);

  const runChecks = async (lat: number, lng: number) => {
    const result = await checkZone(lat, lng);
    setZoneResult(result);
  };

  const tryReverseGeocodeForPincode = async (lat: number, lng: number) => {
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      const postal = results[0]?.postalCode;
      if (postal && !pincodeManuallyEditedRef.current) {
        setPincode(postal);
      }
    } catch {
      // Silent — pincode is optional, network blip shouldn't surface.
    }
  };

  const applyLocation = async (lat: number, lng: number) => {
    setLatitude(lat);
    setLongitude(lng);
    await Promise.all([
      runChecks(lat, lng),
      tryReverseGeocodeForPincode(lat, lng),
    ]);
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
      await applyLocation(loc.coords.latitude, loc.coords.longitude);
    } catch {
      Alert.alert('Error', 'Could not fetch location. Please tap the map to set your delivery pin.');
    } finally {
      setLocating(false);
    }
  };

  const handleMapPin = async (lat: number, lng: number) => {
    await applyLocation(lat, lng);
  };

  const handlePincodeChange = (value: string) => {
    setPincode(value);
    pincodeManuallyEditedRef.current = true;
  };

  // Auto-fetch GPS on mount; silent on permission denial — user can tap
  // the map manually or use the GPS button later.
  useEffect(() => {
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
        await applyLocation(loc.coords.latitude, loc.coords.longitude);
      } catch {
        // Silent — user can pin manually.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = () => {
    if (!isNonEmpty(fullName)) {
      Alert.alert('Required', 'Please enter your full name');
      return;
    }
    if (!isNonEmpty(addressLine)) {
      Alert.alert('Required', 'Please enter your address');
      return;
    }
    if (latitude == null || longitude == null) {
      Alert.alert('Location Required', 'Please tap the map or use GPS to set your delivery location.');
      return;
    }

    if (zoneResult?.result === 'not_serviceable') {
      Alert.alert(
        'Outside Delivery Area',
        "This area isn't in our delivery zone yet, but we'll notify you when we expand. You can still sign up and browse.",
        [
          { text: 'Adjust the Pin' },
          { text: 'Enter Anyway', onPress: () => doSave() },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    doSave();
  };

  const doSave = async () => {
    if (!session?.user.id) {
      Alert.alert('Session Error', 'Please sign in again.');
      onBack();
      return;
    }
    if (latitude == null || longitude == null) return;  // re-guard for type narrowing

    setSubmitting(true);
    try {
      // Hub assignment — same client-side polygon match as AddAddressScreen.
      let hubId: number | null = null;
      if (hubDeliveryActive) {
        const { data: hubs } = await supabase
          .from('delivery_hubs')
          .select('id, polygon_geojson')
          .eq('is_active', true);
        const matched = (hubs ?? []).find(
          (h: any) =>
            Array.isArray(h.polygon_geojson) &&
            h.polygon_geojson.length >= 3 &&
            pointInPolygon(latitude, longitude, h.polygon_geojson),
        );
        hubId = matched?.id ?? null;
      }

      await completeOnboarding({
        user_id: session.user.id,
        phone_number: phone,
        full_name: fullName.trim(),
        label,
        address_line: addressLine.trim(),
        landmark: landmark.trim() || null,
        city: city.trim() || null,
        pincode: pincode.trim() || null,
        latitude,
        longitude,
        zone_id: zoneResult?.zoneId ?? null,
        hub_id: hubId,
        is_serviceable: zoneResult?.result === 'serviceable',
      });

      onComplete();
    } catch (err: any) {
      Alert.alert('Could not complete sign-up', err?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const isBusy = submitting || isPending;

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
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <ThemedText variant="header" color="primary">Welcome to 1stOne</ThemedText>
            <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <ThemedText variant="body" color="muted">Sign out</ThemedText>
            </TouchableOpacity>
          </View>
          <ThemedText variant="body" color="subtitle" style={styles.subtitle}>
            {phone}
          </ThemedText>

          <View style={styles.hairline} />

          {/* Full name — writes to both profiles.full_name and customer_addresses.full_name */}
          <ThemedInput
            mode="underline"
            placeholder="Full name"
            value={fullName}
            onChangeText={setFullName}
            autoFocus
          />

          <View style={styles.hairline} />

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

          {/* Map pin — drag or tap to position */}
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

          {/* Address fields */}
          <ThemedInput
            mode="underline"
            placeholder="Building, street, area"
            value={addressLine}
            onChangeText={setAddressLine}
            multiline
          />
          <ThemedInput
            mode="underline"
            placeholder="Landmark (optional)"
            value={landmark}
            onChangeText={setLandmark}
          />
          <ThemedInput
            mode="underline"
            placeholder="City (optional)"
            value={city}
            onChangeText={setCity}
          />
          <ThemedInput
            mode="underline"
            placeholder="Pincode (optional)"
            value={pincode}
            onChangeText={handlePincodeChange}
            keyboardType="number-pad"
          />

          <View style={styles.hairline} />

          <TouchableOpacity
            style={styles.submitRow}
            onPress={handleSubmit}
            activeOpacity={0.6}
            disabled={isBusy}
          >
            {isBusy
              ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
              : <ThemedText variant="subtitle" color="mint">Get Started  ›</ThemedText>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  kav: { flex: 1 },
  content: { paddingBottom: Theme.spacing.xl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  subtitle: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
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
  labelTabTextActive: { fontWeight: '600' },
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
