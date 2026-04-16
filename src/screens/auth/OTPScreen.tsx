/**
 * 1stOne F1 — OTP Verification Screen
 * Plain text layout. Auto-submits at 6 digits.
 * For new users: creates profile record after verification.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedInput } from '../../components/ThemedInput';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../api/supabaseClient';
import { isValidOTP } from '../../utils/validators';
import { formatPhone } from '../../utils/formatters';

interface OTPScreenProps {
  phone: string;
  onBack: () => void;
  onExistingUser: () => void;
  onNewUser: () => void;
}

export function OTPScreen({ phone, onBack, onExistingUser, onNewUser }: OTPScreenProps) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const isVerifyingRef = useRef(false);
  const { verifyOTP } = useAuth();

  const handleVerify = async () => {
    if (isVerifyingRef.current) return;
    if (!isValidOTP(otp)) {
      Alert.alert('Invalid OTP', 'Please enter the 6-digit code');
      return;
    }

    isVerifyingRef.current = true;
    setLoading(true);
    const { error } = await verifyOTP(phone, otp);

    if (error) {
      setLoading(false);
      isVerifyingRef.current = false;
      Alert.alert('Verification Failed', error.message);
      setOtp('');
      return;
    }

    // Check if profile exists — determines new vs returning user
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('phone_number', phone)
      .maybeSingle();

    setLoading(false);
    isVerifyingRef.current = false;
    if (profile) {
      onExistingUser();
    } else {
      onNewUser();
    }
  };

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
        <TouchableOpacity onPress={onBack} style={styles.back}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>

        <ThemedText variant="header" color="primary" style={styles.title}>
          Enter OTP
        </ThemedText>
        <ThemedText variant="body" color="subtitle" style={styles.subtitle}>
          Sent to {formatPhone(phone)}
        </ThemedText>

        <ThemedInput
          mode="underline"
          placeholder="6-digit code"
          keyboardType="number-pad"
          maxLength={6}
          value={otp}
          onChangeText={setOtp}
          autoFocus
          style={styles.otpInput}
        />

        <TouchableOpacity
          style={styles.verifyBtn}
          activeOpacity={0.85}
          onPress={handleVerify}
          disabled={loading || otp.length < 6}
        >
          {loading ? (
            <ActivityIndicator color={Theme.colors.text.mint} />
          ) : (
            <>
              <Text style={[styles.verifyBtnText, otp.length < 6 && styles.btnDisabled]}>
                Verify
              </Text>
              <Text style={[styles.verifyBtnText, otp.length < 6 && styles.btnDisabled]}>
                ›
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.xl,
  },
  back: { position: 'absolute', top: Theme.spacing.xl, left: Theme.spacing.xl },
  title: { textAlign: 'center', marginBottom: Theme.spacing.xs },
  subtitle: { textAlign: 'center', marginBottom: Theme.spacing.xl * 2 },
  otpInput: {
    textAlign: 'center',
    fontSize: Theme.typography.sizes.header,
    letterSpacing: 12,
    marginBottom: Theme.spacing.xl,
  },
  verifyBtn: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    shadowColor: Theme.colors.text.mint,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  verifyBtnText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    fontWeight: '600',
  },
  btnDisabled: { opacity: 0.4 },
});
