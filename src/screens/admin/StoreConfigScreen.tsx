/**
 * 1stOne F1 — Operations Manager
 *
 * Flat text layout — no cards or boxes.
 * Storm Mode label and active toggle are in error red with ⚠ marker.
 * Cancellation window uses "2 hrs from order time OR cycle cutoff, whichever first" logic.
 * Feature Flags is a separate screen reachable from the footer.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useUpdateStoreConfig } from '../../hooks/useStaffManagement';
import { useBranchFilter } from '../../hooks/useBranchFilter';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// ── Flat inline field: label left, plain input right ─────
function Field({
  label,
  hint,
  value,
  onChangeText,
  keyboardType = 'default',
  last = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: 'default' | 'numeric' | 'phone-pad';
  last?: boolean;
}) {
  return (
    <View style={[styles.fieldRow, !last && styles.fieldBorder]}>
      <View style={{ flex: 1 }}>
        <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <TextInput
        style={styles.inlineInput}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholderTextColor={Theme.colors.text.muted}
        returnKeyType="done"
      />
    </View>
  );
}

// ── Flat drill-down row (chevron, navigates on press) ────
function DrillRow({
  label,
  onPress,
  last = false,
}: {
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.fieldRow, !last && styles.fieldBorder]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <ThemedText variant="body" color="primary" style={{ flex: 1, fontSize: B }}>
        {label}
      </ThemedText>
      <ThemedText variant="body" color="muted" style={{ fontSize: B }}>›</ThemedText>
    </TouchableOpacity>
  );
}

// ── Section label ────────────────────────────────────────
function SectionLabel({ title }: { title: string }) {
  return (
    <ThemedText
      variant="small"
      color="muted"
      style={{ fontSize: S, letterSpacing: 1, paddingHorizontal: Theme.spacing.md, paddingTop: Theme.spacing.md, paddingBottom: Theme.spacing.xs }}
    >
      {title.toUpperCase()}
    </ThemedText>
  );
}

// ── Main screen ──────────────────────────────────────────
export function StoreConfigScreen({ navigation }: { navigation: AdminNavProp }) {
  const { data: config, isLoading } = useStoreConfig();
  const updateConfig = useUpdateStoreConfig();

  const branchFilter = useBranchFilter();

  const [taxRate, setTaxRate] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [cancelWindow, setCancelWindow] = useState('');
  const [minTopup, setMinTopup] = useState('');
  const [loyaltyRate, setLoyaltyRate] = useState('');
  const [whatsappNum, setWhatsappNum] = useState('');

  useEffect(() => {
    if (config) {
      setTaxRate(String(config.tax_rate_percentage));
      setDeliveryFee(String(config.delivery_fee));
      setCancelWindow(String(config.cancellation_window_hours));
      setMinTopup(String(config.min_wallet_topup));
      setLoyaltyRate(String(config.loyalty_points_per_rupee));
      setWhatsappNum(config.whatsapp_support_number ?? '');
    }
  }, [config]);

  const handleSave = () => {
    updateConfig.mutate(
      {
        tax_rate_percentage: parseFloat(taxRate) || 0,
        delivery_fee: parseFloat(deliveryFee) || 0,
        cancellation_window_hours: parseFloat(cancelWindow) || 2,
        min_wallet_topup: parseFloat(minTopup) || 100,
        loyalty_points_per_rupee: parseFloat(loyaltyRate) || 0.1,
        whatsapp_support_number: whatsappNum || null,
      },
      { onSuccess: () => Alert.alert('Saved', 'Operations config updated.') },
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: Theme.spacing.xl }} color={Theme.colors.action.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={{ fontSize: B, minWidth: 60 }}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={{ flex: 1, textAlign: 'center' }}>
          Operations Manager
        </ThemedText>
        <TouchableOpacity onPress={handleSave} disabled={updateConfig.isPending} style={{ minWidth: 60, alignItems: 'flex-end' }}>
          {updateConfig.isPending
            ? <ActivityIndicator size="small" color={Theme.colors.text.mint} />
            : <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Save</ThemedText>
          }
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Theme.spacing.xl * 3 }}>

        {/* PRICING */}
        <SectionLabel title="Pricing" />
        <View style={styles.group}>
          <Field label="Tax Rate (%)" value={taxRate} onChangeText={setTaxRate} keyboardType="numeric" />
          <Field label="Delivery Fee (₹)" value={deliveryFee} onChangeText={setDeliveryFee} keyboardType="numeric" />
          <Field label="Min Wallet Top-up (₹)" value={minTopup} onChangeText={setMinTopup} keyboardType="numeric" />
          <Field label="Loyalty pts / ₹" value={loyaltyRate} onChangeText={setLoyaltyRate} keyboardType="numeric" last />
        </View>

        <Divider />

        {/* ORDERS */}
        <SectionLabel title="Orders" />
        <View style={styles.group}>
          <Field
            label="Cancellation Window (hrs)"
            hint="Applied from order time, or the cycle's cutoff — whichever comes first"
            value={cancelWindow}
            onChangeText={setCancelWindow}
            keyboardType="numeric"
            last
          />
        </View>

        <Divider />

        {/* SUPPORT */}
        <SectionLabel title="Support" />
        <View style={styles.group}>
          <Field label="WhatsApp Number" value={whatsappNum} onChangeText={setWhatsappNum} keyboardType="phone-pad" last />
        </View>

        {/* SUPER-ADMIN — branches CRUD + customer export, only visible to super-admin */}
        {branchFilter.isSuperAdmin && (
          <>
            <Divider />
            <SectionLabel title="Super-Admin" />
            <View style={styles.group}>
              <DrillRow
                label="Manage Branches"
                onPress={() => navigation.navigate('BranchesManage')}
              />
              <DrillRow
                label="Export Customers"
                onPress={() => navigation.navigate('CustomerExport')}
                last
              />
            </View>
          </>
        )}

      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={() => navigation.navigate('FeatureFlags')}>
          <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Feature Flags ›</ThemedText>
        </TouchableOpacity>
      </View>
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

  group: {
    paddingHorizontal: Theme.spacing.md,
  },

  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm + 2,
    gap: Theme.spacing.sm,
  },
  fieldBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  inlineInput: {
    minWidth: 100,
    textAlign: 'right',
    fontSize: B,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    paddingVertical: 2,
  },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
    alignItems: 'flex-end',
  },
});
