/**
 * 1stOne F1 — Subscription Plans Manager
 *
 * 3-tab page: Food | Essentials | Custom (pipe-separated, same pattern as
 * StaffDashboard).
 *
 * Food / Essentials: cycle toggle → plan list (price edit + enable/disable).
 *   Footer: Import CSV ›  |  + Add Plan ›
 * Custom: what governs the CUSTOMER's own plan builder — the length-based
 *   discount schedule, and which items may go in a plan at all. No cycle
 *   toggle and no footer there; it configures the builder rather than
 *   listing plans.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import { EmptyState } from '../../components/EmptyState';
import { CatalogPhotoThumb } from '../../components/CatalogPhotoThumb';
import { PHOTO_BUCKET, PHOTO_PX } from '../../utils/catalogPhoto';
import { pickCatalogPhoto, uploadCatalogPhoto } from '../../utils/catalogPhotoUpload';
import { confirmDialog, infoDialog, choiceDialog } from '../../utils/confirmDialog';
import { getErrorMessage } from '../../utils/formatters';
import {
  useAllPlans,
  useUpdatePlanPrice,
  useTogglePlan,
  type SubscriptionPlan,
  type PlanType,
} from '../../hooks/useSubscriptionPlans';
import { useAllDeliveryCycles } from '../../hooks/useMenuManagement';
import { formatPlanLine, type PlanLine } from '../../utils/planItems';
import { CustomPlanSettingsTab } from './components/CustomPlanSettingsTab';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;
const P = Theme.typography.sizes.body + 4;

/**
 * ONE LIST FOR BOTH TYPES. Food and Essentials used to be separate tabs, and
 * for admin-built plans that split was still accurate — the editor offers
 * food blocks or essentials, never both. It was the wrong thing to organise
 * by all the same: an admin scanning "what is on offer for Breakfast" had to
 * check two tabs and hold the answer in their head, and now that a customer's
 * own plan can hold both, the split had stopped matching how plans are
 * thought about anywhere else in the app.
 *
 * The type has not gone away — it is on each row, and it is still chosen when
 * a plan is created, which is the only moment it actually decides anything.
 *
 * Custom stays its own tab because it is not a list of plans at all: it
 * configures what a customer may put in one.
 */
type PlanTab = 'Plans' | 'Custom';

function parsePlanItems(raw: string): PlanLine[] {
  try { return JSON.parse(raw) ?? []; } catch { return []; }
}

