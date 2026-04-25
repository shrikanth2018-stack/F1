/**
 * 1stOne F1 — Registration Screen
 * New user: collects full name, then sends OTP.
 * Plain text, no boxes.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedInput } from '../../components/ThemedInput';
import { supabase } from '../../api/supabaseClient';
import { isNonEmpty } from '../../utils/validators';

interface RegistrationScreenProps {
  phone: string;
  onComplete: (name: string) => void;
  onBack: () => void;
}

export function RegistrationScreen({ phone, onComplete, onBack }: RegistrationScreenProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!isNonEmpty(name)) {
      Alert.alert('Required', 'Please enter your full name');
      return;
    }

    setLoading(true);
    // Create profile now — user is already authenticated at this point
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('profiles').upsert({
      phone_number: phone,
      full_name: name.trim(),
    }, { onConflict: 'phone_number' });
    setLoading(false);

    onComplete(name.trim());
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bounces={false}>
        <View style={styles.body}>
          <TouchableOpacity onPress={onBack} style={styles.back}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>

          <ThemedText variant="header" color="primary" style={styles.title}>
            Create Account
          </ThemedText>
          <ThemedText variant="body" color="subtitle" style={styles.subtitle}>
            {phone}
          </ThemedText>

          <ThemedInput
            mode="underline"
            placeholder="Full name"
            value={name}
            onChangeText={setName}
            autoFocus
            style={styles.input}
          />

          <TouchableOpacity
            style={styles.continueBtn}
            activeOpacity={0.85}
            onPress={handleContinue}
            disabled={loading || !isNonEmpty(name)}
          >
            {loading ? (
              <ActivityIndicator color={Theme.colors.text.mint} />
            ) : (
              <>
                <Text style={[styles.continueBtnText, !isNonEmpty(name) && styles.btnDisabled]}>
                  Continue
                </Text>
                <Text style={[styles.continueBtnText, !isNonEmpty(name) && styles.btnDisabled]}>
                  ›
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  scroll: { flexGrow: 1 },
  body: {
    flex: 1,
    paddingHorizontal: Theme.spacing.xl,
    paddingTop: Theme.spacing.xl,
    justifyContent: 'center',
  },
  back: { marginBottom: Theme.spacing.xl },
  title: { textAlign: 'center', marginBottom: Theme.spacing.xs },
  subtitle: { textAlign: 'center', marginBottom: Theme.spacing.xl * 2 },
  input: { marginBottom: Theme.spacing.xl },
  continueBtn: {
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
  continueBtnText: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    fontWeight: '600',
  },
  btnDisabled: { opacity: 0.4 },
});
