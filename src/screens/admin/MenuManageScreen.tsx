/**
 * 1stOne F1 — Admin Menu Management Screen
 *
 * View all menu items (including inactive).
 * Add new items, edit price/name, toggle active.
 * Filter by cycle.
 */

import React, { useState } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  StyleSheet,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { EmptyState } from '../../components/EmptyState';
import {
  useAllMenuItems,
  useAddMenuItem,
  useUpdateMenuItem,
  useToggleMenuItem,
  useAllDeliveryCycles,
} from '../../hooks/useMenuManagement';
import type { MenuItem } from '../../types';

export function MenuManageScreen({ navigation }: { navigation: any }) {
  const [cycleFilter, setCycleFilter] = useState<number | undefined>(undefined);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newIngredients, setNewIngredients] = useState('');
  const [newCycleId, setNewCycleId] = useState<number>(0);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');

  const { data: cycles } = useAllDeliveryCycles();
  const { data: items, isLoading } = useAllMenuItems(cycleFilter);
  const addItem = useAddMenuItem();
  const updateItem = useUpdateMenuItem();
  const toggleItem = useToggleMenuItem();

  const handleAdd = () => {
    if (!newName.trim() || !newPrice || !newCycleId) {
      Alert.alert('Error', 'Name, price, and cycle are required');
      return;
    }
    addItem.mutate(
      {
        cycle_id: newCycleId,
        name: newName.trim(),
        price: parseFloat(newPrice),
        ingredients: newIngredients.trim() || undefined,
      },
      {
        onSuccess: () => {
          setShowAddForm(false);
          setNewName('');
          setNewPrice('');
          setNewIngredients('');
          setNewCycleId(0);
        },
      }
    );
  };

  const handleStartEdit = (item: MenuItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditPrice(String(item.price));
  };

  const handleSaveEdit = (id: number) => {
    if (!editName.trim() || !editPrice) return;
    updateItem.mutate(
      { id, name: editName.trim(), price: parseFloat(editPrice) },
      { onSuccess: () => setEditingId(null) }
    );
  };

  const handleToggle = (id: number, currentActive: boolean) => {
    toggleItem.mutate({ id, is_active: !currentActive });
  };

  const renderItem = ({ item }: { item: MenuItem }) => {
    const isEditing = editingId === item.id;

    return (
      <View style={[styles.card, !item.is_active && styles.cardInactive]}>
        {isEditing ? (
          <View>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder="Item name"
              placeholderTextColor={Theme.colors.text.muted}
            />
            <TextInput
              style={styles.input}
              value={editPrice}
              onChangeText={setEditPrice}
              placeholder="Price"
              placeholderTextColor={Theme.colors.text.muted}
              keyboardType="numeric"
            />
            <View style={styles.editActions}>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={() => handleSaveEdit(item.id)}
              >
                <ThemedText variant="small" color="primary">
                  Save
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingId(null)}>
                <ThemedText variant="small" color="subtitle">
                  Cancel
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <View style={styles.cardHeader}>
              <View style={styles.cardInfo}>
                <ThemedText variant="body" color="primary">
                  {item.name}
                </ThemedText>
                <ThemedText variant="small" color="subtitle">
                  {'\u20B9'}{item.price} — Cycle {item.cycle_id}
                </ThemedText>
                {item.ingredients && (
                  <ThemedText variant="small" color="muted">
                    {item.ingredients}
                  </ThemedText>
                )}
              </View>
              <View style={styles.cardActions}>
                <Switch
                  value={item.is_active}
                  onValueChange={() => handleToggle(item.id, item.is_active)}
                  trackColor={{
                    true: Theme.colors.status.success,
                    false: Theme.colors.background.tertiary,
                  }}
                />
                <TouchableOpacity onPress={() => handleStartEdit(item)}>
                  <ThemedText variant="small" color="accent">
                    Edit
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">
            {'< Back'}
          </ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">
          Menu Items
        </ThemedText>
        <TouchableOpacity onPress={() => setShowAddForm(!showAddForm)}>
          <ThemedText variant="body" color="accent">
            {showAddForm ? 'Cancel' : '+ Add'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Cycle Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterContent}
      >
        <TouchableOpacity
          style={[styles.chip, !cycleFilter && styles.chipActive]}
          onPress={() => setCycleFilter(undefined)}
        >
          <ThemedText variant="small" color={!cycleFilter ? 'primary' : 'subtitle'}>
            All
          </ThemedText>
        </TouchableOpacity>
        {(cycles ?? []).map((c: any) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.chip, cycleFilter === c.id && styles.chipActive]}
            onPress={() => setCycleFilter(c.id)}
          >
            <ThemedText
              variant="small"
              color={cycleFilter === c.id ? 'primary' : 'subtitle'}
            >
              {c.cycle_name}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Add Form */}
      {showAddForm && (
        <View style={styles.addForm}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.cyclePicker}
            contentContainerStyle={styles.cyclePickerContent}
          >
            {(cycles ?? []).map((c: any) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, newCycleId === c.id && styles.chipActive]}
                onPress={() => setNewCycleId(c.id)}
              >
                <ThemedText
                  variant="small"
                  color={newCycleId === c.id ? 'primary' : 'subtitle'}
                >
                  {c.cycle_name}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="Item name"
            placeholderTextColor={Theme.colors.text.muted}
          />
          <TextInput
            style={styles.input}
            value={newPrice}
            onChangeText={setNewPrice}
            placeholder="Price (INR)"
            placeholderTextColor={Theme.colors.text.muted}
            keyboardType="numeric"
          />
          <TextInput
            style={styles.input}
            value={newIngredients}
            onChangeText={setNewIngredients}
            placeholder="Ingredients (optional)"
            placeholderTextColor={Theme.colors.text.muted}
          />
          <ThemedButton
            title="Add Item"
            variant="primary"
            onPress={handleAdd}
            loading={addItem.isPending}
          />
        </View>
      )}

      {/* Items List */}
      <FlatList
        data={items ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ListEmptyComponent={
          !isLoading ? <EmptyState message="No menu items" /> : null
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.xl + Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  filterBar: {
    maxHeight: 40,
    marginBottom: Theme.spacing.sm,
  },
  filterContent: {
    paddingHorizontal: Theme.spacing.md,
    gap: Theme.spacing.xs,
  },
  chip: {
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.tertiary,
  },
  chipActive: {
    backgroundColor: Theme.colors.action.primary,
  },
  addForm: {
    backgroundColor: Theme.colors.background.secondary,
    marginHorizontal: Theme.spacing.md,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  cyclePicker: {
    maxHeight: 36,
    marginBottom: Theme.spacing.sm,
  },
  cyclePickerContent: {
    gap: Theme.spacing.xs,
  },
  input: {
    backgroundColor: Theme.colors.background.input,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    marginBottom: Theme.spacing.sm,
  },
  list: {
    padding: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  card: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  cardInactive: {
    opacity: 0.5,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardInfo: {
    flex: 1,
    marginRight: Theme.spacing.sm,
  },
  cardActions: {
    alignItems: 'flex-end',
    gap: Theme.spacing.xs,
  },
  editActions: {
    flexDirection: 'row',
    gap: Theme.spacing.md,
    alignItems: 'center',
    marginTop: Theme.spacing.sm,
  },
  saveBtn: {
    backgroundColor: Theme.colors.action.primary,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 6,
  },
});
