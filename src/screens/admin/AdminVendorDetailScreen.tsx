/**
 * 1stOne F1 — Vendor Detail
 *
 * One vendor: who they are, what they submitted, the terms you agreed, and
 * where they may sell. This is where you verify and approve.
 *
 * Every write on this screen goes through a SECURITY DEFINER RPC. `vendors`
 * has UPDATE revoked from `authenticated` except the vendor's own business
 * details, so status and commission cannot be moved from a client at all —
 * not by a vendor, and not by an admin either. Same reason profiles.role
 * moves through elevate_to_staff.
 *
 * Zones are admin-granted rather than self-service: they decide who can see
 * a vendor's goods, so they are not the vendor's to choose.
 */

import React, { useState, useEffect } from 'react';
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
import { ScreenHeader } from '../../components/ScreenHeader';
import { Divider } from '../../components/Divider';
import { DispatchBadge } from '../../components/DispatchBadge';
import { ErrorRetry } from '../../components/ErrorRetry';
import { confirmDialog, infoDialog } from '../../utils/confirmDialog';
import { formatPhone, formatDateShort, getErrorMessage } from '../../utils/formatters';
import { useDeliveryZones } from '../../hooks/useDeliveryZones';
import { useDeliveryHubs } from '../../hooks/useDeliveryHubs';
import {
  useVendor,
  useVendorZones,
  useSetVendorStatus,
  useSetVendorTerms,
  useSetVendorZone,
  STATUS_LABEL,
  SELLING_MODEL_LABEL,
  SUPPLY_MODE_LABEL,
  type SellingModel,
  type SupplyMode,
  type VendorStatus,
} from '../../hooks/useVendors';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

const STATUS_VARIANT: Record<VendorStatus, 'success' | 'warning' | 'info' | 'error'> = {
  approved: 'success',
  submitted: 'warning',
  invited: 'info',
  suspended: 'error',
  rejected: 'error',
};

/**
 * Commission ('own_brand') only, deliberately.
 *
 * 'house_brand' — where 1stOne BUYS at an agreed per-item rate rather than
 * taking a cut — is a different arrangement end to end: its own onboarding,
 * an agreed buying price per item, and a different wallet treatment. None of
 * that is built. While it was merely selectable, picking it silently credited
 * the vendor ZERO on every delivered sale, because
 * credit_vendor_earnings_for_order reads essentials_catalog.vendor_cost and
 * COALESCEs an unset value to 0.
 *
 * The database still accepts both values and the trigger still handles both —
 * only the choice is withheld until the rest of it exists.
 */
const MODELS: SellingModel[] = ['own_brand'];
const MODES: SupplyMode[] = ['at_hub', 'we_collect', 'they_drop'];

