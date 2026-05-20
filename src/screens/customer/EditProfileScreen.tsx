/**
 * 1stOne F1 — Edit Profile Screen
 *
 * Single hub for everything the customer can edit about themselves:
 *   - Full name (inline edit + save)
 *   - Login phone number (OTP-verified change)
 *   - Saved delivery addresses (links to AddressesScreen)
 *
 * Phone-change flow is a two-step inline modal:
 *   1. Enter new 10-digit phone → supabase.auth.updateUser({ phone })
 *   2. Enter OTP delivered to the new phone → verifyOtp(type='phone_change')
 *
 * On verify success, refreshSession() updates session.user.phone immediately,
 * and the on_auth_user_phone_updated SQL trigger mirrors the change into
 * profiles.phone_number so subsequent queries stay consistent.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedInput } from '../../components/ThemedInput';
import { useAuth } from '../../hooks/useAuth';
import { useSupabaseMutation } from '../../api/useSupabaseQuery';
import { supabase } from '../../api/supabaseClient';
import { QUERY_KEYS } from '../../utils/constants';
import { useWalletBalance } from '../../hooks/useWallet';
import { formatPhone } from '../../utils/formatters';
import { isValidIndianPhone, isValidOTP, normalizePhone } from '../../utils/validators';

type PhoneChangePhase = 'enter' | 'otp';

export function EditProfileScreen({ navigation }: any) {
  const { session, startPhoneChange, verifyPhoneChange } = useAuth();
  const { data: wallet, refetch: refetchWallet } = useWalletBalance();

  // ── Name ─────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [nameDirty, setNameDirty] = useState(false);
  useEffect(() => {
    if (wallet?.fullName != null && !nameDirty) {
      setName(wallet.fullName);
    }
  }, [wallet?.fullName, nameDirty]);

  const updateName = useSupabaseMutation<string>(
    (newName) =>
      supabase
        .from('profiles')
        .update({ full_name: newName })
        .eq('id', session?.user.id ?? ''),
    [QUERY_KEYS.PROFILE as unknown as string[]],
  );

  const handleSaveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter your name.');
      return;
    }
    try {
      await updateName.mutateAsync(trimmed);
      setNameDirty(false);
      await refetchWallet();
    } catch {
      Alert.alert('Error', 'Could not save name. Please try again.');
    }
  };

  // ── Phone change modal ───────────────────────────────────
  const [phoneModalVisible, setPhoneModalVisible] = useState(false);
  const [phase, setPhase] = useState<PhoneChangePhase>('enter');
  const [newPhone, setNewPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);

  const resetPhoneModal = () => {
    setPhoneModalVisible(false);
    setPhase('enter');
    setNewPhone('');
    setOtp('');
    setBusy(false);
  };

  const handleSendOtp = async () => {
    if (!isValidIndianPhone(newPhone)) {
      Alert.alert('Invalid', 'Please enter a valid 10-digit phone number.');
      return;
    }
    const normalized = normalizePhone(newPhone);
    if (normalized === session?.user.phone) {
      Alert.alert('Same Number', 'This is already your login phone number.');
      return;
    }
    setBusy(true);
    const { error } = await startPhoneChange(normalized);
    setBusy(false);
    if (error) {
      Alert.alert('Could not send OTP', error.message);
      return;
    }
    setPhase('otp');
  };

  const handleVerifyOtp = async () => {
    if (!isValidOTP(otp)) {
      Alert.alert('Invalid', 'Please enter the 6-digit OTP.');
      return;
    }
    setBusy(true);
    const normalized = normalizePhone(newPhone);
    const { error } = await verifyPhoneChange(normalized, otp);
    setBusy(false);
    if (error) {
      Alert.alert('Verification failed', error.message);
      return;
    }
    await refetchWallet();
    resetPhoneModal();
    Alert.alert(
      'Phone number changed',
      'From your next login onwards, use the new number.',
    );
  };

  // ── Render ───────────────────────────────────────────────

  const currentPhone = session?.user.phone || '';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ThemedText variant="header" color="primary">Edit Profile</ThemedText>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="muted">Close</ThemedText>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Name */}
        <View style={styles.section}>
          <ThemedText variant="small" color="subtitle" style={styles.sectionLabel}>Name</ThemedText>
          <ThemedInput
            mode="underline"
            value={name}
            onChangeText={(t) => { setName(t); setNameDirty(true); }}
            placeholder="Your full name"
          />
          {nameDirty && (
            <TouchableOpacity
              onPress={handleSaveName}
              disabled={updateName.isPending}
              style={styles.inlineAction}
              activeOpacity={0.6}
            >
              {updateName.isPending
                ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
                : <ThemedText variant="body" color="mint">Save name  ›</ThemedText>}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.hairline} />

        {/* Login Phone */}
        <View style={styles.section}>
          <ThemedText variant="small" color="subtitle" style={styles.sectionLabel}>Login phone</ThemedText>
          <View style={styles.rowBetween}>
            <ThemedText variant="body" color="primary">
              {currentPhone ? formatPhone(currentPhone) : '—'}
            </ThemedText>
            <TouchableOpacity
              onPress={() => setPhoneModalVisible(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <ThemedText variant="body" color="mint">Change number  ›</ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.hairline} />

        {/* My Addresses */}
        <TouchableOpacity
          style={styles.section}
          onPress={() => navigation.navigate('Addresses')}
          activeOpacity={0.6}
        >
          <View style={styles.rowBetween}>
            <ThemedText variant="body" color="primary">My Addresses</ThemedText>
            <ThemedText variant="body" color="mint">›</ThemedText>
          </View>
        </TouchableOpacity>
      </ScrollView>

      {/* Phone change modal */}
      <Modal
        visible={phoneModalVisible}
        transparent
        animationType="fade"
        onRequestClose={resetPhoneModal}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <ThemedText variant="subtitle" color="primary">
                  {phase === 'enter' ? 'New phone number' : 'Enter OTP'}
                </ThemedText>
                <TouchableOpacity onPress={resetPhoneModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <ThemedText variant="body" color="muted">Cancel</ThemedText>
                </TouchableOpacity>
              </View>

              {phase === 'enter' && (
                <>
                  <ThemedInput
                    mode="underline"
                    keyboardType="phone-pad"
                    placeholder="10-digit phone"
                    value={newPhone}
                    onChangeText={setNewPhone}
                    maxLength={10}
                  />
                  <TouchableOpacity
                    style={styles.modalCta}
                    onPress={handleSendOtp}
                    activeOpacity={0.6}
                    disabled={busy}
                  >
                    {busy
                      ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
                      : <ThemedText variant="subtitle" color="mint">Send OTP  ›</ThemedText>}
                  </TouchableOpacity>
                </>
              )}

              {phase === 'otp' && (
                <>
                  <ThemedText variant="small" color="muted" style={styles.modalHint}>
                    OTP sent to {formatPhone(normalizePhone(newPhone))}
                  </ThemedText>
                  <ThemedInput
                    mode="underline"
                    keyboardType="number-pad"
                    placeholder="6-digit OTP"
                    value={otp}
                    onChangeText={setOtp}
                    maxLength={6}
                  />
                  <TouchableOpacity
                    style={styles.modalCta}
                    onPress={handleVerifyOtp}
                    activeOpacity={0.6}
                    disabled={busy}
                  >
                    {busy
                      ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
                      : <ThemedText variant="subtitle" color="mint">Verify & change  ›</ThemedText>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setPhase('enter'); setOtp(''); }}
                    style={styles.modalSecondary}
                    activeOpacity={0.6}
                  >
                    <ThemedText variant="small" color="muted">Change number</ThemedText>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  body: {
    paddingBottom: Theme.spacing.xl,
  },
  section: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  sectionLabel: {
    marginBottom: Theme.spacing.xs,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inlineAction: {
    alignSelf: 'flex-end',
    paddingVertical: Theme.spacing.xs,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.text.mint,
    marginHorizontal: Theme.spacing.md,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: Theme.colors.layout.overlayHeavy,
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.lg,
  },
  modalCard: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 16,
    padding: Theme.spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  modalHint: {
    marginBottom: Theme.spacing.xs,
  },
  modalCta: {
    paddingVertical: Theme.spacing.sm,
    alignItems: 'flex-end',
  },
  modalSecondary: {
    paddingVertical: Theme.spacing.xs,
    alignItems: 'flex-end',
  },
});
