/**
 * 1stOne F1 — Login Screen
 * Phone number input → sends OTP via Supabase Auth.
 * Clean, minimal design per blueprint UX.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedInput } from '../../components/ThemedInput';
import { ThemedButton } from '../../components/ThemedButton';
import { useAuth } from '../../hooks/useAuth';
import { isValidIndianPhone, normalizePhone } from '../../utils/validators';

interface LoginScreenProps {
  onOTPSent: (phone: string) => void;
}

export function LoginScreen({ onOTPSent }: LoginScreenProps) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const { signInWithPhone } = useAuth();

  const handleSendOTP = async () => {
    if (!isValidIndianPhone(phone)) {
      Alert.alert('Invalid Number', 'Please enter a valid 10-digit mobile number');
      return;
    }

    setLoading(true);
    const normalized = normalizePhone(phone);
    const { error } = await signInWithPhone(normalized);
    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    onOTPSent(normalized);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <ThemedText variant="title" color="primary" style={styles.brand}>
          1stOne
        </ThemedText>
        <ThemedText variant="body" color="subtitle" style={styles.tagline}>
          Pure Vegetarian
        </ThemedText>

        <View style={styles.form}>
          <ThemedInput
            label="Mobile Number"
            placeholder="Enter 10-digit number"
            keyboardType="phone-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
            autoFocus
          />

          <ThemedButton
            title="Send OTP"
            onPress={handleSendOTP}
            loading={loading}
            disabled={phone.length < 10}
            style={styles.button}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    padding: Theme.spacing.xl,
  },
  brand: {
    textAlign: 'center',
    letterSpacing: Theme.typography.letterSpacing.wide,
  },
  tagline: {
    textAlign: 'center',
    marginTop: Theme.spacing.xs,
    marginBottom: Theme.spacing.xl * 2,
  },
  form: {
    width: '100%',
  },
  button: {
    marginTop: Theme.spacing.md,
  },
});
