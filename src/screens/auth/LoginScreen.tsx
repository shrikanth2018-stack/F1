/**
 * 1stOne F1 — Login Screen
 * Logo, underline phone field, mint-outline LOGIN | REGISTER button, 2-line footer terms.
 * Background image is fetched from app_settings.login_bg_url at mount time.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Image,
  ImageBackground,
  Text,
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
import { ThemedInput } from '../../components/ThemedInput';
import { isValidIndianPhone, normalizePhone } from '../../utils/validators';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../api/supabaseClient';

interface LoginScreenProps {
  onOTPSent: (phone: string) => void;
  referralCode?: string;
}

export function LoginScreen({ onOTPSent, referralCode }: LoginScreenProps) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
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
          {/* Logo from Supabase storage */}
          <Image
            source={{ uri: `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/logo.png` }}
            style={styles.logo}
            resizeMode="contain"
          />

          {/* Referral code hint — shown when app was opened via a referral link */}
          {referralCode && (
            <ThemedText variant="small" color="mint" style={{ textAlign: 'center', marginBottom: 12 }}>
              {`Referral code "${referralCode}" will be applied after signup`}
            </ThemedText>
          )}

          {/* Phone field — underline, centred */}
          <ThemedInput
            mode="underline"
            placeholder="10-digit mobile number"
            keyboardType="number-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
            autoFocus
            style={styles.phoneInput}
          />

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

        {/* Footer terms — 2 lines, pushed toward bottom */}
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
      {/* Dark overlay — sits behind all UI, keeps text readable */}
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
  phoneInput: {
    textAlign: 'center',
    width: '100%',
    marginBottom: Theme.spacing.xl,
    fontSize: Theme.typography.sizes.body + 2,
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
    fontSize: Theme.typography.sizes.body,
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
