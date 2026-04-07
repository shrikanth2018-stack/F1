/**
 * 1stOne F1 — Add Address Screen
 * Simple form: label, full name, address line, landmark, city, pincode.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  Alert,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedInput } from '../../components/ThemedInput';
import { ThemedButton } from '../../components/ThemedButton';
import { useAddAddress } from '../../hooks/useAddresses';
import { isNonEmpty, isValidPincode } from '../../utils/validators';

export function AddAddressScreen({ navigation }: any) {
  const [label, setLabel] = useState('Home');
  const [fullName, setFullName] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');

  const { mutateAsync: addAddress, isPending } = useAddAddress();

  const handleSave = async () => {
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
        label: label || 'Home',
        full_name: fullName.trim(),
        address_line: addressLine.trim(),
        landmark: landmark.trim() || undefined,
        city: city.trim() || undefined,
        pincode: pincode.trim() || undefined,
        is_default: true,
      });

      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save address');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">
              ‹ Back
            </ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">
            Add Address
          </ThemedText>
          <View style={{ width: 40 }} />
        </View>

        <ThemedInput
          label="Label"
          placeholder="Home, Office, etc."
          value={label}
          onChangeText={setLabel}
        />
        <ThemedInput
          label="Full Name"
          placeholder="Recipient name"
          value={fullName}
          onChangeText={setFullName}
        />
        <ThemedInput
          label="Address"
          placeholder="Building, street, area"
          value={addressLine}
          onChangeText={setAddressLine}
          multiline
        />
        <ThemedInput
          label="Landmark"
          placeholder="Near..."
          value={landmark}
          onChangeText={setLandmark}
        />
        <ThemedInput
          label="City"
          placeholder="City"
          value={city}
          onChangeText={setCity}
        />
        <ThemedInput
          label="Pincode"
          placeholder="6-digit pincode"
          value={pincode}
          onChangeText={setPincode}
          keyboardType="number-pad"
          maxLength={6}
        />

        <ThemedButton
          title="Save Address"
          onPress={handleSave}
          loading={isPending}
          style={styles.saveBtn}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  content: {
    padding: Theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  saveBtn: {
    marginTop: Theme.spacing.lg,
  },
});
