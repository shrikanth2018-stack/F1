/**
 * 1stOne F1 — OTP Verification Screen
 * Passcode-dot entry, auto-submits at 6 digits.
 * For new users: creates profile record after verification.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Theme } from '../../theme';
import { NumberKeypad } from '../../components/NumberKeypad';
import { infoDialog } from '../../utils/confirmDialog';
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
    color: Theme.colors.text.primary,
    fontWeight: '400',
  },
  circle: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 1.5,
    borderColor: Theme.colors.text.disabled,
  },
});

// ── Screen ───────────────────────────────────────────────────

export function OTPScreen({ phone, onBack, onExistingUser, onNewUser }: OTPScreenProps) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(30);
  const [resending, setResending] = useState(false);
  const isVerifyingRef = useRef(false);
  const { verifyOTP, signInWithPhone } = useAuth();

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
      await infoDialog('Invalid OTP', 'Please enter the 6-digit code');
      return;
    }

    isVerifyingRef.current = true;
    setLoading(true);
    const { error } = await verifyOTP(phone, otp);

    if (error) {
      setLoading(false);
      isVerifyingRef.current = false;
      await infoDialog('Verification Failed', error.message);
      setOtp('');
      return;
    }

    // Check if profile exists AND is complete (has full_name).
    // The handle_new_user trigger creates a stub row with id+role+phone_number
    // immediately on auth signup, so just-existing isn't enough — full_name
    // signals a finished registration. Stub rows route to RegistrationScreen.
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const canonicalPhone = authUser?.phone ?? phone;

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, full_name')
      .or(`phone_number.eq.${canonicalPhone},phone_number.eq.${phone}`)
      .maybeSingle();

    setLoading(false);
    isVerifyingRef.current = false;

    // If the query itself errored (RLS, network), treat as existing user —
    // better to let someone in than to force unnecessary re-registration.
    if (profileErr) {
      onExistingUser();
    } else if (profile?.full_name && profile.full_name.trim().length > 0) {
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

  // Tick the resend countdown once a second until zero, then enable button
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  const handleResend = async () => {
    if (resendCountdown > 0 || resending) return;
    setResending(true);
    const { error } = await signInWithPhone(phone);
    setResending(false);
    if (error) {
      await infoDialog('Resend Failed', error.message);
      return;
    }
    setOtp('');
    setResendCountdown(30);
    await infoDialog('OTP Sent', 'A new code has been sent to your phone.');
  };

  const inner = (
    <View style={styles.inner}>
      <Text style={styles.title}>Enter OTP</Text>
      <Text style={styles.subtitle}>Sent to {formatPhone(phone)}</Text>

      {/* Passcode dot row — read-only, fed by NumberKeypad below */}
      <View style={styles.dotWrap}>
        <PasscodeDots value={otp} />
      </View>

      {/* Loading indicator while auto-verifying */}
      {loading && <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />}

        {/* Resend OTP — disabled with countdown for first 30s */}
        <TouchableOpacity
          style={styles.resendBtn}
          onPress={handleResend}
          disabled={resendCountdown > 0 || resending}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel="Resend OTP"
          accessibilityState={{ disabled: resendCountdown > 0 || resending, busy: resending }}
        >
          <Text
            style={[
              styles.resendText,
              (resendCountdown > 0 || resending) && styles.resendDisabled,
            ]}
          >
            {resending
              ? 'Sending…'
              : resendCountdown > 0
                ? `Resend OTP in ${resendCountdown}s`
                : 'Resend OTP'}
          </Text>
        </TouchableOpacity>

      {/* Change phone — replaces the Back button */}
      <TouchableOpacity
        style={styles.changePhoneBtn}
        onPress={onBack}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel="Change phone number"
      >
        <Text style={styles.changePhoneText}>Change Phone Number</Text>
      </TouchableOpacity>

      {/* In-app number keypad — feeds otp state, autoVerify still triggers at 6 digits */}
      <View style={styles.keypadWrap}>
        <NumberKeypad value={otp} onChange={setOtp} maxLength={6} />
      </View>
    </View>
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
    backgroundColor: Theme.colors.layout.overlayHeavy,
  },
  inner: {
    flex: 1,
    paddingTop: Theme.spacing.xl * 2,
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.xl,
  },
  keypadWrap: {
    width: '100%',
    marginTop: Theme.spacing.lg,
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
  loader: {
    marginBottom: Theme.spacing.lg,
  },
  resendBtn: {
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
  },
  resendText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small + 4,
    color: Theme.colors.text.mint,
    textAlign: 'center',
  },
  resendDisabled: {
    color: Theme.colors.text.disabled,
  },
  changePhoneBtn: {
    marginTop: Theme.spacing.lg,
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
  },
  changePhoneText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small + 4,
    color: Theme.colors.text.disabled,
    textAlign: 'center',
  },
});
