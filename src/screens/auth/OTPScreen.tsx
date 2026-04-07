/**
 * 1stOne F1 — OTP Verification Screen
 * 6-digit OTP input → verifies via Supabase Auth.
 * Auto-submits when 6 digits entered.
 */

import React, { useState, useEffect } from 'react';
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
import { isValidOTP } from '../../utils/validators';
import { formatPhone } from '../../utils/formatters';

interface OTPScreenProps {
  phone: string;
  onBack: () => void;
}

export function OTPScreen({ phone, onBack }: OTPScreenProps) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const { verifyOTP } = useAuth();

  const handleVerify = async () => {
    if (!isValidOTP(otp)) {
      Alert.alert('Invalid OTP', 'Please enter the 6-digit code');
      return;
    }

    setLoading(true);
    const { error } = await verifyOTP(phone, otp);
    setLoading(false);

    if (error) {
      Alert.alert('Verification Failed', error.message);
      setOtp('');
    }
    // Success: auth state change triggers navigation automatically
  };

  // Auto-submit on 6 digits
  useEffect(() => {
    if (otp.length === 6 && isValidOTP(otp)) {
      handleVerify();
    }
  }, [otp]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Enter OTP
        </ThemedText>
        <ThemedText variant="body" color="subtitle" style={styles.subtitle}>
          Sent to {formatPhone(phone)}
        </ThemedText>

        <View style={styles.form}>
          <ThemedInput
            placeholder="6-digit OTP"
            keyboardType="number-pad"
            maxLength={6}
            value={otp}
            onChangeText={setOtp}
            autoFocus
            style={styles.otpInput}
          />

          <ThemedButton
            title="Verify"
            onPress={handleVerify}
            loading={loading}
            disabled={otp.length < 6}
            style={styles.button}
          />

          <ThemedButton
            title="Change Number"
            variant="text"
            onPress={onBack}
            style={styles.backButton}
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
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    marginTop: Theme.spacing.xs,
    marginBottom: Theme.spacing.xl,
  },
  form: {
    width: '100%',
  },
  otpInput: {
    textAlign: 'center',
    fontSize: Theme.typography.sizes.header,
    letterSpacing: 12,
  },
  button: {
    marginTop: Theme.spacing.md,
  },
  backButton: {
    marginTop: Theme.spacing.md,
  },
});
