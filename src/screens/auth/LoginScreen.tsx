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
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
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
  const inputRef = useRef<TextInput>(null);
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
    if (!isValidIndianPhone(phone)) {
      Alert.alert('Invalid Number', 'Please enter a valid 10-digit mobile number');
      return;
    }

    setLoading(true);
    const normalized = normalizePhone(phone);

    try {
      const { error } = await signInWithPhone(normalized);
      if (error) { Alert.alert('Error', error.message); return; }
      onOTPSent(normalized);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inner = (
    <KeyboardAvoidingView
      style={styles.kav}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
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

          {/* Passcode dot field */}
          <TouchableOpacity
            style={styles.dotWrap}
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
          >
            <PasscodeDots value={phone} />
            <TextInput
              ref={inputRef}
              style={styles.hiddenInput}
              keyboardType="number-pad"
              maxLength={10}
              value={phone}
              onChangeText={setPhone}
              autoFocus
              caretHidden
            />
          </TouchableOpacity>

          {/* LOGIN | REGISTER button */}
          <TouchableOpacity
            style={styles.loginBtn}
            activeOpacity={0.85}
            onPress={handleContinue}
            disabled={loading || phone.length < 10}
          >
            {loading ? (
              <ActivityIndicator color={Theme.colors.text.mint} />
            ) : (
              <Text style={[styles.loginBtnText, phone.length < 10 && styles.loginBtnDisabled]}>
                LOGIN  |  REGISTER
              </Text>
            )}
          </TouchableOpacity>
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
    backgroundColor: Theme.colors.layout.overlayHeavy,
  },
  kav: { flex: 1 },
  scroll: { flexGrow: 1 },
  body: {
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.xl,
    paddingTop: Theme.spacing.xl * 2,
  },
  logo: {
    width: 220,
    height: 220,
    marginBottom: Theme.spacing.xl + Theme.spacing.lg,
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
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    color: 'transparent',
    backgroundColor: 'transparent',
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
