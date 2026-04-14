/**
 * 1stOne F1 — Create Subscription Plan Screen
 *
 * Plan Name + cycle toggle + item picker (menu_items for Food, essentials_catalog for Essentials)
 * + quantity controls on selected items + free-form "Number of Days" integer.
 * planType ('food'|'essentials') comes from route.params.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { useAddPlan, type PlanType, type PlanItem } from '../../hooks/useSubscriptionPlans';
import { useAllDeliveryCycles, useAllMenuItems } from '../../hooks/useMenuManagement';
import { useAllEssentials, CYCLE_DISPLAY } from '../../hooks/useEssentialsCatalog';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

const MEAL_CYCLES = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];

export function CreatePlanScreen({ navigation, route }: { navigation: any; route: any }) {
  const planType: PlanType = route.params?.planType ?? 'food';

  const { data: rawCycles = [] } = useAllDeliveryCycles();
  const cycles = useMemo(
    () => rawCycles.filter((c: any) =>
      MEAL_CYCLES.some((m) => c.cycle_name?.toLowerCase().includes(m.toLowerCase()))
    ),
    [rawCycles]
  );

  const [cycleIdx, setCycleIdx] = useState(0);
  const [planName, setPlanName] = useState('');
  const [daysInput, setDaysInput] = useState('');
  const [selectedItems, setSelectedItems] = useState<PlanItem[]>([]);

  const selectedCycle = cycles[cycleIdx] as any;

  // Sync cycle from route params
  useEffect(() => {
    if (!cycles.length) return;
    const paramId = route.params?.cycleId;
    if (!paramId) return;
    const idx = cycles.findIndex((c: any) => c.id === paramId);
    if (idx >= 0) setCycleIdx(idx);
  }, [cycles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch available items for the selected cycle
  const { data: menuItems = [] } = useAllMenuItems(selectedCycle?.id);
  const { data: essentialItems = [] } = useAllEssentials(selectedCycle?.id);
  const availableItems = planType === 'food'
    ? menuItems.filter((i: any) => i.is_active)
    : essentialItems.filter((i: any) => i.is_active);

  const addPlan = useAddPlan();

  const handleAddItem = (item: { id: number; name: string }) => {
    if (selectedItems.find((si) => si.item_id === item.id)) return; // already added
    setSelectedItems((prev) => [...prev, { item_id: item.id, item_name: item.name, quantity: 1 }]);
  };

  const handleQtyChange = (itemId: number, delta: number) => {
    setSelectedItems((prev) =>
      prev.map((si) =>
        si.item_id === itemId ? { ...si, quantity: Math.max(1, si.quantity + delta) } : si
      )
    );
  };

  const handleRemoveItem = (itemId: number) => {
    setSelectedItems((prev) => prev.filter((si) => si.item_id !== itemId));
  };

  const handleSave = () => {
    if (!planName.trim()) { Alert.alert('Error', 'Enter a plan name'); return; }
    const days = parseInt(daysInput, 10);
    if (isNaN(days) || days <= 0) { Alert.alert('Error', 'Enter a valid number of days'); return; }
    if (!selectedCycle) { Alert.alert('Error', 'No delivery cycles available'); return; }
    if (selectedItems.length === 0) { Alert.alert('Error', 'Add at least one item to the plan'); return; }

    const totalPrice = availableItems.reduce((sum: number, ai: any) => {
      const si = selectedItems.find((s) => s.item_id === ai.id);
      return si ? sum + ai.price * si.quantity : sum;
    }, 0);

    addPlan.mutate(
      {
        name: planName.trim(),
        cycle_id: selectedCycle.id,
        type: planType,
        duration_days: days,
        price: totalPrice,
        plan_items: JSON.stringify(selectedItems),
      },
      { onSuccess: () => navigation.goBack() }
    );
  };

  const cycleLabel = selectedCycle
    ? planType === 'essentials'
      ? `${CYCLE_DISPLAY[selectedCycle.cycle_name] ?? selectedCycle.cycle_name}  ›`
      : `${selectedCycle.cycle_name}  ›`
    : '…';
  const typeLabel = planType === 'food' ? 'Food' : 'Essentials';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Create {typeLabel} Plan
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Cycle toggle */}
        <TouchableOpacity
          style={styles.cycleRow}
          onPress={() => cycles.length && setCycleIdx((p) => (p + 1) % cycles.length)}
          activeOpacity={0.7}
        >
          <ThemedText variant="body" color="mint" style={styles.txt}>{cycleLabel}</ThemedText>
        </TouchableOpacity>

        {/* Plan name */}
        <TextInput
          style={styles.input}
          placeholder="Plan name"
          placeholderTextColor={Theme.colors.text.muted}
          value={planName}
          onChangeText={setPlanName}
        />

        {/* Number of days */}
        <TextInput
          style={styles.input}
          placeholder="Number of days  (e.g. 30)"
          placeholderTextColor={Theme.colors.text.muted}
          value={daysInput}
          onChangeText={setDaysInput}
          keyboardType="number-pad"
        />

        {/* Available items to pick */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          {`SELECT ${typeLabel.toUpperCase()} ITEMS`}
        </ThemedText>

        {availableItems.length === 0 ? (
          <ThemedText variant="small" color="muted" style={styles.emptyNote}>
            {`No active ${typeLabel.toLowerCase()} items for this cycle`}
          </ThemedText>
        ) : (
          availableItems.map((item: any) => {
            const isAdded = selectedItems.some((si) => si.item_id === item.id);
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.availableRow}
                onPress={() => handleAddItem(item)}
                activeOpacity={0.7}
                disabled={isAdded}
              >
                <ThemedText
                  variant="body"
                  color={isAdded ? 'muted' : 'primary'}
                  style={styles.txt}
                >
                  {item.name}
                </ThemedText>
                <ThemedText variant="small" color="muted" style={styles.subTxt}>
                  {'₹'}{item.price}
                </ThemedText>
                {!isAdded && (
                  <ThemedText variant="body" color="mint" style={styles.addBtn}>+</ThemedText>
                )}
              </TouchableOpacity>
            );
          })
        )}

        {/* Selected items with qty controls */}
        {selectedItems.length > 0 && (
          <>
            <ThemedText variant="small" color="muted" style={[styles.sectionLabel, styles.sectionLabelMt]}>
              PLAN ITEMS
            </ThemedText>
            {selectedItems.map((si) => (
              <View key={si.item_id} style={styles.selectedRow}>
                <ThemedText variant="body" color="primary" style={[styles.txt, styles.selectedName]} numberOfLines={1}>
                  {si.item_name}
                </ThemedText>
                <View style={styles.qtyRow}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => handleQtyChange(si.item_id, -1)}>
                    <ThemedText variant="body" color="muted" style={styles.txt}>−</ThemedText>
                  </TouchableOpacity>
                  <ThemedText variant="body" color="primary" style={[styles.txt, styles.qtyNum]}>
                    {si.quantity}
                  </ThemedText>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => handleQtyChange(si.item_id, 1)}>
                    <ThemedText variant="body" color="muted" style={styles.txt}>+</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemoveItem(si.item_id)}>
                    <ThemedText variant="body" color="muted" style={styles.txt}>×</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.footer}
        onPress={handleSave}
        disabled={addPlan.isPending}
        activeOpacity={0.7}
      >
        <ThemedText variant="body" color={addPlan.isPending ? 'muted' : 'mint'} style={styles.txt}>
          {addPlan.isPending ? 'Saving...' : 'Save Plan  ›'}
        </ThemedText>
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
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  scroll: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },

  cycleRow: {
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-start',
    marginBottom: Theme.spacing.md,
  },

  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm + 2,
    marginBottom: Theme.spacing.sm,
  },

  sectionLabel: {
    letterSpacing: 1,
    fontSize: S,
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.xs,
  },
  sectionLabelMt: { marginTop: Theme.spacing.lg },
  emptyNote: { fontSize: S, paddingVertical: Theme.spacing.sm },

  availableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    gap: Theme.spacing.sm,
  },
  addBtn: { fontSize: B + 2, marginLeft: 'auto' },

  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  selectedName: { flex: 1, marginRight: Theme.spacing.sm },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.xs },
  qtyBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 4,
  },
  qtyNum: { minWidth: 28, textAlign: 'center' },
  removeBtn: {
    marginLeft: Theme.spacing.sm,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },

  txt: { fontSize: B },
  subTxt: { fontSize: S },
});
