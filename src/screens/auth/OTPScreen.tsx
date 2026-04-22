/**
 * 1stOne F1 — OTP Verification Screen
 * Passcode-dot entry, auto-submits at 6 digits.
 * For new users: creates profile record after verification.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  ImageBackground,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Theme } from '../../theme';
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

// ── Passcode dot row (6 digits) ─────────────────────────────

function PasscodeDots({ value }: { value: string }) {
  return (
    <View style={dots.row}>
      {Array.from({ length: 6 }).map((_, i) => {
        const char = value[i];
        return (
          <View key={i} style={dots.slot}>
            {char ? (
              <Text style={dots.digit}>{char}</Text>
            ) : (
              <View style={dots.circle} />
            )}
          </View>
        );
      })}
    </View>
  );
}

const dots = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  slot: {
    width: 40,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 5,
    color: '#ffffff',
    fontWeight: '400',
  },
  circle: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
});

// ── Screen ───────────────────────────────────────────────────

export function OTPScreen({ phone, onBack, onExistingUser, onNewUser }: OTPScreenProps) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const isVerifyingRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const { verifyOTP } = useAuth();

  useEffect(() => {
    supabase
      .from('app_settings')
      .select('login_bg_url')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data?.login_bg_url) setBgUrl(data.login_bg_url);
      });
  }, []);

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

    // Check if profile exists — use the auth-canonical phone from getUser()
    // to avoid format mismatches between our normalizePhone and Supabase's stored value.
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const canonicalPhone = authUser?.phone ?? phone;

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id')
      .or(`phone_number.eq.${canonicalPhone},phone_number.eq.${phone}`)
      .maybeSingle();

    setLoading(false);
    isVerifyingRef.current = false;

    // If the query itself errored (RLS, network), treat as existing user —
    // better to let someone in than to force unnecessary re-registration.
    if (profile || profileErr) {
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

  const inner = (
    <KeyboardAvoidingView
      style={styles.kav}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Enter OTP</Text>
        <Text style={styles.subtitle}>Sent to {formatPhone(phone)}</Text>

        {/* Passcode dot field */}
        <TouchableOpacity
          style={styles.dotWrap}
          activeOpacity={1}
          onPress={() => inputRef.current?.focus()}
        >
          <PasscodeDots value={otp} />
          <TextInput
            ref={inputRef}
            style={styles.hiddenInput}
            keyboardType="number-pad"
            maxLength={6}
            value={otp}
            onChangeText={setOtp}
            autoFocus
            caretHidden
          />
        </TouchableOpacity>

        {/* Loading indicator while auto-verifying */}
        {loading && <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />}

        {/* Change phone — replaces the Back button */}
        <TouchableOpacity style={styles.changePhoneBtn} onPress={onBack} activeOpacity={0.6}>
          <Text style={styles.changePhoneText}>Change Phone Number</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );

  if (!bgUrl) {
    return <View style={styles.container}>{inner}</View>;
  }

  return (
    <ImageBackground source={{ uri: bgUrl }} style={styles.container} resizeMode="cover">
      <View style={styles.overlay} pointerEvents="none" />
      {inner}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  kav: { flex: 1 },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.xl,
  },
  title: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.header,
    color: Theme.colors.text.primary,
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: Theme.spacing.xs,
  },
  subtitle: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 4,
    color: Theme.colors.text.muted,
    textAlign: 'center',
    marginBottom: Theme.spacing.xl * 2,
  },
  dotWrap: {
    width: '100%',
    alignItems: 'center',
    marginBottom: Theme.spacing.xl,
    paddingVertical: Theme.spacing.sm,
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    color: 'transparent',
    backgroundColor: 'transparent',
  },
  loader: {
    marginBottom: Theme.spacing.lg,
  },
  changePhoneBtn: {
    marginTop: Theme.spacing.lg,
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
  },
  changePhoneText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small + 4,
    color: 'rgba(255,255,255,0.35)',
    textAlign: 'center',
  },
});
