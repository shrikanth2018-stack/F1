/**
 * 1stOne F1 — Vendor Registration
 *
 * The vendor's half of onboarding. An admin has already elevated this
 * person to `invited`; here they supply the business details and accept
 * terms, which moves them to `submitted` for an admin to verify.
 *
 * They cannot set their own status, commission or selling model — those
 * columns are not grantable to `authenticated` at all, so the database
 * refuses it rather than this screen politely not offering it.
 *
 * Lives under the customer navigator because a vendor IS a customer-role
 * profile, the same arrangement a hub operator has.
 */

import React, { useState, useEffect } from 'react';
import {
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Divider } from '../../components/Divider';
import { infoDialog } from '../../utils/confirmDialog';
import { getErrorMessage } from '../../utils/formatters';
import { useMyVendor, useSubmitVendorRegistration } from '../../hooks/useMyVendor';
import { SELLING_MODEL_LABEL, SUPPLY_MODE_LABEL } from '../../hooks/useVendors';
import type { CustomerScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export function VendorRegistrationScreen({ navigation }: CustomerScreenProps<'VendorRegistration'>) {
  const { data: vendor, isLoading } = useMyVendor();
  const submit = useSubmitVendorRegistration();

  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [gst, setGst] = useState('');
  const [fssai, setFssai] = useState('');
  const [returns, setReturns] = useState('');
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!vendor) return;
    setBusinessName((p) => p || vendor.business_name || '');
    setPhone((p) => p || vendor.contact_phone || '');
    setGst((p) => p || vendor.gst_number || '');
    setFssai((p) => p || vendor.fssai_number || '');
    setReturns((p) => p || vendor.return_policy || '');
    setAccepted((p) => p || !!vendor.terms_accepted_at);
  }, [vendor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !vendor) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
      </SafeAreaView>
    );
  }

  // Once it is with us for verification the vendor cannot re-send or edit —
  // the RPC refuses a second submission, and the form reflects that rather
  // than letting them fill it in and be rejected at the last step.
  const awaitingReview = vendor.status !== 'invited';

  const handleSubmit = async () => {
    if (!businessName.trim()) {
      infoDialog('Business name required', 'Enter the name you trade under.');
      return;
    }
    if (!accepted) {
      infoDialog('Terms not accepted', 'Please accept the vendor terms to continue.');
      return;
    }
    try {
      await submit.mutateAsync({
        businessName: businessName.trim(),
        contactPhone: phone.trim() || undefined,
        gstNumber: gst.trim() || undefined,
        fssaiNumber: fssai.trim() || undefined,
        returnPolicy: returns.trim() || undefined,
      });
      navigation.goBack();
      setTimeout(
        () => infoDialog('Sent for review', 'We will confirm once your details are verified.'),
        450,
      );
    } catch (e) {
      infoDialog('Could not submit', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Vendor Registration" />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {awaitingReview && (
          <ThemedText variant="small" color="mint" style={styles.hint}>
            Your details are with us for verification. We will confirm shortly — get in
            touch if anything needs changing.
          </ThemedText>
        )}

        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>YOUR BUSINESS</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="Trading name"
          placeholderTextColor={Theme.colors.text.muted}
          value={businessName}
          onChangeText={setBusinessName}
          editable={!awaitingReview}
        />
        <TextInput
          style={styles.input}
          placeholder="Contact number for orders"
          placeholderTextColor={Theme.colors.text.muted}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          editable={!awaitingReview}
        />
        <TextInput
          style={styles.input}
          placeholder="GST number (if you have one)"
          placeholderTextColor={Theme.colors.text.muted}
          value={gst}
          onChangeText={setGst}
          autoCapitalize="characters"
          editable={!awaitingReview}
        />
        <TextInput
          style={styles.input}
          placeholder="FSSAI number (for food items)"
          placeholderTextColor={Theme.colors.text.muted}
          value={fssai}
          onChangeText={setFssai}
          autoCapitalize="characters"
          editable={!awaitingReview}
        />
        <TextInput
          style={styles.input}
          placeholder="Your returns / replacement policy"
          placeholderTextColor={Theme.colors.text.muted}
          value={returns}
          onChangeText={setReturns}
          multiline
          editable={!awaitingReview}
        />

        <Divider />

        {/* Read-only: these were agreed with you and are not yours to change. */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>AGREED WITH US</ThemedText>
        <ThemedText variant="body" color="subtitle" style={styles.txt}>
          {SELLING_MODEL_LABEL[vendor.selling_model]}
        </ThemedText>
        <ThemedText variant="body" color="subtitle" style={[styles.txt, styles.spaced]}>
          {SUPPLY_MODE_LABEL[vendor.supply_mode]}
        </ThemedText>
        {vendor.selling_model === 'own_brand' && (
          <ThemedText variant="body" color="mint" style={styles.txt}>
            Commission {vendor.commission_percent}%
          </ThemedText>
        )}

        <Divider />

        <TouchableOpacity
          style={[styles.termsRow, accepted && styles.termsRowOn]}
          onPress={() => setAccepted((v) => !v)}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
        >
          <ThemedText variant="body" color={accepted ? 'mint' : 'muted'} style={styles.txt}>
            {accepted ? '✓ ' : ''}I accept the vendor terms
          </ThemedText>
          <ThemedText variant="small" color="muted" style={styles.hint}>
            Covers the terms above, how and when you supply, and how you are paid.
          </ThemedText>
        </TouchableOpacity>
      </ScrollView>

      {!awaitingReview && (
        <TouchableOpacity
          style={styles.footer}
          onPress={handleSubmit}
          disabled={submit.isPending}
          activeOpacity={0.7}
        >
          {submit.isPending
            ? <ActivityIndicator color={Theme.colors.text.mint} />
            : <ThemedText variant="body" color="mint" style={styles.txt}>
                Send for verification  ›
              </ThemedText>}
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  loader: { marginTop: Theme.spacing.xl },

  scroll: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },
  sectionLabel: { fontSize: S, letterSpacing: 1, marginTop: Theme.spacing.md, marginBottom: Theme.spacing.xs },
  hint: { fontSize: S, marginTop: 2, marginBottom: Theme.spacing.xs },
  spaced: { marginVertical: 2 },

  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },

  termsRow: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    marginTop: Theme.spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  termsRowOn: { borderColor: Theme.colors.text.mint },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
    alignItems: 'center',
  },

  txt: { fontSize: B },
});
