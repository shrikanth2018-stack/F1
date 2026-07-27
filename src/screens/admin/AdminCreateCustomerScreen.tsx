/**
 * 1stOne F1 — Add / Edit Customer (back office)
 *
 * Registers a customer from a phone number and a delivery address, or fixes
 * an existing address whose delivery area was never resolved.
 *
 * Deliberately a sibling of the customer-facing AddAddressScreen rather than
 * a section inside the order screen: address capture needs a map with room to
 * breathe, and a B2B account is often registered well before its first order.
 * Same division of labour as Checkout → AddAddress on the customer side.
 *
 * Serviceability follows the same rule as everywhere else — the
 * point-in-polygon decision is the server's (`resolve_address_serviceability`
 * via `checkZone`); the device only shows the answer. Moving the pin
 * re-resolves immediately, so the admin sees the zone or hub BEFORE saving
 * rather than discovering it at order time.
 *
 * The manual area picker is the escape hatch for a genuine B2B address that
 * sits outside every polygon — an explicit admin choice, verified server-side.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { PinMap } from '../../components/PinMap';
import { infoDialog } from '../../utils/confirmDialog';
import { getErrorMessage } from '../../utils/formatters';
import { checkZone, type ZoneCheckResult } from '../../utils/serviceability';
import { useDeliveryZones } from '../../hooks/useDeliveryZones';
import { useDeliveryHubs } from '../../hooks/useDeliveryHubs';
import {
  useCustomerByPhone,
  useCustomerAddresses,
  useCreateAdminCustomer,
} from '../../hooks/useAdminOrderEntry';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export function AdminCreateCustomerScreen({
  navigation,
  route,
}: AdminScreenProps<'AdminCreateCustomer'>) {
  const initialPhone = route.params?.phone ?? '';
  const editAddressId = route.params?.addressId;

  const [phone, setPhone] = useState(initialPhone);
  const [fullName, setFullName] = useState('');
  const [label, setLabel] = useState('Delivery');
  const [addressLine, setAddressLine] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');

  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [zoneResult, setZoneResult] = useState<ZoneCheckResult | null>(null);
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Manual override — only needed when the pin resolves to nothing.
  const [overrideKind, setOverrideKind] = useState<'zone' | 'hub'>('zone');
  const [overrideId, setOverrideId] = useState<number | null>(null);

  const { data: zones = [] } = useDeliveryZones();
  const { data: hubs = [] } = useDeliveryHubs();
  const { data: existing } = useCustomerByPhone(phone);
  const { data: addresses } = useCustomerAddresses(existing?.id);
  const save = useCreateAdminCustomer();

  // Editing an existing address — prefill from it once it loads.
  useEffect(() => {
    if (editAddressId == null || !addresses) return;
    const a = (addresses as any[]).find((x) => x.id === editAddressId);
    if (!a) return;
    setAddressLine((prev) => prev || a.address_line || '');
    setLabel((prev) => (prev === 'Delivery' ? a.label || 'Delivery' : prev));
  }, [editAddressId, addresses]);

  useEffect(() => {
    if (existing?.full_name) setFullName((prev) => prev || existing.full_name || '');
  }, [existing?.full_name]);

  const resolvePin = async (lat: number, lng: number) => {
    setResolving(true);
    try {
      const result = await checkZone(lat, lng);
      setZoneResult(result);
      // A pin that lands cleanly makes the manual override unnecessary.
      if (result.zoneId != null || result.hubId != null) setOverrideId(null);
    } finally {
      setResolving(false);
    }
  };

  const handleMapPin = async (lat: number, lng: number) => {
    setLatitude(lat);
    setLongitude(lng);
    await resolvePin(lat, lng);
  };

  const handleUseMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        infoDialog('Permission denied', 'Location access is needed to use the current position.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = loc.coords;
      setLatitude(lat);
      setLongitude(lng);
      await resolvePin(lat, lng);
    } catch {
      infoDialog('Could not get location', 'Tap the map to place the delivery pin instead.');
    } finally {
      setLocating(false);
    }
  };

  const pinRouted = (zoneResult?.zoneId ?? null) != null || (zoneResult?.hubId ?? null) != null;
  const routed = pinRouted || overrideId != null;

  const routingLabel = pinRouted
    ? zoneResult?.hubName
      ? `Hub · ${zoneResult.hubName}`
      : `Zone · ${zoneResult?.zoneName}`
    : overrideId != null
      ? `${overrideKind === 'hub' ? 'Hub' : 'Zone'} · ${
          overrideKind === 'hub'
            ? hubs.find((h) => h.id === overrideId)?.hub_name ?? ''
            : zones.find((z) => z.id === overrideId)?.zone_name ?? ''
        } (set manually)`
      : latitude != null
        ? 'This pin is outside every delivery area — choose one below'
        : 'Drop a pin, or choose the delivery area below';

  const handleSave = async () => {
    if (phone.replace(/\D/g, '').length < 10) {
      infoDialog('Phone required', 'Enter a valid 10-digit phone number.');
      return;
    }
    if (!fullName.trim()) {
      infoDialog('Name required', "Enter the customer's name.");
      return;
    }
    if (!addressLine.trim()) {
      infoDialog('Address required', 'Enter the delivery address.');
      return;
    }
    if (!routed) {
      infoDialog(
        'Delivery area required',
        'Move the pin inside a delivery area, or choose the zone or hub manually.',
      );
      return;
    }

    try {
      const res = await save.mutateAsync({
        phone,
        full_name: fullName.trim(),
        address_id: editAddressId,
        address: {
          label,
          address_line: addressLine.trim(),
          landmark: landmark.trim() || undefined,
          city: city.trim() || undefined,
          pincode: pincode.trim() || undefined,
          latitude,
          longitude,
          // The manual choice is sent only when the pin didn't resolve, so an
          // accidental leftover selection can never override a good pin.
          zone_id: !pinRouted && overrideKind === 'zone' ? overrideId : null,
          hub_id: !pinRouted && overrideKind === 'hub' ? overrideId : null,
        },
      });
      navigation.goBack();
      setTimeout(
        () =>
          infoDialog(
            res.created ? 'Customer registered' : 'Address saved',
            `${fullName.trim()} · ${routingLabel}`,
          ),
        450,
      );
    } catch (e) {
      infoDialog('Could not save', getErrorMessage(e));
    }
  };

  const areaOptions = (overrideKind === 'zone' ? zones : hubs).filter((a: any) => a.is_active);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          {editAddressId != null ? 'Edit Address' : 'Add Customer'}
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>CUSTOMER</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="Phone number (10 digits)"
          placeholderTextColor={Theme.colors.text.muted}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={13}
          editable={editAddressId == null}
        />
        {existing && (
          <ThemedText variant="small" color="mint" style={styles.hint}>
            Existing customer — the address below is added to their account.
          </ThemedText>
        )}
        <TextInput
          style={styles.input}
          placeholder="Customer name"
          placeholderTextColor={Theme.colors.text.muted}
          value={fullName}
          onChangeText={setFullName}
        />

        <Divider />

        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>DELIVERY ADDRESS</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="Address"
          placeholderTextColor={Theme.colors.text.muted}
          value={addressLine}
          onChangeText={setAddressLine}
          multiline
        />
        <TextInput
          style={styles.input}
          placeholder="Landmark (optional)"
          placeholderTextColor={Theme.colors.text.muted}
          value={landmark}
          onChangeText={setLandmark}
        />
        <View style={styles.row2}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder="City"
            placeholderTextColor={Theme.colors.text.muted}
            value={city}
            onChangeText={setCity}
          />
          <TextInput
            style={[styles.input, styles.pincode]}
            placeholder="Pincode"
            placeholderTextColor={Theme.colors.text.muted}
            value={pincode}
            onChangeText={setPincode}
            keyboardType="numeric"
            maxLength={6}
          />
        </View>

        {/* Map + live resolution */}
        <View style={styles.pinHeaderRow}>
          <ThemedText variant="small" color="muted" style={[styles.sectionLabel, styles.flex1]}>
            DELIVERY PIN
          </ThemedText>
          <TouchableOpacity onPress={handleUseMyLocation} disabled={locating}>
            {locating
              ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
              : <ThemedText variant="small" color="mint">Use my location</ThemedText>}
          </TouchableOpacity>
        </View>

        <View style={styles.mapBox}>
          <PinMap latitude={latitude} longitude={longitude} onLocationChange={handleMapPin} />
        </View>

        <View style={styles.resultRow}>
          {resolving && <ActivityIndicator color={Theme.colors.text.mint} size="small" />}
          <ThemedText
            variant="small"
            color={routed ? 'mint' : 'muted'}
            style={[styles.hint, styles.flex1]}
          >
            {routingLabel}
          </ThemedText>
        </View>

        {/* Manual override — only when the pin didn't resolve */}
        {!pinRouted && (
          <>
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
              OR SET THE AREA MANUALLY
            </ThemedText>
            <View style={styles.pillRow}>
              {(['zone', 'hub'] as const).map((k) => (
                <TouchableOpacity
                  key={k}
                  style={[styles.pill, overrideKind === k && styles.pillActive]}
                  onPress={() => { setOverrideKind(k); setOverrideId(null); }}
                  activeOpacity={0.7}
                >
                  <ThemedText variant="small" color={overrideKind === k ? 'mint' : 'muted'}>
                    {k === 'zone' ? 'Zone (direct)' : 'Hub'}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.pillWrap}>
              {areaOptions.map((a: any) => {
                const active = overrideId === a.id;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => setOverrideId(a.id)}
                    activeOpacity={0.7}
                  >
                    <ThemedText variant="small" color={active ? 'mint' : 'muted'}>
                      {overrideKind === 'zone' ? a.zone_name : a.hub_name}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.footer}
        onPress={handleSave}
        disabled={save.isPending}
        activeOpacity={0.7}
      >
        {save.isPending
          ? <ActivityIndicator color={Theme.colors.text.mint} />
          : <ThemedText variant="body" color="mint" style={styles.txt}>
              {editAddressId != null ? 'Save address  ›' : 'Save customer  ›'}
            </ThemedText>}
      </TouchableOpacity>
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
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  scroll: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },

  sectionLabel: { fontSize: S, letterSpacing: 1, marginTop: Theme.spacing.md, marginBottom: Theme.spacing.xs },
  hint: { fontSize: S, marginTop: 2, marginBottom: Theme.spacing.xs },

  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  row2: { flexDirection: 'row', gap: Theme.spacing.sm },
  flex1: { flex: 1 },
  pincode: { width: 120 },

  pinHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  mapBox: {
    height: 260,
    borderRadius: Theme.components.inputRadius,
    overflow: 'hidden',
    marginBottom: Theme.spacing.xs,
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },

  pillRow: { flexDirection: 'row', gap: Theme.spacing.sm, marginBottom: Theme.spacing.xs },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm, marginBottom: Theme.spacing.sm },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  pillActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
    alignItems: 'center',
  },

  txt: { fontSize: B },
});
