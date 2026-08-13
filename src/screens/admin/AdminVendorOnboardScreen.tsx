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

import React, { useState, useMemo } from 'react';
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
import { FooterAction, FOOTER_CLEARANCE } from '../../components/FooterAction';
import { useWizard, WizardProgress } from '../../components/Wizard';
import { Divider } from '../../components/Divider';
import { confirmDialog, infoDialog } from '../../utils/confirmDialog';
import { formatPriceShort, getErrorMessage } from '../../utils/formatters';
import { useCustomerByPhone } from '../../hooks/useAdminOrderEntry';
import { useDeliveryZones } from '../../hooks/useDeliveryZones';
import { useDeliveryHubs } from '../../hooks/useDeliveryHubs';
import {
  useOnboardVendor,
  useSetVendorZone,
  SELLING_MODEL_LABEL,
  SUPPLY_MODE_LABEL,
  type SellingModel,
  type SupplyMode,
} from '../../hooks/useVendors';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

/**
 * Commission ('own_brand') only, deliberately — see the same note in
 * AdminVendorDetailScreen. 'house_brand' needs its own onboarding, an agreed
 * buying price per item and a different wallet treatment, none of which is
 * built; while it was merely selectable it silently paid the vendor ZERO on
 * every delivered sale.
 */
/**
 * Four questions, not six sections: the selling model and the commission are
 * one negotiation, and the supply mode belongs with them. Splitting a single
 * decision across three screens is how a wizard becomes a chore.
 */
type Step = 'who' | 'business' | 'terms' | 'reach';
const STEPS: Step[] = ['who', 'business', 'terms', 'reach'];

const MODELS: SellingModel[] = ['own_brand'];
const MODES: SupplyMode[] = ['at_hub', 'we_collect', 'they_drop'];

