/**
 * 1stOne F1 — Staff Expenses Screen
 *
 * Submit and view expense claims.
 * Plain text layout — no cards/boxes. Title centred.
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
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
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
  'Others',
];

const S = Theme.typography.sizes;
const BODY = S.body + 3;
const SMALL = S.small + 3;
const SUBTITLE = S.subtitle + 3;

function statusColor(status: string): string {
  switch (status) {
    case 'Approved': return Theme.colors.status.success;
    case 'Rejected': return Theme.colors.status.error;
    default: return Theme.colors.status.warning;
  }
}

export function StaffExpensesScreen() {
  const navigation = useNavigation<any>();
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory>('Grocery');
  const [dropdownOpen, setDropdownOpen] = useState(false);
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
    <View style={styles.expenseRow}>
      <View style={{ flex: 1 }}>
        <ThemedText variant="body" color="primary" style={styles.rowText}>
          {item.category}  ·  {item.description}
        </ThemedText>
        <ThemedText variant="small" color="muted" style={styles.rowSmall}>
          {new Date(item.created_at).toLocaleDateString('en-IN')}
        </ThemedText>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <ThemedText variant="body" color="primary" style={styles.rowText}>
          ₹{item.amount.toFixed(0)}
        </ThemedText>
        <ThemedText variant="small" style={[styles.rowSmall, { color: statusColor(item.status) }]}>
          {item.status}
        </ThemedText>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          My Expenses
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {/* Summary rows */}
      <View style={styles.summarySection}>
        <View style={styles.summaryRow}>
          <ThemedText variant="body" color="subtitle" style={styles.rowText}>Pending</ThemedText>
          <ThemedText variant="body" color="primary" style={[styles.rowText, { color: Theme.colors.status.warning }]}>
            ₹{totalPending.toFixed(0)}
          </ThemedText>
        </View>
        <View style={[styles.summaryRow, styles.summaryLast]}>
          <ThemedText variant="body" color="subtitle" style={styles.rowText}>Approved</ThemedText>
          <ThemedText variant="body" color="primary" style={[styles.rowText, { color: Theme.colors.status.success }]}>
            ₹{totalApproved.toFixed(0)}
          </ThemedText>
        </View>
      </View>

      {/* New Claim toggle */}
      <TouchableOpacity
        style={styles.newClaimLink}
        onPress={() => setShowForm(!showForm)}
      >
        <ThemedText variant="body" color="mint" style={styles.rowText}>
          {showForm ? 'Cancel  ×' : 'New Claim  ›'}
        </ThemedText>
      </TouchableOpacity>

      {/* Claim form */}
      {showForm && (
        <ScrollView
          style={styles.formScroll}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* Category dropdown */}
          <TouchableOpacity
            style={styles.dropdownTrigger}
            onPress={() => setDropdownOpen(true)}
          >
            <ThemedText variant="body" color="primary" style={styles.rowText}>{category}</ThemedText>
            <ThemedText variant="body" color="muted" style={styles.rowText}>  ▾</ThemedText>
          </TouchableOpacity>

          <Modal visible={dropdownOpen} transparent animationType="fade" onRequestClose={() => setDropdownOpen(false)}>
            <TouchableWithoutFeedback onPress={() => setDropdownOpen(false)}>
              <View style={styles.dropdownBackdrop} />
            </TouchableWithoutFeedback>
            <View style={styles.dropdownSheet}>
              {CATEGORIES.map((cat, idx) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.dropdownOption, idx < CATEGORIES.length - 1 && styles.dropdownOptionBorder]}
                  onPress={() => { setCategory(cat); setDropdownOpen(false); }}
                >
                  <ThemedText
                    variant="body"
                    color={category === cat ? 'mint' : 'primary'}
                    style={styles.rowText}
                  >
                    {cat}
                  </ThemedText>
                  {category === cat && (
                    <ThemedText variant="body" color="mint" style={styles.rowText}>✓</ThemedText>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </Modal>

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

          <TouchableOpacity
            style={styles.submitLink}
            onPress={handleSubmit}
            disabled={submitExpense.isPending}
          >
            <ThemedText variant="body" color="mint" style={styles.rowText}>
              {submitExpense.isPending ? 'Submitting...' : 'Submit Claim  ›'}
            </ThemedText>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Claims list */}
      {!showForm && (
        <FlatList
          data={expenses ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderExpense}
          ListEmptyComponent={
            !isLoading ? <EmptyState title="No expense claims yet" /> : null
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
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
  },
  back: { fontSize: BODY, minWidth: 60 },
  title: { flex: 1, textAlign: 'center', fontSize: SUBTITLE + 2 },
  headerSpacer: { minWidth: 60 },

  summarySection: {
    paddingHorizontal: Theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  summaryLast: { borderBottomWidth: 0 },

  newClaimLink: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-end',
    marginRight: Theme.spacing.md,
    paddingLeft: 0,
  },

  formScroll: {
    paddingHorizontal: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    marginBottom: Theme.spacing.xs,
  },
  dropdownBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Theme.colors.layout.overlayLight,
  },
  dropdownSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Theme.colors.background.secondary,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: Theme.spacing.xl,
    paddingTop: Theme.spacing.sm,
  },
  dropdownOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  dropdownOptionBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: BODY,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
  },
  descInput: { minHeight: 60, textAlignVertical: 'top' },

  submitLink: {
    alignSelf: 'flex-end',
    paddingVertical: Theme.spacing.sm,
  },

  // Expense rows
  expenseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  list: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },

  rowText: { fontSize: BODY },
  rowSmall: { fontSize: SMALL, marginTop: 2 },
});
