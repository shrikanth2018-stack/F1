/**
 * 1stOne F1 — Operations Manager
 *
 * Flat text layout — no cards or boxes.
 * Storm Mode label and active toggle are in error red with ⚠ marker.
 * Cancellation window uses "2 hrs from order time OR cycle cutoff, whichever first" logic.
 * Feature Flags is a separate screen reachable from the footer.
 */

import React, { useState, useEffect } from 'react';
import { infoDialog } from '../../utils/confirmDialog';
import {
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Divider } from '../../components/Divider';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useUpdateStoreConfig } from '../../hooks/useStaffManagement';
import { useBranchFilter } from '../../hooks/useBranchFilter';
import { useDispatchBackfill } from '../../hooks/useDispatchBackfill';
import type { AdminNavProp } from '../../navigation/types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  const [maxTopup, setMaxTopup] = useState('');
  const [loyaltyRate, setLoyaltyRate] = useState('');
  const [whatsappNum, setWhatsappNum] = useState('');

  useEffect(() => {
    if (config) {
      setTaxRate(String(config.tax_rate_percentage));
      setDeliveryFee(String(config.delivery_fee));
      setCancelWindow(String(config.cancellation_window_hours));
      setMinTopup(String(config.min_wallet_topup));
      setMaxTopup(String(config.max_wallet_topup));
      setLoyaltyRate(String(config.loyalty_points_per_rupee));
      setWhatsappNum(config.whatsapp_support_number ?? '');
    }
  }, [config]);

  // ── Dispatch backfill (audit O2) ──────────────────────────
  const backfill = useDispatchBackfill();
  const [bfStart, setBfStart] = useState('');
  const [bfEnd, setBfEnd] = useState('');

  const handleBackfill = () => {
    if (!ISO_DATE.test(bfStart) || !ISO_DATE.test(bfEnd)) {
      infoDialog('Invalid dates', 'Enter both dates as YYYY-MM-DD.');
      return;
    }
    if (bfEnd < bfStart) {
      infoDialog('Invalid range', 'End date cannot be before start date.');
      return;
    }
    backfill.mutate(
      { start: bfStart, end: bfEnd },
      {
        onSuccess: (data) => {
          const r = Array.isArray(data) ? data[0] : data;
          infoDialog(
            'Backfill complete',
            `${r?.total_orders_created ?? 0} order(s) created across ${r?.days_processed ?? 0} day(s).`,
          );
        },
        onError: (e) => infoDialog('Backfill failed', e.message),
      },
    );
  };

  const handleSave = () => {
    // Reject blanks before sending — `parseFloat('') || N` was silently
    // substituting the per-field "default" (0 / 2 / 100 / …) for an empty
    // string, so blanking a field overwrote the live config without the
    // admin realising. Explicit zero is still accepted (admin can type 0).
    const required: { label: string; raw: string }[] = [
      { label: 'Tax rate %',          raw: taxRate },
      { label: 'Delivery fee',        raw: deliveryFee },
      { label: 'Cancel window hours', raw: cancelWindow },
      { label: 'Min wallet top-up',   raw: minTopup },
      { label: 'Max wallet top-up',   raw: maxTopup },
      { label: 'Loyalty per rupee',   raw: loyaltyRate },
    ];
    for (const f of required) {
      if (f.raw.trim() === '' || Number.isNaN(parseFloat(f.raw))) {
        infoDialog('Invalid value', `${f.label} cannot be empty.`);
        return;
      }
    }

    updateConfig.mutate(
      {
        tax_rate_percentage: parseFloat(taxRate),
        delivery_fee: parseFloat(deliveryFee),
        cancellation_window_hours: parseFloat(cancelWindow),
        min_wallet_topup: parseFloat(minTopup),
        max_wallet_topup: parseFloat(maxTopup),
        loyalty_points_per_rupee: parseFloat(loyaltyRate),
        whatsapp_support_number: whatsappNum || null,
      },
      { onSuccess: () => infoDialog('Saved', 'Operations config updated.') },
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
      <ScreenHeader
        title="Operations Manager"
        action={{ label: 'Save', onPress: handleSave, busy: updateConfig.isPending }}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Theme.spacing.xl * 3 }}>

        {/* PRICING */}
        <SectionLabel title="Pricing" />
        <View style={styles.group}>
          <Field label="Tax Rate (%)" value={taxRate} onChangeText={setTaxRate} keyboardType="numeric" />
          <Field label="Delivery Fee (₹)" value={deliveryFee} onChangeText={setDeliveryFee} keyboardType="numeric" />
          <Field label="Min Wallet Top-up (₹)" value={minTopup} onChangeText={setMinTopup} keyboardType="numeric" />
          <Field label="Max Wallet Top-up (₹)" value={maxTopup} onChangeText={setMaxTopup} keyboardType="numeric" />
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

        {/* DISPATCH — O2 backfill tool */}
        <SectionLabel title="Dispatch" />
        <View style={styles.group}>
          <Field
            label="Backfill From"
            hint="Re-run subscription dispatch for a past date range — idempotent, max 31 days"
            value={bfStart}
            onChangeText={setBfStart}
          />
          <Field label="Backfill To" value={bfEnd} onChangeText={setBfEnd} />
          <TouchableOpacity
            style={styles.fieldRow}
            onPress={handleBackfill}
            disabled={backfill.isPending}
            activeOpacity={0.6}
          >
            <ThemedText variant="body" color="primary" style={{ flex: 1, fontSize: B }}>
              Run Backfill
            </ThemedText>
            {backfill.isPending
              ? <ActivityIndicator size="small" color={Theme.colors.text.mint} />
              : <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Run ›</ThemedText>
            }
          </TouchableOpacity>
        </View>

        <Divider />

        {/* SUPPORT */}
        <SectionLabel title="Support" />
        <View style={styles.group}>
          <Field label="WhatsApp Number" value={whatsappNum} onChangeText={setWhatsappNum} keyboardType="phone-pad" last />
        </View>

        {/* SUPER-ADMIN — branches CRUD, only visible to super-admin.
            Customer export used to sit here too and now lives under
            Manage → People → Customer Manager, where someone looking for the
            customer list would actually go. Still super-admin gated, just
            gated there instead of here. */}
        {branchFilter.isSuperAdmin && (
          <>
            <Divider />
            <SectionLabel title="Super-Admin" />
            <View style={styles.group}>
              <DrillRow
                label="Manage Branches"
                onPress={() => navigation.navigate('BranchesManage')}
                last
              />
            </View>
          </>
        )}

      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={() => navigation.navigate('JobHealth')}>
          <ThemedText variant="body" color="mint" style={{ fontSize: B }}>System Health ›</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('FeatureFlags')}>
          <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Feature Flags ›</ThemedText>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

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
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
});