export function AdminVendorOnboardScreen({ navigation }: AdminScreenProps<'AdminVendorOnboard'>) {
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [sellingModel, setSellingModel] = useState<SellingModel>('own_brand');
  const [supplyMode, setSupplyMode] = useState<SupplyMode>('they_drop');
  const [commission, setCommission] = useState('');

  // Selling areas, chosen here rather than only on the detail screen. Onboarding
  // never asked for them, so a vendor was created reaching nobody and the gap
  // was invisible until someone noticed their items missing from the storefront.
  const [pickedZones, setPickedZones] = useState<number[]>([]);
  const [pickedHubs, setPickedHubs] = useState<number[]>([]);

  const { data: found, isFetching: lookingUp } = useCustomerByPhone(phone);
  const { data: allZones = [] } = useDeliveryZones();
  const { data: allHubs = [] } = useDeliveryHubs();
  const onboard = useOnboardVendor();
  const setZone = useSetVendorZone();

  const phoneComplete = phone.replace(/\D/g, '').length >= 10;

  const wiz = useWizard<Step>(STEPS, navigation);

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

    if (pickedZones.length === 0 && pickedHubs.length === 0) {
      const ok = await confirmDialog({
        title: 'No selling area?',
        message: 'Nobody will be able to see this vendor\'s items until an area is granted. You can set it later on their vendor page. Continue anyway?',
        confirmLabel: 'Continue',
      });
      if (!ok) return;
    }

    try {
      const newVendorId = await onboard.mutateAsync({
        userId: found.id,
        businessName: businessName.trim(),
        contactPhone: found.phone_number ?? undefined,
        sellingModel,
        supplyMode,
        commissionPercent: pct,
      });

      // Areas are separate rows, so they can only be written once the vendor
      // exists. A failure here must not read as a failed onboarding — the
      // vendor IS created, and the areas remain editable on their page.
      const areaFailures: string[] = [];
      for (const zoneId of pickedZones) {
        try {
          await setZone.mutateAsync({ vendorId: newVendorId, zoneId });
        } catch {
          areaFailures.push(allZones.find((z: any) => z.id === zoneId)?.zone_name ?? `zone ${zoneId}`);
        }
      }
      for (const hubId of pickedHubs) {
        try {
          await setZone.mutateAsync({ vendorId: newVendorId, hubId });
        } catch {
          areaFailures.push(allHubs.find((h: any) => h.id === hubId)?.hub_name ?? `hub ${hubId}`);
        }
      }

      // `finish()` before leaving — `goBack` removes this screen and would
      // otherwise trip the wizard's back guard, stepping to the previous
      // question instead of closing a form that has already been submitted.
      wiz.finish();
      navigation.goBack();
      setTimeout(
        () =>
          infoDialog(
            'Vendor invited',
            areaFailures.length > 0
              ? `${businessName.trim()} was created, but these areas could not be granted: ${areaFailures.join(', ')}. Set them on their vendor page.`
              : `${businessName.trim()} can now complete their registration from their profile menu. Verify and approve them once they have.`,
          ),
        450,
      );
    } catch (e) {
      infoDialog('Could not onboard', getErrorMessage(e));
    }
  };

  /**
   * The refusals `handleOnboard` used to make all at once, moved to the steps
   * that own them. The submit handler still checks every one — this only
   * decides where an admin meets them.
   */
  const commissionPct = parseFloat(commission) || 0;
  const footer = useMemo((): { label: string; onPress?: () => void } => {
    switch (wiz.step) {
      case 'who':
        if (!found) {
          return { label: phoneComplete ? 'Not a registered user' : 'Enter their phone number' };
        }
        return { label: 'Next · business  ›', onPress: wiz.forward };
      case 'business':
        if (!businessName.trim()) return { label: 'Enter the trading name' };
        return { label: 'Next · terms  ›', onPress: wiz.forward };
      case 'terms':
        if (commission.trim() !== '' && (commissionPct < 0 || commissionPct > 100)) {
          return { label: 'Commission must be between 0 and 100' };
        }
        return { label: 'Next · selling area  ›', onPress: wiz.forward };
      default:
        return { label: 'Invite as vendor  ›', onPress: handleOnboard };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleOnboard reads current state on call
  }, [wiz.step, wiz.forward, found, phoneComplete, businessName, commission, commissionPct]);

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Onboard Vendor" />

      <View style={styles.progress}>
        <WizardProgress count={STEPS.length} index={wiz.index} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── 1. Who ── */}
        {wiz.step === 'who' && (<>
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

        </>)}

        {/* ── 2. Business ── */}
        {wiz.step === 'business' && (<>
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

        </>)}

        {/* ── 3. Terms — model, commission and how goods arrive ── */}
        {wiz.step === 'terms' && (<>
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
              Their GSTIN on the invoice. They keep the sale less your commission.
            </ThemedText>
          </TouchableOpacity>
        ))}

        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>COMMISSION</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="% you keep on each sale"
          placeholderTextColor={Theme.colors.text.muted}
          value={commission}
          onChangeText={setCommission}
          keyboardType="numeric"
        />

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

        </>)}

        {/* ── 4. Where they may sell ── */}
        {wiz.step === 'reach' && (<>
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>WHERE THEY MAY SELL</ThemedText>
        <ThemedText variant="small" color="muted" style={styles.hint}>
          Only customers whose address falls in a granted area will see their items.
          A vendor granted a hub does NOT reach direct-delivery customers in the
          same zone — pick both if they should. Editable later on their vendor page.
        </ThemedText>
        <View style={styles.pillWrap}>
          {allZones.filter((z: any) => z.is_active).map((z: any) => {
            const on = pickedZones.includes(z.id);
            return (
              <TouchableOpacity
                key={`z${z.id}`}
                style={[styles.pill, on && styles.pillActive]}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() =>
                  setPickedZones((prev) =>
                    on ? prev.filter((id) => id !== z.id) : [...prev, z.id],
                  )
                }
              >
                <ThemedText variant="small" color={on ? 'mint' : 'muted'}>{z.zone_name}</ThemedText>
              </TouchableOpacity>
            );
          })}
          {allHubs.filter((h: any) => h.is_active).map((h: any) => {
            const on = pickedHubs.includes(h.id);
            return (
              <TouchableOpacity
                key={`h${h.id}`}
                style={[styles.pill, on && styles.pillActive]}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() =>
                  setPickedHubs((prev) =>
                    on ? prev.filter((id) => id !== h.id) : [...prev, h.id],
                  )
                }
              >
                <ThemedText variant="small" color={on ? 'mint' : 'muted'}>{h.hub_name} (hub)</ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
        </>)}
      </ScrollView>

      <FooterAction label={footer.label} onPress={footer.onPress} busy={onboard.isPending} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  scroll: { paddingHorizontal: Theme.spacing.md, paddingBottom: FOOTER_CLEARANCE },
  progress: { paddingHorizontal: Theme.spacing.md, paddingTop: Theme.spacing.sm },
  sectionLabel: { fontSize: S, letterSpacing: 1, marginTop: Theme.spacing.md, marginBottom: Theme.spacing.xs },

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