export function AdminVendorDetailScreen({ route }: AdminScreenProps<'AdminVendorDetail'>) {
  const { vendorId } = route.params;
  const { data: vendor, isLoading, error, refetch } = useVendor(vendorId);
  const { data: zones = [] } = useVendorZones(vendorId);
  const { data: allZones = [] } = useDeliveryZones();
  const { data: allHubs = [] } = useDeliveryHubs();

  const setStatus = useSetVendorStatus();
  const setTerms = useSetVendorTerms();
  const setZone = useSetVendorZone();

  const [commission, setCommission] = useState('');
  const [sellingModel, setSellingModel] = useState<SellingModel>('own_brand');
  const [supplyMode, setSupplyMode] = useState<SupplyMode>('they_drop');

  useEffect(() => {
    if (!vendor) return;
    setCommission(String(vendor.commission_percent ?? 0));
    setSellingModel(vendor.selling_model);
    setSupplyMode(vendor.supply_mode);
    // Intentionally keyed on the FIELDS rather than the vendor object: a
    // refetch returns a new object every time, and depending on it would
    // wipe whatever the admin was mid-way through editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.id, vendor?.commission_percent, vendor?.selling_model, vendor?.supply_mode]);

  if (error) return <ErrorRetry message="Could not load this vendor" onRetry={refetch} />;
  if (isLoading || !vendor) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
      </SafeAreaView>
    );
  }

  const hasZone = (kind: 'zone' | 'hub', id: number) =>
    zones.some((z) => (kind === 'zone' ? z.zone_id === id : z.hub_id === id));

  const handleStatus = async (next: VendorStatus, title: string, message: string) => {
    const ok = await confirmDialog({ title, message, confirmLabel: title, destructive: next !== 'approved' });
    if (!ok) return;
    try {
      await setStatus.mutateAsync({ vendorId, status: next });
    } catch (e) {
      infoDialog('Could not update', getErrorMessage(e));
    }
  };

  const handleSaveTerms = async () => {
    const pct = parseFloat(commission);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      infoDialog('Invalid commission', 'Commission must be between 0 and 100.');
      return;
    }
    try {
      await setTerms.mutateAsync({ vendorId, commissionPercent: pct, sellingModel, supplyMode });
      infoDialog('Terms saved', 'Applies to sales from now on; earnings already credited are unchanged.');
    } catch (e) {
      infoDialog('Could not save terms', getErrorMessage(e));
    }
  };

  const canApprove = vendor.status === 'submitted' || vendor.status === 'invited';
  const missingDetails = !vendor.business_name || (!vendor.gst_number && !vendor.fssai_number);

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={vendor.business_name || 'Vendor'} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Identity + state */}
        <View style={styles.statusRow}>
          <DispatchBadge label={STATUS_LABEL[vendor.status]} variant={STATUS_VARIANT[vendor.status]} />
        </View>
        <ThemedText variant="body" color="primary" style={styles.txt}>
          {vendor.profiles?.full_name ?? '—'}
        </ThemedText>
        <ThemedText variant="small" color="muted" style={styles.hint}>
          {vendor.profiles?.phone_number ? formatPhone(vendor.profiles.phone_number) : 'No phone'}
          {vendor.created_at ? ` · invited ${formatDateShort(vendor.created_at)}` : ''}
        </ThemedText>

        <Divider />

        {/* What they submitted */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>THEIR DETAILS</ThemedText>
        <View style={styles.kv}>
          <ThemedText variant="small" color="muted" style={styles.k}>Business</ThemedText>
          <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]}>
            {vendor.business_name || '—'}
          </ThemedText>
        </View>
        <View style={styles.kv}>
          <ThemedText variant="small" color="muted" style={styles.k}>GST</ThemedText>
          <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]}>
            {vendor.gst_number || '—'}
          </ThemedText>
        </View>
        <View style={styles.kv}>
          <ThemedText variant="small" color="muted" style={styles.k}>FSSAI</ThemedText>
          <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]}>
            {vendor.fssai_number || '—'}
          </ThemedText>
        </View>
        <View style={styles.kv}>
          <ThemedText variant="small" color="muted" style={styles.k}>Terms</ThemedText>
          <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]}>
            {vendor.terms_accepted_at ? `Accepted ${formatDateShort(vendor.terms_accepted_at)}` : 'Not accepted'}
          </ThemedText>
        </View>
        {missingDetails && vendor.status !== 'approved' && (
          <ThemedText variant="small" color="muted" style={styles.hint}>
            They have not completed their registration yet. You can still approve, but the
            invoice needs a GSTIN if they sell under their own brand.
          </ThemedText>
        )}

        <Divider />

        {/* Negotiated terms */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>AGREED TERMS</ThemedText>
        {/* Defensive: no vendor is on house_brand today and the option is no
            longer offered, but a pre-existing one must not be silently shown
            as commission-based when the credit trigger will treat it otherwise. */}
        {vendor.selling_model === 'house_brand' && (
          <ThemedText variant="small" color="warning" style={styles.hint}>
            This vendor is set to house brand, which is not supported yet — they are
            currently credited ₹0 per sale. Switch them to commission below, or leave
            them suspended until house brand is available.
          </ThemedText>
        )}
        {MODELS.map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.option, sellingModel === m && styles.optionActive]}
            onPress={() => setSellingModel(m)}
            activeOpacity={0.7}
          >
            <ThemedText variant="body" color="primary" style={styles.txt}>{SELLING_MODEL_LABEL[m]}</ThemedText>
          </TouchableOpacity>
        ))}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>COMMISSION %</ThemedText>
        <TextInput
          style={styles.input}
          value={commission}
          onChangeText={setCommission}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={Theme.colors.text.muted}
        />
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>HOW GOODS REACH US</ThemedText>
        {MODES.map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.option, supplyMode === m && styles.optionActive]}
            onPress={() => setSupplyMode(m)}
            activeOpacity={0.7}
          >
            <ThemedText variant="body" color="primary" style={styles.txt}>{SUPPLY_MODE_LABEL[m]}</ThemedText>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={handleSaveTerms} disabled={setTerms.isPending} style={styles.inlineAction}>
          <ThemedText variant="body" color="mint" style={styles.txt}>
            {setTerms.isPending ? 'Saving…' : 'Save terms  ›'}
          </ThemedText>
        </TouchableOpacity>

        <Divider />

        {/* Selling areas */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>WHERE THEY MAY SELL</ThemedText>
        <ThemedText variant="small" color="muted" style={styles.hint}>
          Only customers whose address falls in a granted area will see their items.
        </ThemedText>
        {/* An approved vendor with no area is invisible to every customer and
            looks, from every other screen, exactly like one that is selling
            normally. Say so here, where the areas are actually granted. */}
        {zones.length === 0 && (
          <ThemedText variant="small" color="warning" style={styles.hint}>
            No area granted — nobody can see this vendor's items. Pick at least one below.
          </ThemedText>
        )}
        <View style={styles.pillWrap}>
          {allZones.filter((z: any) => z.is_active).map((z: any) => {
            const on = hasZone('zone', z.id);
            return (
              <TouchableOpacity
                key={`z${z.id}`}
                style={[styles.pill, on && styles.pillActive]}
                activeOpacity={0.7}
                onPress={() => setZone.mutate({ vendorId, zoneId: z.id, remove: on })}
              >
                <ThemedText variant="small" color={on ? 'mint' : 'muted'}>{z.zone_name}</ThemedText>
              </TouchableOpacity>
            );
          })}
          {allHubs.filter((h: any) => h.is_active).map((h: any) => {
            const on = hasZone('hub', h.id);
            return (
              <TouchableOpacity
                key={`h${h.id}`}
                style={[styles.pill, on && styles.pillActive]}
                activeOpacity={0.7}
                onPress={() => setZone.mutate({ vendorId, hubId: h.id, remove: on })}
              >
                <ThemedText variant="small" color={on ? 'mint' : 'muted'}>{h.hub_name} (hub)</ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Status actions */}
      <View style={styles.footerRow}>
        {vendor.status !== 'suspended' && vendor.status !== 'rejected' && (
          <TouchableOpacity
            onPress={() =>
              handleStatus(
                'suspended',
                'Suspend',
                'Their items go inactive immediately. Orders already placed are honoured and any balance stays claimable.',
              )
            }
          >
            <ThemedText variant="body" color="muted" style={styles.txt}>Suspend</ThemedText>
          </TouchableOpacity>
        )}
        {canApprove && (
          <TouchableOpacity
            onPress={() =>
              handleStatus('approved', 'Approve', 'They can list items in their granted areas from now on.')
            }
          >
            <ThemedText variant="body" color="mint" style={styles.txt}>Approve  ›</ThemedText>
          </TouchableOpacity>
        )}
        {(vendor.status === 'suspended' || vendor.status === 'rejected') && (
          <TouchableOpacity
            onPress={() =>
              handleStatus(
                'approved',
                'Reinstate',
                'They can sell again. Their items stay switched off until they turn them back on themselves.',
              )
            }
          >
            <ThemedText variant="body" color="mint" style={styles.txt}>Reinstate  ›</ThemedText>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  loader: { marginTop: Theme.spacing.xl },

  scroll: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },
  statusRow: { flexDirection: 'row', marginTop: Theme.spacing.sm, marginBottom: Theme.spacing.xs },
  sectionLabel: { fontSize: S, letterSpacing: 1, marginTop: Theme.spacing.md, marginBottom: Theme.spacing.xs },
  hint: { fontSize: S, marginTop: 2, marginBottom: Theme.spacing.xs },

  kv: { flexDirection: 'row', alignItems: 'center', paddingVertical: Theme.spacing.xs, gap: Theme.spacing.sm },
  k: { fontSize: S, minWidth: 76 },
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
  inlineAction: { paddingVertical: Theme.spacing.sm },

  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm, marginBottom: Theme.spacing.sm },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  pillActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },

  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },

  txt: { fontSize: B },
});
