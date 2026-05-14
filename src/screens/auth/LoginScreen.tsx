/**
 * 1stOne F1 — Login Screen
 *
 * Single non-scrolling flex column. Auth logic unchanged from BF-18 unified
 * screen: phone-phase auto-sends OTP on 10 valid digits; OTP-phase auto-
 * verifies on 6 valid digits; profile.full_name decides existing-vs-new
 * routing. BF-22 same-number cooldown handled by trimming a digit on
 * "Change number" so the auto-send guard naturally breaks.
 *
 * Layout (top → bottom):
 *   Brand (compact logo)
 *   Title + context line (phone: "to login or register"; OTP: "Sent to … /
 *     Change number ›")
 *   Passcode dots (always visible — never scrolled)
 *   Helper row — fixed-height slot so layout never jumps between states:
 *     phone-phase loading, OTP-phase Verifying, Wrong-code hint, Sending,
 *     Resend countdown, or tappable Resend OTP
 *   Flex spacer
 *   NumberKeypad (anchored bottom)
 *   Terms / Privacy footer (phone phase only)
 *
 * OTP autofill not implemented: iOS autofill requires the system keyboard,
 * which conflicts with the custom NumberKeypad. Logged for future revisit.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Image,
  ImageBackground,
  Text,
  StyleSheet,
  Linking,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { NumberKeypad } from '../../components/NumberKeypad';
import { infoDialog } from '../../utils/confirmDialog';
import { isValidIndianPhone, isValidOTP, normalizePhone } from '../../utils/validators';
import { formatPhone } from '../../utils/formatters';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../api/supabaseClient';

interface LoginScreenProps {
  onExistingUser: () => void;
  onNewUser: (phone: string) => void;
  referralCode?: string;
}

type Phase = 'phone' | 'otp';

// ── Passcode dot row (variable length) ──────────────────────

function PasscodeDots({ value, length }: { value: string; length: number }) {
  return (
    <View style={dots.row}>
      {Array.from({ length }).map((_, i) => {
        const char = value[i];
        return (
          <View key={i} style={[dots.slot, length === 6 && dots.slotWide]}>
            {char ? (
              <Text style={dots.digit}>{char}</Text>
            ) : (
              <View style={[dots.circle, length === 6 && dots.circleWide]} />
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
    gap: Theme.spacing.xs / 2,
  },
  slot: {
    width: 16,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotWide: {
    width: 24,
    height: 52,
  },
  digit: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.header,
    color: Theme.colors.text.primary,
    fontWeight: '400',
  },
  circle: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1.5,
    borderColor: Theme.colors.text.disabled,
  },
  circleWide: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
  },
});

// ── Screen ───────────────────────────────────────────────────

export function LoginScreen({ onExistingUser, onNewUser, referralCode }: LoginScreenProps) {
  const [phase, setPhase] = useState<Phase>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [resending, setResending] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const isSendingRef = useRef(false);
  const isVerifyingRef = useRef(false);
  const { signInWithPhone, verifyOTP } = useAuth();
  const insets = useSafeAreaInsets();

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

  // ── Phone → OTP send (auto-fires when phone reaches 10 valid digits) ──

  const handleSendOTP = async () => {
    if (isSendingRef.current) return;
    if (!isValidIndianPhone(phone)) return;

    isSendingRef.current = true;
    setLoading(true);
    const normalized = normalizePhone(phone);

    try {
      const { error } = await signInWithPhone(normalized);
      if (error) {
        await infoDialog('Could not send OTP', error.message);
        return;
      }
      setOtp('');
      setResendCountdown(30);
      setPhase('otp');
    } catch {
      await infoDialog('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      isSendingRef.current = false;
    }
  };

  useEffect(() => {
    if (phase === 'phone' && phone.length === 10 && isValidIndianPhone(phone)) {
      handleSendOTP();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, phone]);

  // Auto-verify on 6 valid digits.
  useEffect(() => {
    if (phase === 'otp' && otp.length === 6 && isValidOTP(otp) && !isVerifyingRef.current) {
      handleVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, otp]);

  // Clear stale inline error as soon as the user starts typing a new code.
  useEffect(() => {
    if (otpError && otp.length > 0) setOtpError(null);
  }, [otp, otpError]);

  // ── OTP → verify ──

  const handleVerify = async () => {
    if (isVerifyingRef.current) return;
    if (!isValidOTP(otp)) return;

    isVerifyingRef.current = true;
    setLoading(true);
    setOtpError(null);

    const normalized = normalizePhone(phone);
    const { error } = await verifyOTP(normalized, otp);

    if (error) {
      setLoading(false);
      isVerifyingRef.current = false;
      setOtpError('Wrong code — try again');
      setOtp('');
      return;
    }

    const { data: { user: authUser } } = await supabase.auth.getUser();
    const canonicalPhone = authUser?.phone ?? normalized;

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, full_name')
      .or(`phone_number.eq.${canonicalPhone},phone_number.eq.${normalized}`)
      .maybeSingle();

    setLoading(false);
    isVerifyingRef.current = false;

    if (profileErr) {
      onExistingUser();
    } else if (profile?.full_name && profile.full_name.trim().length > 0) {
      onExistingUser();
    } else {
      onNewUser(normalized);
    }
  };

  // ── Resend OTP (30s countdown) ──

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  const handleResend = async () => {
    if (resendCountdown > 0 || resending) return;
    setResending(true);
    const { error } = await signInWithPhone(normalizePhone(phone));
    setResending(false);
    if (error) {
      await infoDialog('Resend Failed', error.message);
      return;
    }
    setOtp('');
    setResendCountdown(30);
    await infoDialog('OTP Sent', 'A new code has been sent to your phone.');
  };

  // ── Change phone (back from OTP → phone) ──

  const handleChangePhone = () => {
    setPhase('phone');
    setOtp('');
    // Trim a digit so the auto-send guard breaks; resending the same number
    // immediately is rejected by Supabase's same-number cooldown (BF-22).
    setPhone((p) => p.slice(0, -1));
  };

  // ── Helper-row renderer ──────────────────────────────────
  // Reserves fixed vertical space so the layout never jumps when the
  // message flips between Verifying / Wrong code / Resend countdown / etc.

  const renderHelper = () => {
    if (phase === 'phone') {
      // Brief send-spinner slot when 10 digits triggered handleSendOTP.
      return loading ? <ActivityIndicator color={Theme.colors.text.mint} /> : null;
    }

    if (loading) {
      return (
        <View style={styles.helperInline}>
          <ActivityIndicator color={Theme.colors.text.mint} size="small" />
          <Text style={styles.helperText}>{'  Verifying…'}</Text>
        </View>
      );
    }

    if (otpError) {
      return <Text style={styles.helperError}>{otpError}</Text>;
    }

    if (resending) {
      return <Text style={styles.helperText}>Sending…</Text>;
    }

    if (resendCountdown > 0) {
      return (
        <Text style={[styles.helperText, styles.helperDisabled]}>
          Resend OTP in {resendCountdown}s
        </Text>
      );
    }

    return (
      <TouchableOpacity
        onPress={handleResend}
        accessibilityRole="button"
        accessibilityLabel="Resend OTP"
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
      >
        <Text style={styles.helperText}>Resend OTP</Text>
      </TouchableOpacity>
    );
  };

  // ── Render ───────────────────────────────────────────────

  const isPhonePhase = phase === 'phone';

  const inner = (
    <View
      style={[
        styles.inner,
        { paddingTop: insets.top + Theme.spacing.lg, paddingBottom: insets.bottom + Theme.spacing.sm },
      ]}
    >
      {/* Brand */}
      <View style={styles.brand}>
        <Image
          source={{ uri: `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/logo.png` }}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      {/* Referral hint — only on phone phase */}
      {isPhonePhase && referralCode && (
        <ThemedText
          variant="small"
          color="mint"
          style={styles.referralHint}
        >
          {`Referral code "${referralCode}" will be applied after signup`}
        </ThemedText>
      )}

      {/* Title + context line */}
      <Text style={styles.title}>
        {isPhonePhase ? 'Enter mobile number' : 'Enter OTP'}
      </Text>

      {isPhonePhase ? (
        <Text style={styles.subtitle}>to login or register</Text>
      ) : (
        <View style={styles.subtitleColumn}>
          <Text style={styles.subtitle}>Sent to {formatPhone(phone)}</Text>
          <TouchableOpacity
            onPress={handleChangePhone}
            accessibilityRole="button"
            accessibilityLabel="Change phone number"
            hitSlop={{ top: 6, bottom: 6, left: 12, right: 12 }}
          >
            <Text style={styles.changePhone}>Change number ›</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Dots */}
      <View style={styles.dotWrap}>
        <PasscodeDots value={isPhonePhase ? phone : otp} length={isPhonePhase ? 10 : 6} />
      </View>

      {/* Helper row — fixed height, never jumps */}
      <View style={styles.helperRow}>{renderHelper()}</View>

      {/* Flex spacer pushes the keypad to the natural bottom of the screen */}
      <View style={styles.spacer} />

      {/* Keypad */}
      <View style={styles.keypadWrap}>
        <NumberKeypad
          value={isPhonePhase ? phone : otp}
          onChange={isPhonePhase ? setPhone : setOtp}
          maxLength={isPhonePhase ? 10 : 6}
        />
      </View>

      {/* T&C — phone phase only */}
      {isPhonePhase && (
        <View style={styles.footer}>
          <Text style={styles.footLine}>By continuing, you agree to our</Text>
          <Text style={styles.footLine}>
            <Text
              style={styles.footLink}
              onPress={() => Linking.openURL('https://wcvqxzqqwcxlcgrjyunf.supabase.co/storage/v1/object/public/assets/Terms.pdf')}
            >
              Terms of Service
            </Text>
            {' & '}
            <Text
              style={styles.footLink}
              onPress={() => Linking.openURL('https://wcvqxzqqwcxlcgrjyunf.supabase.co/storage/v1/object/public/assets/Privacy-Policy.pdf')}
            >
              Privacy Policy
            </Text>
          </Text>
        </View>
      )}
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

const HELPER_ROW_HEIGHT = 44;
const LOGO_SIZE = 112;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Theme.colors.layout.overlayHeavy,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.xl,
  },
  brand: {
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  referralHint: {
    textAlign: 'center',
    marginBottom: Theme.spacing.sm,
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
    fontSize: Theme.typography.sizes.subtitle,
    color: Theme.colors.text.muted,
    textAlign: 'center',
  },
  subtitleColumn: {
    alignItems: 'center',
    gap: Theme.spacing.xs,
  },
  changePhone: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.subtitle,
    color: Theme.colors.text.mint,
  },
  dotWrap: {
    width: '100%',
    alignItems: 'center',
    marginTop: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
  },
  helperRow: {
    height: HELPER_ROW_HEIGHT,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helperInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helperText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    color: Theme.colors.text.mint,
    textAlign: 'center',
  },
  helperDisabled: {
    color: Theme.colors.text.disabled,
  },
  helperError: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    color: Theme.colors.status.warning,
    textAlign: 'center',
  },
  spacer: { flex: 1 },
  keypadWrap: {
    width: '100%',
  },
  footer: {
    alignItems: 'center',
    marginTop: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.lg,
    gap: Theme.spacing.xs,
  },
  footLine: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small,
    color: Theme.colors.text.muted,
    textAlign: 'center',
  },
  footLink: {
    color: Theme.colors.text.accent,
  },
});