export function PlansManageScreen({ navigation }: { navigation: AdminNavProp }) {
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  // Active delivery cycles (already branch-scoped & sort_order-ordered by
  // useAllDeliveryCycles). Filter on is_active, not a cycle-name substring —
  // renaming a cycle must never drop it from the picker.
  const cycles = useMemo(
    () => rawCycles.filter((c: any) => c.is_active),
    [rawCycles]
  );

  const [activeTab, setActiveTab] = useState<PlanTab>('Plans');
  const [cycleIdx, setCycleIdx] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState('');

  const updatePrice = useUpdatePlanPrice();
  const togglePlan = useTogglePlan();

  const selectedCycle = cycles[cycleIdx] as any;
  // No type argument — useAllPlans returns both when it is omitted.
  const { data: plans = [], isLoading, refetch } = useAllPlans(selectedCycle?.id);

  // The cycle's own name, not the essentials alias. One list serves both
  // types now, so there is no tab to pick an alias from — and the canonical
  // name is what the rest of the admin app shows.
  const cycleLabel = selectedCycle ? `${selectedCycle.cycle_name}  ›` : '…';

  const [busyPhotoId, setBusyPhotoId] = useState<number | null>(null);

  const handlePhoto = async (plan: SubscriptionPlan) => {
    setBusyPhotoId(plan.id);
    try {
      const photo = await pickCatalogPhoto();
      // Cancelled, or permission refused. Ordinary — say nothing.
      if (!photo) return;
      await uploadCatalogPhoto(PHOTO_BUCKET.plans, plan.id, photo);
      await refetch();
    } catch (e) {
      infoDialog('Could not set the photo', getErrorMessage(e));
    } finally {
      setBusyPhotoId(null);
    }
  };

  const handlePriceTap = (plan: SubscriptionPlan) => {
    setEditingId(plan.id);
    setPriceInput(String(plan.price));
  };

  const commitPrice = (id: number) => {
    const price = parseFloat(priceInput);
    if (!isNaN(price) && price >= 0) updatePrice.mutate({ id, price });
    setEditingId(null);
  };

  /**
   * Which kind of plan to build. The editor loads a different picker for each
   * — food blocks or the essentials catalogue — so the choice has to be made
   * before it opens, and merging the tabs took away the place it used to be
   * implied. Asked here rather than inside CreatePlan so the editor keeps one
   * job and the answer arrives with the route.
   */
  const handleAddPlan = () => {
    const go = (planType: PlanType) =>
      navigation.navigate('CreatePlan', {
        cycleId: selectedCycle?.id,
        cycleName: selectedCycle?.cycle_name,
        planType,
      });
    // Food first: it is what most plans are, and the OS dialog's button order
    // put it last only because Alert.alert renders its array bottom-up.
    choiceDialog(
      'New plan',
      `What goes in this ${selectedCycle?.cycle_name ?? ''} plan?`,
      ['Food', 'Essentials'],
    ).then((picked) => {
      if (picked === 0) go('food');
      else if (picked === 1) go('essentials');
    });
  };

  const TABS: PlanTab[] = ['Plans', 'Custom'];

  const renderPlan = ({ item }: { item: SubscriptionPlan }) => {
    const isEditingPrice = editingId === item.id;
    const planItems = parsePlanItems(item.plan_items);
    return (
      <View style={[styles.row, !item.is_active && styles.rowDim]}>
        {/* Tap the tile to set or replace the plan's picture — the same
            gesture as both catalogue managers, so there is one thing to
            learn. Disabled mid-upload so a double tap cannot start two. */}
        <TouchableOpacity
          onPress={() => handlePhoto(item)}
          disabled={busyPhotoId === item.id}
          activeOpacity={0.7}
          style={[styles.thumbWrap, busyPhotoId === item.id && styles.thumbBusy]}
        >
          <CatalogPhotoThumb
            bucket={PHOTO_BUCKET.plans}
            item={item}
            size={48}
            requestPx={PHOTO_PX.admin}
            fallbackIcon="calendar-outline"
          />
        </TouchableOpacity>
        <View style={styles.rowLeft}>
          <ThemedText variant="body" color="primary" style={styles.rowText} numberOfLines={1}>
            {item.plan_name}
          </ThemedText>
          <ThemedText variant="small" color="muted" style={styles.sub}>
            {item.duration_days} days · {item.plan_type === 'essentials' ? 'Essentials' : 'Food'}
          </ThemedText>
          {planItems.length > 0 && (
            <ThemedText variant="small" color="muted" style={styles.sub} numberOfLines={1}>
              {planItems.map(formatPlanLine).join(', ')}
            </ThemedText>
          )}
          {isEditingPrice ? (
            <TextInput
              style={styles.priceInput}
              value={priceInput}
              onChangeText={setPriceInput}
              keyboardType="numeric"
              autoFocus
              onBlur={() => commitPrice(item.id)}
              onSubmitEditing={() => commitPrice(item.id)}
              returnKeyType="done"
            />
          ) : (
            <TouchableOpacity onPress={() => handlePriceTap(item)} activeOpacity={0.7}>
              <ThemedText variant="small" color="mint" style={styles.price}>
                {'₹'}{item.price > 0 ? item.price : '—'}{'  ✎'}
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>
        <Switch
          value={item.is_active}
          onValueChange={() => {
            if (item.is_active) {
              confirmDialog({
                title: 'Deactivate plan?',
                message: `"${item.plan_name}" will no longer be available for new subscriptions.`,
                confirmLabel: 'Deactivate',
                destructive: true,
              }).then((ok) => {
                if (ok) togglePlan.mutate({ id: item.id, is_active: false });
              });
            } else {
              togglePlan.mutate({ id: item.id, is_active: true });
            }
          }}
          trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
          thumbColor={Theme.colors.text.primary}
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <ScreenHeader title="Subscriptions Manager" />

      {/* Food | Essentials tabs */}
      <View style={styles.topTabs}>
        {TABS.map((tab, idx) => (
          <React.Fragment key={tab}>
            {idx > 0 && (
              <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>
            )}
            <TouchableOpacity style={styles.topTab} onPress={() => { setActiveTab(tab); setCycleIdx(0); }}>
              <ThemedText
                variant="body"
                color={activeTab === tab ? 'primary' : 'muted'}
                style={[styles.tabText, activeTab === tab && styles.tabActive]}
              >
                {tab}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      {/* Custom configures the BUILDER, not a list of plans — so no cycle
          toggle and no Add Plan footer, both of which would be answering a
          question this tab is not asking. */}
      {activeTab === 'Custom' ? (
        <CustomPlanSettingsTab />
      ) : (
        <>
        {/* Cycle toggle */}
        <TouchableOpacity
          style={styles.cycleRow}
          onPress={() => cycles.length && setCycleIdx((p) => (p + 1) % cycles.length)}
          activeOpacity={0.7}
        >
          <ThemedText variant="body" color="mint" style={styles.cycleText}>
            {cycleLabel}
          </ThemedText>
        </TouchableOpacity>

        {/* Plans list */}
        <FlatList
          data={plans}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderPlan}
          ListEmptyComponent={
            !isLoading ? (
              <EmptyState
                title={`No plans for ${selectedCycle?.cycle_name ?? '…'}`}
                subtitle={'Tap "+ Add Plan" below'}
              />
            ) : null
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />

        {/* Footer */}
        <View style={styles.footerRow}>
          <TouchableOpacity
            onPress={() => navigation.navigate('ImportItems', { type: 'plans' })}
            activeOpacity={0.7}
          >
            <ThemedText variant="body" color="muted" style={styles.rowText}>Import CSV  ›</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={handleAddPlan}>
            <ThemedText variant="body" color="mint" style={styles.rowText}>+ Add Plan  ›</ThemedText>
          </TouchableOpacity>
        </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  topTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: Theme.spacing.sm,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  topTab: { paddingHorizontal: Theme.spacing.sm },
  tabText: { fontSize: B + 4 },
  tabActive: {  },

  cycleRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-start',
  },
  cycleText: { fontSize: B },

  list: { paddingBottom: Theme.spacing.xl },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  rowDim: { opacity: 0.45 },
  thumbWrap: { marginRight: Theme.spacing.md },
  thumbBusy: { opacity: 0.4 },
  rowLeft: { flex: 1, marginRight: Theme.spacing.sm },
  rowText: { fontSize: B },
  sub: { fontSize: S, marginTop: 2 },
  price: { fontSize: P, marginTop: 6 },
  priceInput: {
    marginTop: 6,
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: P,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: 2,
    minWidth: 80,
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
});
