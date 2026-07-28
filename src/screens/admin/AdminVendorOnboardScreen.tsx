/**
 * 1stOne F1 — Onboard Vendor
 *
 * Elevates an EXISTING registered user to a vendor. It never creates a
 * login — same principle as employee onboarding, where the person signs in
 * by phone OTP and is matched on their number.
 *
 * The lookup reuses useCustomerByPhone, and an unknown number hands off to
 * the back-office customer screen to register them first. So there is one
 * way a person enters this system, not two.
 *
 * What you set here are the negotiated TERMS — selling model, supply mode,
 * commission. They are data on the vendor record rather than branches in
 * code, which is what lets you onboard the next vendor on different terms
 * without anyone changing the app.
 *
 * The vendor lands in `invited`: their profile menu gains a "Complete
 * vendor registration" entry, and they owe you GST/FSSAI and business
 * details before you can verify and approve them.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { infoDialog, confirmDialog } from '../../utils/confirmDialog';
import { formatPriceShort, getErrorMessage } from '../../utils/formatters';
import { useCustomerByPhone } from '../../hooks/useAdminOrderEntry';
import {
  useOnboardVendor,
  SELLING_MODEL_LABEL,
  SUPPLY_MODE_LABEL,
  type SellingModel,
  type SupplyMode,
} from '../../hooks/useVendors';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

const MODELS: SellingModel[] = ['own_brand', 'house_brand'];
const MODES: SupplyMode[] = ['at_hub', 'we_collect', 'they_drop'];

export function AdminVendorOnboardScreen({ navigation }: AdminScreenProps<'AdminVendorOnboard'>) {
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [sellingModel, setSellingModel] = useState<SellingModel>('own_brand');
  const [supplyMode, setSupplyMode] = useState<SupplyMode>('they_drop');
  const [commission, setCommission] = useState('');

  const { data: found, isFetching: lookingUp } = useCustomerByPhone(phone);
  const onboard = useOnboardVendor();

  const phoneComplete = phone.replace(/\D/g, '').length >= 10;
  const canSubmit = !!found && businessName.trim().length > 0;

  const handleOnboard = async () => {
    if (!found) {
      infoDialog('Not registered', 'Register this person first, then onboard them as a vendor.');
      return;
    }
    if (!businessName.trim()) {
      infoDialog('Business name required', 'Enter the trading name for this vendor.');
      return;
    }
    const pct = parseFloat(commission) || 0;
    if (pct < 0 || pct > 100) {
      infoDialog('Invalid commission', 'Commission must be between 0 and 100.');
      return;
    }
    if (sellingModel === 'own_brand' && pct === 0) {
      const ok = await confirmDialog({
        title: 'No commission?',
        message: 'This vendor sells under their own brand with 0% commission, so you earn nothing on their sales. Continue?',
        confirmLabel: 'Yes, 0%',
      });
      if (!ok) return;
    }

    try {
      await onboard.mutateAsync({
        userId: found.id,
        businessName: businessName.trim(),
        contactPhone: found.phone_number ?? undefined,
        sellingModel,
        supplyMode,
        commissionPercent: pct,
      });
      navigation.goBack();
      setTimeout(
        () =>
          infoDialog(
            'Vendor invited',
            `${businessName.trim()} can now complete their registration from their profile menu. Verify and approve them once they have.`,
          ),
        450,
      );
    } catch (e) {
      infoDialog('Could not onboard', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Onboard Vendor</ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>WHO</ThemedText>
        <ThemedText variant="small" color="muted" style={styles.hint}>
          A vendor must already be a registered user. This elevates them; it does not
          create a login.
        </ThemedText>
        <TextInput
          style={styles.input}
          placeholder="Their phone number (10 digits)"
          placeholderTextColor={Theme.colors.text.muted}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={13}
        />
        {lookingUp && <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />}
        {found && (
          <ThemedText variant="small" color="mint" style={styles.hint}>
            {found.full_name || 'Registered user'} · wallet {formatPriceShort(found.wallet_balance ?? 0)}
          </ThemedText>
        )}
        {phoneComplete && !lookingUp && !found && (
          <View style={styles.inlineRow}>
            <ThemedText variant="small" color="muted" style={[styles.hint, styles.flex1]}>
              Not registered yet.
            </ThemedText>
            <TouchableOpacity onPress={() => navigation.navigate('AdminCreateCustomer', { phone })}>
              <ThemedText variant="small" color="accent">Register them  ›</ThemedText>
            </TouchableOpacity>
          </View>
        )}

        <Divider />

        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>BUSINESS</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="Trading name (e.g. Shanti Milk Supply)"
          placeholderTextColor={Theme.colors.text.muted}
          value={businessName}
          onChangeText={setBusinessName}
        />
        <ThemedText variant="small" color="muted" style={styles.hint}>
          GST and FSSAI come from the vendor when they complete their own registration.
        </ThemedText>

        <Divider />

        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>SELLING MODEL</ThemedText>
        {MODELS.map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.option, sellingModel === m && styles.optionActive]}
            onPress={() => setSellingModel(m)}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected: sellingModel === m }}
          >
            <ThemedText variant="body" color="primary" style={styles.txt}>
              {SELLING_MODEL_LABEL[m]}
            </ThemedText>
            <ThemedText variant="small" color="muted">
              {m === 'own_brand'
                ? 'Their GSTIN on the invoice. They keep the sale less your commission.'
                : 'Your GSTIN, brand and FSSAI. You pay their agreed rate per item and keep the spread.'}
            </ThemedText>
          </TouchableOpacity>
        ))}

        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          COMMISSION {sellingModel === 'house_brand' ? '· not used for house brand' : ''}
        </ThemedText>
        <TextInput
          style={styles.input}
          placeholder="% you keep on each sale"
          placeholderTextColor={Theme.colors.text.muted}
          value={commission}
          onChangeText={setCommission}
          keyboardType="numeric"
          editable={sellingModel === 'own_brand'}
        />
        {sellingModel === 'house_brand' && (
          <ThemedText variant="small" color="muted" style={styles.hint}>
            House-brand vendors are paid an agreed rate set per item, not a commission.
          </ThemedText>
        )}

        <Divider />

        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>HOW GOODS REACH US</ThemedText>
        <ThemedText variant="small" color="muted" style={styles.hint}>
          Procurement only — the last mile is always ours.
        </ThemedText>
        {MODES.map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.option, supplyMode === m && styles.optionActive]}
            onPress={() => setSupplyMode(m)}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected: supplyMode === m }}
          >
            <ThemedText variant="body" color="primary" style={styles.txt}>
              {SUPPLY_MODE_LABEL[m]}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity
        style={styles.footer}
        onPress={handleOnboard}
        disabled={onboard.isPending || !canSubmit}
        activeOpacity={0.7}
      >
        {onboard.isPending
          ? <ActivityIndicator color={Theme.colors.text.mint} />
          : <ThemedText variant="body" color={canSubmit ? 'mint' : 'muted'} style={styles.txt}>
              Invite as vendor  ›
            </ThemedText>}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  scroll: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },
  sectionLabel: { fontSize: S, letterSpacing: 1, marginTop: Theme.spacing.md, marginBottom: Theme.spacing.xs },
  hint: { fontSize: S, marginTop: 2, marginBottom: Theme.spacing.xs },
  loader: { alignSelf: 'flex-start', marginVertical: Theme.spacing.xs },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  flex1: { flex: 1 },

  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },

  option: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionActive: { borderColor: Theme.colors.action.primary },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
    alignItems: 'center',
  },

  txt: { fontSize: B },
});
