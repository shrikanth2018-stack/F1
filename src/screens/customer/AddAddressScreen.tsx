/**
 * 1stOne F1 — Add Address Screen
 * No cards/boxes. Label tabs, underline fields, location pin with serviceability indicator.
 * Used from both profile (navigation prop) and onboarding (onComplete prop).
 */

import React, { useState } from 'react';
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
import { useAddAddress } from '../../hooks/useAddresses';
import { isNonEmpty } from '../../utils/validators';
import { checkServiceability, ServiceabilityResult } from '../../utils/serviceability';

const LABELS = ['Home', 'Office', 'Other'] as const;
type LabelType = typeof LABELS[number];

interface Props {
  navigation?: any;
  onComplete?: () => void;
}

export function AddAddressScreen({ navigation, onComplete }: Props) {
  const [label, setLabel] = useState<LabelType>('Home');
  const [fullName, setFullName] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [locating, setLocating] = useState(false);
  const [serviceability, setServiceability] = useState<ServiceabilityResult | null>(null);

  const { mutateAsync: addAddress, isPending } = useAddAddress();

  const handlePinLocation = async () => {
    setLocating(true);
    setServiceability(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location access is needed to pin your delivery address.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = loc.coords;
      setLatitude(lat);
      setLongitude(lng);
      const result = await checkServiceability(lat, lng);
      setServiceability(result);
    } catch {
      Alert.alert('Error', 'Could not fetch location. Please try again.');
    } finally {
      setLocating(false);
    }
  };

  const handleAdd = async () => {
    if (!isNonEmpty(fullName)) {
      Alert.alert('Required', 'Please enter full name');
      return;
    }
    if (!isNonEmpty(addressLine)) {
      Alert.alert('Required', 'Please enter address');
      return;
    }

    try {
      await addAddress({
        label,
        full_name: fullName.trim(),
        address_line: addressLine.trim(),
        landmark: landmark.trim() || undefined,
        city: city.trim() || undefined,
        latitude,
        longitude,
        is_default: true,
      });

      if (onComplete) {
        onComplete();
      } else {
        navigation?.goBack();
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save address');
    }
  };

  const serviceabilityColor =
    serviceability === 'serviceable'
      ? Theme.colors.status.success
      : serviceability === 'not_serviceable'
      ? Theme.colors.status.error
      : Theme.colors.text.muted;

  const serviceabilityText =
    serviceability === 'serviceable'
      ? 'Area is serviceable'
      : serviceability === 'not_serviceable'
      ? 'Outside delivery area — we will notify when available'
      : '';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => onComplete ? onComplete() : navigation?.goBack()}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">Add Address</ThemedText>
          <View style={{ width: 40 }} />
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

        {/* Fields — underline only */}
        <ThemedInput mode="underline" placeholder="Full name" value={fullName} onChangeText={setFullName} />
        <ThemedInput mode="underline" placeholder="Building, street, area" value={addressLine} onChangeText={setAddressLine} multiline />
        <ThemedInput mode="underline" placeholder="Landmark (optional)" value={landmark} onChangeText={setLandmark} />
        <ThemedInput mode="underline" placeholder="City (optional)" value={city} onChangeText={setCity} />

        {/* Location pin */}
        <TouchableOpacity
          style={styles.locationRow}
          onPress={handlePinLocation}
          activeOpacity={0.6}
          disabled={locating}
        >
          {locating ? (
            <ActivityIndicator color={Theme.colors.text.mint} size="small" />
          ) : (
            <ThemedText variant="body" color={latitude != null ? 'mint' : 'muted'}>
              {latitude != null
                ? `Location pinned · ${latitude.toFixed(4)}, ${longitude?.toFixed(4)}`
                : '⊕  Pin my location'}
            </ThemedText>
          )}
        </TouchableOpacity>

        {/* Serviceability indicator */}
        {serviceabilityText !== '' && (
          <View style={styles.serviceRow}>
            <ThemedText variant="small" color="primary" style={{ color: serviceabilityColor }}>
              {serviceability === 'serviceable' ? '✓  ' : '✕  '}{serviceabilityText}
            </ThemedText>
          </View>
        )}

        <View style={styles.hairline} />

        {/* Submit — plain text link */}
        <TouchableOpacity
          style={styles.submitRow}
          onPress={handleAdd}
          activeOpacity={0.6}
          disabled={isPending}
        >
          {isPending
            ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
            : <ThemedText variant="subtitle" color="mint">Add Address  ›</ThemedText>
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
  labelTabTextActive: { fontWeight: '600' },
  locationRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  serviceRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  submitRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    alignItems: 'flex-end',
  },
});
