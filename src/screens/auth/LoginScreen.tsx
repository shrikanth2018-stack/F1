/**
 * 1stOne F1 — Login Screen
 * Logo, passcode-dot phone entry, mint-outline LOGIN | REGISTER button, 2-line footer terms.
 * Background image is fetched from app_settings.login_bg_url at mount time.
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
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { NumberKeypad } from '../../components/NumberKeypad';
import { infoDialog } from '../../utils/confirmDialog';
import { isValidIndianPhone, normalizePhone } from '../../utils/validators';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../api/supabaseClient';

interface LoginScreenProps {
  onOTPSent: (phone: string) => void;
  referralCode?: string;
}

// ── Passcode dot row (10 digits) ────────────────────────────

function PasscodeDots({ value }: { value: string }) {
  return (
    <View style={dots.row}>
      {Array.from({ length: 10 }).map((_, i) => {
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
    gap: 6,
  },
  slot: {
    width: 26,
    height: 44,
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
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1.5,
    borderColor: Theme.colors.text.disabled,
  },
});

// ── Screen ───────────────────────────────────────────────────

export function LoginScreen({ onOTPSent, referralCode }: LoginScreenProps) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const { signInWithPhone } = useAuth();

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

  const handleContinue = async () => {
    if (isSubmittingRef.current) return;
    if (!isValidIndianPhone(phone)) {
      await infoDialog('Invalid Number', 'Please enter a valid 10-digit mobile number');
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    const normalized = normalizePhone(phone);

    try {
      const { error } = await signInWithPhone(normalized);
      if (error) { await infoDialog('Error', error.message); return; }
      onOTPSent(normalized);
    } catch {
      await infoDialog('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const inner = (
    <ScrollView
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

        {/* Referral hint */}
        {referralCode && (
          <ThemedText variant="small" color="mint" style={{ textAlign: 'center', marginBottom: 12 }}>
            {`Referral code "${referralCode}" will be applied after signup`}
          </ThemedText>
        )}

        {/* Title */}
        <Text style={styles.title}>Enter mobile</Text>

        {/* Passcode dot row — read-only display, fed by NumberKeypad below */}
        <View style={styles.dotWrap}>
          <PasscodeDots value={phone} />
        </View>

        {/* LOGIN | REGISTER button — manual tap (no auto-submit on phone) */}
        <TouchableOpacity
          style={styles.loginBtn}
          activeOpacity={0.85}
          onPress={handleContinue}
          disabled={loading || phone.length < 10}
          accessibilityRole="button"
          accessibilityLabel="Login or Register"
          accessibilityState={{ disabled: loading || phone.length < 10, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color={Theme.colors.text.mint} />
          ) : (
            <Text style={[styles.loginBtnText, phone.length < 10 && styles.loginBtnDisabled]}>
              LOGIN  |  REGISTER
            </Text>
          )}
        </TouchableOpacity>

        {/* In-app number keypad — replaces OS keyboard */}
        <View style={styles.keypadWrap}>
          <NumberKeypad value={phone} onChange={setPhone} maxLength={10} />
        </View>
      </View>

      {/* Footer */}
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
    </ScrollView>
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
  scroll: { flexGrow: 1 },
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
    marginBottom: Theme.spacing.lg,
  },
  dotWrap: {
    width: '100%',
    alignItems: 'center',
    marginBottom: Theme.spacing.xl,
    paddingVertical: Theme.spacing.sm,
  },
  loginBtn: {
    width: '100%',
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    shadowColor: Theme.colors.text.mint,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  loginBtnText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 3,
    fontWeight: '600',
  },
  loginBtnDisabled: {
    opacity: 0.4,
  },
  footer: {
    alignItems: 'center',
    marginTop: Theme.spacing.xl,
    marginBottom: Theme.spacing.xl,
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
