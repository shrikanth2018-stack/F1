/**
 * 1stOne F1 — Staff Expenses Screen
 *
 * Submit and view expense claims.
 * Categories: Grocery, Vegetable, Stationery, Fuel, Expense.
 * Offline-aware submission.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  FlatList,
  StyleSheet,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { EmptyState } from '../../components/EmptyState';
import {
  useMyExpenses,
  useSubmitExpense,
  type ExpenseCategory,
} from '../../hooks/useExpenses';

const CATEGORIES: ExpenseCategory[] = [
  'Grocery',
  'Vegetable',
  'Stationery',
  'Fuel',
  'Expense',
];

function statusColor(status: string): string {
  switch (status) {
    case 'Approved':
      return Theme.colors.status.success;
    case 'Rejected':
      return Theme.colors.status.error;
    default:
      return Theme.colors.status.warning;
  }
}

export function StaffExpensesScreen() {
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory>('Grocery');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const { data: expenses, isLoading } = useMyExpenses();
  const submitExpense = useSubmitExpense();

  const handleSubmit = () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      Alert.alert('Error', 'Enter a valid amount');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Error', 'Enter a description');
      return;
    }

    submitExpense.mutate(
      { category, description: description.trim(), amount: numAmount },
      {
        onSuccess: () => {
          setShowForm(false);
          setAmount('');
          setDescription('');
          Alert.alert('Submitted', 'Expense claim sent for approval.');
        },
      }
    );
  };

  const totalPending = (expenses ?? [])
    .filter((e) => e.status === 'Pending')
    .reduce((sum, e) => sum + e.amount, 0);

  const totalApproved = (expenses ?? [])
    .filter((e) => e.status === 'Approved')
    .reduce((sum, e) => sum + e.amount, 0);

  const renderExpense = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.categoryBadge}>
          <ThemedText variant="micro" color="primary">
            {item.category}
          </ThemedText>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) }]}>
          <ThemedText variant="micro" color="primary">
            {item.status}
          </ThemedText>
        </View>
      </View>

      <ThemedText variant="body" color="primary" style={styles.desc}>
        {item.description}
      </ThemedText>

      <View style={styles.cardFooter}>
        <ThemedText variant="subtitle" color="primary">
          {'\u20B9'}{item.amount.toFixed(2)}
        </ThemedText>
        <ThemedText variant="small" color="muted">
          {new Date(item.created_at).toLocaleDateString('en-IN')}
        </ThemedText>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText variant="header" color="primary">
          Expenses
        </ThemedText>
        <TouchableOpacity onPress={() => setShowForm(!showForm)}>
          <ThemedText variant="body" color="accent">
            {showForm ? 'Cancel' : '+ New Claim'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Summary */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <ThemedText variant="small" color="subtitle">
            Pending
          </ThemedText>
          <ThemedText variant="subtitle" color="primary">
            {'\u20B9'}{totalPending.toFixed(0)}
          </ThemedText>
        </View>
        <View style={styles.summaryItem}>
          <ThemedText variant="small" color="subtitle">
            Approved
          </ThemedText>
          <ThemedText variant="subtitle" color="primary">
            {'\u20B9'}{totalApproved.toFixed(0)}
          </ThemedText>
        </View>
      </View>

      {/* New Claim Form */}
      {showForm && (
        <View style={styles.form}>
          <ThemedText variant="subtitle" color="primary" style={styles.formTitle}>
            New Expense Claim
          </ThemedText>

          {/* Category Picker */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.catRow}
            contentContainerStyle={styles.catRowContent}
          >
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.catChip, category === cat && styles.catChipActive]}
                onPress={() => setCategory(cat)}
              >
                <ThemedText
                  variant="small"
                  color={category === cat ? 'primary' : 'subtitle'}
                >
                  {cat}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TextInput
            style={styles.input}
            placeholder="Amount (INR)"
            placeholderTextColor={Theme.colors.text.muted}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
          />

          <TextInput
            style={[styles.input, styles.descInput]}
            placeholder="Description"
            placeholderTextColor={Theme.colors.text.muted}
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <ThemedButton
            title="Submit Claim"
            variant="primary"
            onPress={handleSubmit}
            loading={submitExpense.isPending}
          />
        </View>
      )}

      {/* Claims List */}
      <FlatList
        data={expenses ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderExpense}
        ListEmptyComponent={
          !isLoading ? <EmptyState message="No expense claims yet" /> : null
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
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: Theme.spacing.md,
    gap: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    alignItems: 'center',
  },
  form: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    marginHorizontal: Theme.spacing.md,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
  },
  formTitle: {
    marginBottom: Theme.spacing.sm,
  },
  catRow: {
    maxHeight: 40,
    marginBottom: Theme.spacing.sm,
  },
  catRowContent: {
    gap: Theme.spacing.sm,
  },
  catChip: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 20,
    backgroundColor: Theme.colors.background.tertiary,
  },
  catChipActive: {
    backgroundColor: Theme.colors.action.primary,
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
  descInput: {
    minHeight: 60,
    textAlignVertical: 'top',
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.xs,
  },
  categoryBadge: {
    backgroundColor: Theme.colors.background.tertiary,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadge: {
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
  },
  desc: {
    marginBottom: Theme.spacing.sm,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Theme.colors.layout.divider,
    paddingTop: Theme.spacing.sm,
  },
});
