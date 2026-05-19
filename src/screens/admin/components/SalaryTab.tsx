/**
 * 1stOne F1 — EmployeeDetail · Salary tab
 *
 * Monthly salary cards with mark-paid + an inline add-record form.
 * Extracted from EmployeeDetailScreen (audit D22).
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { EmptyState } from '../../../components/EmptyState';
import { useEmployeeSalary } from '../../../hooks/useResourceManager';
import { formatDate, tab, MONTH_NAMES } from './employeeShared';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export function SalaryTab({ staffId }: { staffId: string }) {
  const { data: records = [], isLoading, markPaid, addRecord } = useEmployeeSalary(staffId);
  const [showAdd, setShowAdd]   = useState(false);
  const [base, setBase]         = useState('');
  const [deductions, setDed]    = useState('0');
  const [bonus, setBonus]       = useState('0');
  const now = new Date();
  const [addMonth, setAddMonth] = useState(String(now.getMonth() + 1));
  const [addYear, setAddYear]   = useState(String(now.getFullYear()));

  const handleAdd = () => {
    const b = parseFloat(base);
    const d = parseFloat(deductions);
    const bn = parseFloat(bonus);
    if (isNaN(b) || b <= 0) { Alert.alert('', 'Enter a valid base salary'); return; }
    addRecord.mutate(
      {
        month: parseInt(addMonth, 10),
        year:  parseInt(addYear, 10),
        base_salary: b,
        deductions: isNaN(d) ? 0 : d,
        bonus: isNaN(bn) ? 0 : bn,
      },
      {
        onSuccess: () => { setShowAdd(false); setBase(''); setDed('0'); setBonus('0'); },
        onError:   (e: any) => Alert.alert('Error', e?.message),
      }
    );
  };

  if (isLoading) {
    return <ActivityIndicator color={Theme.colors.text.mint} style={{ marginTop: Theme.spacing.xl }} />;
  }

  return (
    <ScrollView contentContainerStyle={tab.scroll} showsVerticalScrollIndicator={false}>
      {records.length === 0 ? (
        <EmptyState title="No salary records yet" />
      ) : (
        records.map((r) => (
          <View key={r.id} style={sal.card}>
            <View style={sal.cardHeader}>
              <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                {MONTH_NAMES[r.month - 1]} {r.year}
              </ThemedText>
              <View style={[sal.badge, r.is_paid ? sal.paidBadge : sal.pendingBadge]}>
                <ThemedText
                  variant="small"
                  color="primary"
                  style={{ fontSize: S, color: r.is_paid ? Theme.colors.status.success : Theme.colors.status.warning }}
                >
                  {r.is_paid ? 'Paid' : 'Pending'}
                </ThemedText>
              </View>
            </View>
            <View style={sal.lineRow}>
              <ThemedText variant="small" color="muted" style={{ fontSize: S }}>Base</ThemedText>
              <ThemedText variant="small" color="primary" style={{ fontSize: S }}>₹{r.base_salary.toLocaleString('en-IN')}</ThemedText>
            </View>
            {r.deductions > 0 && (
              <View style={sal.lineRow}>
                <ThemedText variant="small" color="muted" style={{ fontSize: S }}>Deductions</ThemedText>
                <ThemedText variant="small" color="primary" style={{ fontSize: S, color: Theme.colors.status.error }}>– ₹{r.deductions.toLocaleString('en-IN')}</ThemedText>
              </View>
            )}
            {r.bonus > 0 && (
              <View style={sal.lineRow}>
                <ThemedText variant="small" color="muted" style={{ fontSize: S }}>Bonus</ThemedText>
                <ThemedText variant="small" color="mint" style={{ fontSize: S }}>+ ₹{r.bonus.toLocaleString('en-IN')}</ThemedText>
              </View>
            )}
            <View style={[sal.lineRow, sal.netRow]}>
              <ThemedText variant="body" color="primary" style={{ fontSize: B }}>Net</ThemedText>
              <ThemedText variant="body" color="primary" style={{ fontSize: B }}>₹{r.net_salary.toLocaleString('en-IN')}</ThemedText>
            </View>
            {!r.is_paid && (
              <TouchableOpacity
                onPress={() =>
                  Alert.alert('Mark Paid', `Mark ₹${r.net_salary.toLocaleString('en-IN')} as paid?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Mark Paid', onPress: () => markPaid.mutate(r.id) },
                  ])
                }
                disabled={markPaid.isPending}
                activeOpacity={0.7}
              >
                <ThemedText variant="body" color="mint" style={sal.markPaid}>
                  {markPaid.isPending ? 'Saving…' : 'Mark Paid  ›'}
                </ThemedText>
              </TouchableOpacity>
            )}
            {r.is_paid && !!r.paid_at && (
              <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 4 }}>
                Paid on {formatDate(r.paid_at)}
              </ThemedText>
            )}
          </View>
        ))
      )}

      {/* Add month record */}
      {showAdd ? (
        <View style={sal.addForm}>
          <ThemedText variant="small" color="muted" style={tab.sectionLabel}>ADD SALARY RECORD</ThemedText>
          {[
            { label: 'Month (1–12)', val: addMonth, set: setAddMonth },
            { label: 'Year',         val: addYear,  set: setAddYear  },
            { label: 'Base salary ₹', val: base,   set: setBase      },
            { label: 'Deductions ₹', val: deductions, set: setDed    },
            { label: 'Bonus ₹',      val: bonus,   set: setBonus     },
          ].map((f) => (
            <View key={f.label} style={ef.row}>
              <ThemedText variant="small" color="muted" style={ef.label}>{f.label}</ThemedText>
              <TextInput
                style={ef.input}
                value={f.val}
                onChangeText={f.set}
                keyboardType="numeric"
                returnKeyType="done"
                placeholderTextColor={Theme.colors.text.muted}
              />
            </View>
          ))}
          <View style={sal.addBtns}>
            <TouchableOpacity onPress={() => setShowAdd(false)}>
              <ThemedText variant="body" color="muted" style={{ fontSize: B }}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleAdd} disabled={addRecord.isPending} activeOpacity={0.7}>
              <ThemedText variant="body" color="mint" style={{ fontSize: B }}>
                {addRecord.isPending ? 'Saving…' : 'Save  ›'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={sal.addBtn}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.7}
        >
          <ThemedText variant="body" color="accent" style={{ fontSize: B }}>+ Add Month Record</ThemedText>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// "Add salary record" form fields
const ef = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    paddingVertical: Theme.spacing.sm + 2,
  },
  label: { fontSize: S, letterSpacing: 0.5, marginBottom: 4 },
  input: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    color: Theme.colors.text.primary,
  },
});

const sal = StyleSheet.create({
  card: {
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 10,
    padding: Theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  paidBadge:    { backgroundColor: Theme.colors.status.success + '22' },
  pendingBadge: { backgroundColor: Theme.colors.status.warning + '22' },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  netRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
    marginTop: 4,
    paddingTop: 6,
  },
  markPaid:  { fontSize: B, marginTop: Theme.spacing.sm, textAlign: 'right' },
  addForm:   { paddingHorizontal: Theme.spacing.md },
  addBtns:   {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.md,
  },
  addBtn: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
  },
});
