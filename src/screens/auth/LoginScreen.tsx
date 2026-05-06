/**
 * 1stOne F1 — Login Screen (BF-18 unified)
 *
 * One screen, two visual states with progressive disclosure:
 *
 *   Phase 'phone' — passcode-dot phone entry (10 dots), custom NumberKeypad.
 *     Phone reaches 10 valid digits → automatically sends OTP via Supabase
 *     and transitions to phase 'otp'. No submit button on this phase.
 *
 *   Phase 'otp' — passcode-dot OTP entry (6 dots), custom NumberKeypad.
 *     "Sent to <phone> · Change phone ›" inline link returns to phone phase.
 *     Centered mint "LOGIN | REGISTER" text (no boxed button) — tap to verify
 *     once 6 digits are entered. Resend OTP after 30s countdown.
 *     On verify success, checks profile.full_name to decide:
 *       - existing user (full_name set) → onExistingUser() — session triggers
 *         re-render to role navigator
 *       - new user (no full_name) → onNewUser(phone) → OnboardingScreen
 *
 * Replaces the previous separate LoginScreen + OTPScreen pair. Auth logic
 * unchanged — same signInWithPhone, verifyOTP, profile-check routing.
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
  ScrollView,
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
    gap: 6,
  },
  // Default sizing matches the original 10-dot phone layout
  slot: {
    width: 26,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Wider slots for the 6-dot OTP layout — same component, more breathing room
  slotWide: {
    width: 40,
    height: 52,
  },
  digit: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 5,
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
        // Stay on phone phase; user can correct + retry
        return;
      }
      // Successfully sent — transition to OTP phase
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

  // Auto-send the moment phone hits 10 valid digits while in 'phone' phase.
  useEffect(() => {
    if (phase === 'phone' && phone.length === 10 && isValidIndianPhone(phone)) {
      handleSendOTP();
    }
    // We intentionally only fire when phase + phone change — handleSendOTP
    // closure captures the same instance per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, phone]);

  // ── OTP → verify (manual tap; user types 6 digits, then taps LOGIN|REGISTER) ──

  const handleVerify = async () => {
    if (isVerifyingRef.current) return;
    if (!isValidOTP(otp)) return;

    isVerifyingRef.current = true;
    setLoading(true);

    const normalized = normalizePhone(phone);
    const { error } = await verifyOTP(normalized, otp);

    if (error) {
      setLoading(false);
      isVerifyingRef.current = false;
      await infoDialog('Verification Failed', error.message);
      setOtp('');
      return;
    }

    // Profile-completeness check (BF-03 architecture):
    //   full_name set → existing user → role navigator (via session)
    //   missing/blank → new user → OnboardingScreen (via onNewUser callback)
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
      // RLS or network — better to let them through than force unnecessary
      // re-registration. Same fallback as the original OTPScreen logic.
      onExistingUser();
    } else if (profile?.full_name && profile.full_name.trim().length > 0) {
      onExistingUser();
    } else {
      onNewUser(normalized);
    }
  };

  // ── Resend OTP (with 30s countdown) ──

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

  // ── Change phone (back from OTP → phone phase) ──

  const handleChangePhone = () => {
    setPhase('phone');
    setOtp('');
    // Drop the last digit so the user lands in edit mode and the 10-digit
    // auto-send guard naturally breaks. Preserving all 10 digits re-fires
    // signInWithPhone for the same number, which Supabase's same-number
    // cooldown rejects as "Could not send OTP" (BF-22).
    setPhone((p) => p.slice(0, -1));
  };

  // ── Render ───────────────────────────────────────────────

  const isPhonePhase = phase === 'phone';
  const otpReady = isValidOTP(otp);

  const inner = (
    <View style={styles.innerWrap}>
      {/* Upper region — scrolls if it overflows; keypad below stays pinned. */}
      <ScrollView
        style={styles.upperScroll}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={styles.body}>
          {/* Logo */}
          <Image
            source={{ uri: `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/logo.png` }}
            style={styles.logo}
            resizeMode="contain"
          />

          {/* Referral hint — only on phone phase */}
          {isPhonePhase && referralCode && (
            <ThemedText variant="small" color="mint" style={{ textAlign: 'center', marginBottom: 12 }}>
              {`Referral code "${referralCode}" will be applied after signup`}
            </ThemedText>
          )}

          {/* Title */}
          <Text style={styles.title}>
            {isPhonePhase ? 'Enter mobile' : 'Enter OTP'}
          </Text>

          {/* OTP-phase subtitle: shows phone + Change phone link inline */}
          {!isPhonePhase && (
            <View style={styles.subtitleRow}>
              <Text style={styles.subtitle}>Sent to {formatPhone(phone)}</Text>
              <TouchableOpacity
                onPress={handleChangePhone}
                accessibilityRole="button"
                accessibilityLabel="Change phone number"
              >
                <Text style={styles.changePhone}>Change phone ›</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Passcode dots — 10 for phone, 6 for OTP, same visual style */}
          <View style={styles.dotWrap}>
            <PasscodeDots value={isPhonePhase ? phone : otp} length={isPhonePhase ? 10 : 6} />
          </View>

          {/* OTP-phase: LOGIN | REGISTER text-only action */}
          {!isPhonePhase && (
            <TouchableOpacity
              onPress={handleVerify}
              disabled={loading || !otpReady}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Login or Register"
              accessibilityState={{ disabled: loading || !otpReady, busy: loading }}
              style={styles.actionWrap}
            >
              {loading ? (
                <ActivityIndicator color={Theme.colors.text.mint} />
              ) : (
                <Text style={[styles.actionText, !otpReady && styles.actionTextDisabled]}>
                  LOGIN  |  REGISTER
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* Phone-phase: brief sending indicator while OTP is being sent */}
          {isPhonePhase && loading && (
            <View style={styles.actionWrap}>
              <ActivityIndicator color={Theme.colors.text.mint} />
            </View>
          )}

          {/* OTP-phase: resend with countdown */}
          {!isPhonePhase && (
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
          )}
        </View>
      </ScrollView>

      {/* Bottom-pinned region — keypad always visible; phone-phase shows
          terms/privacy below it. Respects safe-area inset. */}
      <View style={[styles.bottomPinned, { paddingBottom: insets.bottom + Theme.spacing.sm }]}>
        <View style={styles.keypadWrap}>
          {isPhonePhase ? (
            <NumberKeypad value={phone} onChange={setPhone} maxLength={10} />
          ) : (
            <NumberKeypad value={otp} onChange={setOtp} maxLength={6} />
          )}
        </View>

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
              {'  and  '}
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
  innerWrap: { flex: 1 },
  upperScroll: { flex: 1 },
  scroll: { flexGrow: 1 },
  bottomPinned: {
    width: '100%',
  },
  body: {
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.xl,
    paddingTop: Theme.spacing.xl * 2,
  },
  logo: {
    width: 180,
    height: 180,
    marginBottom: Theme.spacing.lg,
  },
  title: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.header,
    color: Theme.colors.text.primary,
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: Theme.spacing.sm,
  },
  subtitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.md,
    gap: Theme.spacing.xs,
  },
  subtitle: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    color: Theme.colors.text.muted,
    textAlign: 'center',
  },
  changePhone: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 2,
    color: Theme.colors.text.mint,
  },
  dotWrap: {
    width: '100%',
    alignItems: 'center',
    marginBottom: Theme.spacing.lg,
    paddingVertical: Theme.spacing.sm,
  },
  // Centered mint text — replaces the previous boxed LOGIN | REGISTER button.
  // Same color/weight/text but no border, no background, no shadow.
  actionWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Theme.spacing.md,
    minHeight: 52,
  },
  actionText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 3,
    fontWeight: '600',
    textAlign: 'center',
  },
  actionTextDisabled: {
    opacity: 0.4,
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
  keypadWrap: {
    width: '100%',
    marginTop: Theme.spacing.md,
  },
  footer: {
    alignItems: 'center',
    marginTop: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.lg,
    gap: 4,
  },
  footLine: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.small + 1,
    color: Theme.colors.text.muted,
    textAlign: 'center',
  },
  footLink: {
    color: Theme.colors.text.accent,
  },
});
