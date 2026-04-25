/**
 * 1stOne F1 — Add Essential Item Screen
 *
 * Creates a new item in essentials_catalog linked to a delivery cycle (cycle_id).
 * Toggle shows Morning/Noon/Afternoon/Evening as friendly labels for
 * the underlying Breakfast/Lunch/Snacks/Dinner cycles.
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
import { useAddEssential } from '../../hooks/useEssentialsCatalog';
import { useAllDeliveryCycles } from '../../hooks/useMenuManagement';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;

export function CreateEssentialScreen({ navigation, route }: AdminScreenProps<'CreateEssential'>) {
  const { data: rawCycles = [] } = useAllDeliveryCycles();
  // Essentials cycles only (is_essentials = true) — matches EssentialsCatalogManageScreen
  const cycles = useMemo(
    () => rawCycles.filter((c: any) => c.is_essentials),
    [rawCycles]
  );

  const addEssential = useAddEssential();
  const [cycleIdx, setCycleIdx] = useState(0);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');

  // Sync to cycle passed from parent screen
  useEffect(() => {
    if (!cycles.length) return;
    const paramId = route.params?.cycleId;
    if (!paramId) return;
    const idx = cycles.findIndex((c: any) => c.id === paramId);
    if (idx >= 0) setCycleIdx(idx);
  }, [cycles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCycle = cycles[cycleIdx] as any;
  const displayName = selectedCycle ? selectedCycle.cycle_name : '…';
  const cycleLabel = `${displayName} Essentials`;

  const handleCycleToggle = () => {
    if (!cycles.length) return;
    setCycleIdx((p) => (p + 1) % cycles.length);
  };

  const handleSave = () => {
    if (!name.trim()) { Alert.alert('Error', 'Enter an item name'); return; }
    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice < 0) { Alert.alert('Error', 'Enter a valid price'); return; }
    if (!selectedCycle) { Alert.alert('Error', 'No delivery cycles available'); return; }
    addEssential.mutate(
      { name: name.trim(), cycle_id: selectedCycle.id, price: numPrice },
      { onSuccess: () => navigation.goBack() }
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Add Essential Item
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Cycle toggle */}
        <TouchableOpacity style={styles.cycleRow} onPress={handleCycleToggle} activeOpacity={0.7}>
          <ThemedText variant="body" color="mint" style={styles.txt}>
            {cycleLabel}{'  ›'}
          </ThemedText>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder="Item name  (e.g. Full Cream Milk)"
          placeholderTextColor={Theme.colors.text.muted}
          value={name}
          onChangeText={setName}
        />

        <TextInput
          style={styles.input}
          placeholder="Price  (₹)"
          placeholderTextColor={Theme.colors.text.muted}
          value={price}
          onChangeText={setPrice}
          keyboardType="numeric"
          returnKeyType="done"
        />
      </ScrollView>

      <TouchableOpacity
        style={styles.footer}
        onPress={handleSave}
        disabled={addEssential.isPending}
        activeOpacity={0.7}
      >
        <ThemedText variant="body" color={addEssential.isPending ? 'muted' : 'mint'} style={styles.txt}>
          {addEssential.isPending ? 'Saving...' : 'Save Item  ›'}
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
  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  txt: { fontSize: B },
});
