/**
 * 1stOne F1 — Subscription Plans Manager
 *
 * 2-tab page: Food | Essentials (pipe-separated, same pattern as StaffDashboard).
 * Each tab: cycle toggle → plan list (price edit + enable/disable switch).
 * Footer: Import CSV ›  |  + Add Plan ›
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import {
  useAllPlans,
  useUpdatePlanPrice,
  useTogglePlan,
  type SubscriptionPlan,
  type PlanType,
} from '../../hooks/useSubscriptionPlans';
import { useAllDeliveryCycles } from '../../hooks/useMenuManagement';
import { CYCLE_DISPLAY } from '../../hooks/useEssentialsCatalog';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;
const P = Theme.typography.sizes.body + 4;

const MEAL_CYCLES = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];
type PlanTab = 'Food' | 'Essentials';

function parsePlanItems(raw: string): { item_name: string; quantity: number }[] {
  try { return JSON.parse(raw) ?? []; } catch { return []; }
}

export function PlansManageScreen({ navigation }: { navigation: any }) {
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  const cycles = useMemo(
    () => rawCycles.filter((c: any) =>
      MEAL_CYCLES.some((m) => c.cycle_name?.toLowerCase().includes(m.toLowerCase()))
    ),
    [rawCycles]
  );

  const [activeTab, setActiveTab] = useState<PlanTab>('Food');
  const [cycleIdx, setCycleIdx] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState('');

  const updatePrice = useUpdatePlanPrice();
  const togglePlan = useTogglePlan();

  const selectedCycle = cycles[cycleIdx] as any;
  const planType: PlanType = activeTab === 'Food' ? 'food' : 'essentials';
  const { data: plans = [], isLoading } = useAllPlans(selectedCycle?.id, planType);

  const cycleLabel = selectedCycle
    ? activeTab === 'Essentials'
      ? `${CYCLE_DISPLAY[selectedCycle.cycle_name] ?? selectedCycle.cycle_name}  ›`
      : `${selectedCycle.cycle_name}  ›`
    : '…';

  const handlePriceTap = (plan: SubscriptionPlan) => {
    setEditingId(plan.id);
    setPriceInput(String(plan.price));
  };

  const commitPrice = (id: number) => {
    const price = parseFloat(priceInput);
    if (!isNaN(price) && price >= 0) updatePrice.mutate({ id, price });
    setEditingId(null);
  };

  const TABS: PlanTab[] = ['Food', 'Essentials'];

  const renderPlan = ({ item }: { item: SubscriptionPlan }) => {
    const isEditingPrice = editingId === item.id;
    const planItems = parsePlanItems(item.plan_items);
    return (
      <View style={[styles.row, !item.is_active && styles.rowDim]}>
        <View style={styles.rowLeft}>
          <ThemedText variant="body" color="primary" style={styles.rowText} numberOfLines={1}>
            {item.name}
          </ThemedText>
          <ThemedText variant="small" color="muted" style={styles.sub}>
            {item.duration_days} days
          </ThemedText>
          {planItems.length > 0 && (
            <ThemedText variant="small" color="muted" style={styles.sub} numberOfLines={1}>
              {planItems.map((pi) => `${pi.item_name} ×${pi.quantity}`).join(', ')}
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
              Alert.alert(
                'Deactivate Plan?',
                `"${item.name}" will no longer be available for new subscriptions.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Deactivate', style: 'destructive', onPress: () => togglePlan.mutate({ id: item.id, is_active: false }) },
                ]
              );
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Subscriptions Manager
        </ThemedText>
        <View style={styles.spacer} />
      </View>

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
              title={`No ${activeTab.toLowerCase()} plans for ${selectedCycle?.cycle_name ?? '…'}`}
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
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('CreatePlan', {
              cycleId: selectedCycle?.id,
              cycleName: selectedCycle?.cycle_name,
              planType,
            })
          }
        >
          <ThemedText variant="body" color="mint" style={styles.rowText}>+ Add Plan  ›</ThemedText>
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
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

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
  tabActive: { fontWeight: '600' },

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
