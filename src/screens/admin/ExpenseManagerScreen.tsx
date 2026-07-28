/**
 * 1stOne F1 — Expense Manager (Admin)
 *
 * Two tabs:
 *
 *  CLAIMS     Staff-submitted expense claims.
 *             Pending   → Approve / Reject
 *             Approved  → Mark Paid
 *             Vendor Payout claims settle in ONE step (Approve & pay): the
 *             money is already the vendor's, held in their wallet, so
 *             approving IS releasing it. Going straight to Paid fires the
 *             wallet debit, clearing their balance immediately.
 *             History   → Paid / Rejected (read-only)
 *
 *  EXPENSES   Admin-logged business spending.
 *             List of recorded entries, unpaid first.
 *             Footer: "Add Expense ›" opens inline form.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import {
  useAllExpenseClaimsAdmin,
  useReviewExpenseClaim,
  useMarkClaimPaid,
  useBusinessExpenses,
  EXPENSE_CATEGORIES,
} from '../../hooks/useExpenseManager';
import { todayIST } from '../../utils/istDate';
import { exportCsv } from '../../utils/exportCsv';
import { getErrorMessage } from '../../utils/formatters';
import type { ExpenseClaim, BusinessExpense } from '../../types';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type MainTab = 'Claims' | 'Expenses';

// ── Helpers ───────────────────────────────────────────────────

function formatDate(str: string | null): string {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function fmtAmt(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

const STATUS_COLOR: Record<string, string> = {
  Pending:  Theme.colors.status.warning,
  Approved: Theme.colors.text.mint,
  Rejected: Theme.colors.status.error,
  Paid:     Theme.colors.text.mint,
};

// ── Claims tab ────────────────────────────────────────────────

function ClaimsTab() {
  const { data: claims = [], isLoading } = useAllExpenseClaimsAdmin();
  const review   = useReviewExpenseClaim();
  const markPaid = useMarkClaimPaid();

  const pending  = useMemo(() => claims.filter((c) => c.status === 'Pending'),  [claims]);
  const approved = useMemo(() => claims.filter((c) => c.status === 'Approved'), [claims]);
  const history  = useMemo(() => claims.filter((c) => c.status === 'Paid' || c.status === 'Rejected'), [claims]);

  // A vendor payout settles in one step: the money is already theirs, sitting
  // in their wallet, and approving it is the act of releasing it. Going
  // straight to Paid fires the wallet debit (trg_vendor_payout_paid), so the
  // vendor's balance clears the moment you approve rather than lingering
  // until someone remembers a second tap. Staff expense claims keep the
  // two-step Approve → Mark Paid flow, where approval and payment really are
  // separate events.
  const isVendorPayout = (claim: ExpenseClaim) => claim.category === 'Vendor Payout';

  const handleReview = (claim: ExpenseClaim & { profiles: any }, status: 'Approved' | 'Rejected') => {
    const name = claim.profiles?.full_name || claim.profiles?.phone_number || 'Staff';
    const payoutNow = status === 'Approved' && isVendorPayout(claim);

    Alert.alert(
      payoutNow ? 'Approve & pay' : status,
      payoutNow
        ? `Release ₹${claim.amount} to ${name}? Their wallet balance clears now — make the transfer separately.`
        : `${status} ₹${claim.amount} claim from ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: payoutNow ? 'Approve & pay' : status,
          style: status === 'Rejected' ? 'destructive' : 'default',
          onPress: () =>
            payoutNow
              ? markPaid.mutate(claim.id, {
                  onError: (e: any) => Alert.alert('Error', e?.message),
                })
              : review.mutate(
                  { claimId: claim.id, status },
                  { onError: (e: any) => Alert.alert('Error', e?.message) }
                ),
        },
      ],
    );
  };

  const handlePaid = (claim: ExpenseClaim & { profiles: any }) => {
    const name = claim.profiles?.full_name || claim.profiles?.phone_number || 'Staff';
    Alert.alert('Mark Paid', `Mark ₹${claim.amount} to ${name} as paid?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Paid',
        onPress: () => markPaid.mutate(
          claim.id,
          { onError: (e: any) => Alert.alert('Error', e?.message) }
        ),
      },
    ]);
  };

  if (isLoading) {
    return <ActivityIndicator color={Theme.colors.text.mint} style={{ marginTop: Theme.spacing.xl }} />;
  }

  return (
    <ScrollView contentContainerStyle={tab.scroll} showsVerticalScrollIndicator={false}>

      {/* Pending */}
      <ThemedText variant="small" color="muted" style={tab.sectionLabel}>
        PENDING  ({pending.length})
      </ThemedText>
      {pending.length === 0 ? (
        <ThemedText variant="body" color="muted" style={tab.empty}>No pending claims</ThemedText>
      ) : (
        pending.map((c) => {
          const name = c.profiles?.full_name || c.profiles?.phone_number || 'Staff';
          const empId = c.profiles?.employee_id ? `  ${c.profiles.employee_id}` : '';
          return (
            <View key={c.id} style={tab.card}>
              <View style={tab.cardTop}>
                <View style={tab.cardLeft}>
                  <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                    {name}{empId}
                  </ThemedText>
                  <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                    {c.category}  ·  {formatDate(c.created_at)}
                  </ThemedText>
                  {!!c.description && (
                    <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                      {c.description}
                    </ThemedText>
                  )}
                </View>
                <ThemedText variant="body" color="primary" style={tab.amount}>{fmtAmt(c.amount)}</ThemedText>
              </View>
              <View style={tab.actionRow}>
                <TouchableOpacity
                  style={tab.approveBtn}
                  onPress={() => handleReview(c, 'Approved')}
                  disabled={review.isPending}
                  activeOpacity={0.7}
                >
                  <ThemedText variant="small" color="primary" style={{ fontSize: S }}>
                    {isVendorPayout(c) ? 'Approve & pay' : 'Approve'}
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={tab.rejectBtn}
                  onPress={() => handleReview(c, 'Rejected')}
                  disabled={review.isPending}
                  activeOpacity={0.7}
                >
                  <ThemedText variant="small" color="primary" style={{ fontSize: S }}>Reject</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}

      <Divider />

      {/* Approved — awaiting payment */}
      <ThemedText variant="small" color="muted" style={tab.sectionLabel}>
        APPROVED — AWAITING PAYMENT  ({approved.length})
      </ThemedText>
      {approved.length === 0 ? (
        <ThemedText variant="body" color="muted" style={tab.empty}>None awaiting payment</ThemedText>
      ) : (
        approved.map((c) => {
          const name = c.profiles?.full_name || c.profiles?.phone_number || 'Staff';
          return (
            <View key={c.id} style={tab.card}>
              <View style={tab.cardTop}>
                <View style={tab.cardLeft}>
                  <ThemedText variant="body" color="primary" style={{ fontSize: B }}>{name}</ThemedText>
                  <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                    {c.category}  ·  {formatDate(c.created_at)}
                  </ThemedText>
                  {!!c.description && (
                    <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                      {c.description}
                    </ThemedText>
                  )}
                </View>
                <ThemedText variant="body" color="primary" style={tab.amount}>{fmtAmt(c.amount)}</ThemedText>
              </View>
              <TouchableOpacity
                onPress={() => handlePaid(c)}
                disabled={markPaid.isPending}
                activeOpacity={0.7}
              >
                <ThemedText variant="small" color="mint" style={tab.paidLink}>
                  {markPaid.isPending ? 'Saving…' : 'Mark Paid  ›'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          );
        })
      )}

      <Divider />

      {/* History */}
      <ThemedText variant="small" color="muted" style={tab.sectionLabel}>
        HISTORY  ({history.length})
      </ThemedText>
      {history.length === 0 ? (
        <ThemedText variant="body" color="muted" style={tab.empty}>No history yet</ThemedText>
      ) : (
        history.map((c) => {
          const name = c.profiles?.full_name || c.profiles?.phone_number || 'Staff';
          return (
            <View key={c.id} style={tab.histRow}>
              <View style={tab.cardLeft}>
                <ThemedText variant="body" color="primary" style={{ fontSize: B }}>{name}</ThemedText>
                <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                  {c.category}  ·  {c.status === 'Paid' ? `Paid ${formatDate(c.paid_at)}` : `Rejected ${formatDate(c.updated_at)}`}
                </ThemedText>
                {!!c.description && (
                  <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                    {c.description}
                  </ThemedText>
                )}
              </View>
              <View style={tab.histRight}>
                <ThemedText variant="body" color="primary" style={{ fontSize: B }}>{fmtAmt(c.amount)}</ThemedText>
                <ThemedText
                  variant="small"
                  color="muted"
                  style={{ fontSize: S, color: STATUS_COLOR[c.status] ?? Theme.colors.text.muted }}
                >
                  {c.status}
                </ThemedText>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

// ── Expenses tab ──────────────────────────────────────────────

function ExpensesTab({ showForm, onCloseForm }: { showForm: boolean; onCloseForm: () => void }) {
  const { data: expenses = [], isLoading, add, markPaid } = useBusinessExpenses();
  const todayIso = todayIST(); // YYYY-MM-DD (storage / DB format)
  // Admin input is DD-MM-YYYY (regional convention); we convert at submit.
  const todayDmy = useMemo(() => {
    const [y, m, d] = todayIso.split('-');
    return `${d}-${m}-${y}`;
  }, [todayIso]);

  // Form state. Business expenses logged here are always already-paid
  // (admin records the spend), so is_paid is fixed true — the per-claim
  // toggle was removed from the UI.
  const [category,    setCategory]  = useState('');
  const [description, setDesc]      = useState('');
  const [amount,      setAmount]    = useState('');
  const [vendor,      setVendor]    = useState('');
  const [date,        setDate]      = useState(todayDmy);

  const resetForm = () => {
    setCategory(''); setDesc(''); setAmount('');
    setVendor(''); setDate(todayDmy);
    onCloseForm();
  };

  const handleAdd = () => {
    if (!category.trim())    { Alert.alert('', 'Select a category'); return; }
    if (!description.trim()) { Alert.alert('', 'Enter a description'); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { Alert.alert('', 'Enter a valid amount'); return; }
    const dmy = date.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!dmy) { Alert.alert('', 'Date must be DD-MM-YYYY'); return; }
    const expenseIso = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

    add.mutate(
      { category: category.trim(), description: description.trim(), amount: amt, expense_date: expenseIso, vendor: vendor.trim(), is_paid: true },
      {
        onSuccess: resetForm,
        onError: (e: any) => Alert.alert('Error', e?.message),
      }
    );
  };

  const handleMarkPaid = (exp: BusinessExpense) =>
    Alert.alert('Mark Paid', `Mark ${exp.description} (${fmtAmt(exp.amount)}) as paid?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark Paid', onPress: () => markPaid.mutate(exp.id) },
    ]);

  const unpaid = expenses.filter((e) => !e.is_paid);
  const paid   = expenses.filter((e) => e.is_paid);

  if (isLoading) {
    return <ActivityIndicator color={Theme.colors.text.mint} style={{ marginTop: Theme.spacing.xl }} />;
  }

  return (
    <ScrollView
      contentContainerStyle={tab.scroll}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Inline add form */}
      {showForm && (
        <View style={ef.container}>
          <ThemedText variant="small" color="muted" style={ef.heading}>ADD EXPENSE</ThemedText>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ef.chipRow}>
            {EXPENSE_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[ef.chip, category === cat && ef.chipActive]}
                onPress={() => setCategory(cat)}
                activeOpacity={0.7}
              >
                <ThemedText
                  variant="small"
                  color={category === cat ? 'primary' : 'muted'}
                  style={[{ fontSize: S }, category === cat && { color: Theme.colors.text.mint }]}
                >
                  {cat}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {[
            { key: 'description', value: description, set: setDesc,   kb: 'default' as const, placeholder: 'Description' },
            { key: 'vendor',      value: vendor,      set: setVendor, kb: 'default' as const, placeholder: 'Vendor / Supplier (optional)' },
            { key: 'amount',      value: amount,      set: setAmount, kb: 'numeric' as const, placeholder: 'Amount  ₹' },
            { key: 'date',        value: date,        set: setDate,   kb: 'default' as const, placeholder: 'Date (DD-MM-YYYY)' },
          ].map((f) => (
            <View key={f.key} style={ef.field}>
              <TextInput
                style={ef.input}
                value={f.value}
                onChangeText={f.set}
                keyboardType={f.kb}
                returnKeyType="next"
                placeholder={f.placeholder}
                placeholderTextColor={Theme.colors.text.muted}
              />
            </View>
          ))}

          <View style={ef.btns}>
            <TouchableOpacity onPress={resetForm}>
              <ThemedText variant="body" color="muted" style={{ fontSize: B }}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleAdd} disabled={add.isPending} activeOpacity={0.7}>
              {add.isPending
                ? <ActivityIndicator color={Theme.colors.text.mint} />
                : <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Save  ›</ThemedText>
              }
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Unpaid */}
      {unpaid.length > 0 && (
        <>
          <ThemedText variant="small" color="muted" style={tab.sectionLabel}>
            UNPAID  ({unpaid.length})
          </ThemedText>
          {unpaid.map((e) => (
            <View key={e.id} style={tab.histRow}>
              <View style={tab.cardLeft}>
                <ThemedText variant="body" color="primary" style={{ fontSize: B }}>{e.description}</ThemedText>
                <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                  {e.category}{e.vendor ? `  ·  ${e.vendor}` : ''}  ·  {formatDate(e.expense_date)}
                </ThemedText>
              </View>
              <View style={tab.histRight}>
                <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                  {fmtAmt(e.amount)}
                </ThemedText>
                <TouchableOpacity onPress={() => handleMarkPaid(e)} activeOpacity={0.7}>
                  <ThemedText variant="small" color="mint" style={{ fontSize: S }}>Mark Paid  ›</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <Divider />
        </>
      )}

      {/* Paid history */}
      <ThemedText variant="small" color="muted" style={tab.sectionLabel}>
        PAID  ({paid.length})
      </ThemedText>
      {expenses.length === 0 ? (
        <EmptyState title="No expenses recorded yet" subtitle="Tap Add Expense to log a spending" />
      ) : paid.length === 0 ? (
        <ThemedText variant="body" color="muted" style={tab.empty}>No paid expenses yet</ThemedText>
      ) : (
        paid.map((e) => (
          <View key={e.id} style={tab.histRow}>
            <View style={tab.cardLeft}>
              <ThemedText variant="body" color="primary" style={{ fontSize: B }}>{e.description}</ThemedText>
              <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                {e.category}{e.vendor ? `  ·  ${e.vendor}` : ''}  ·  {formatDate(e.expense_date)}
              </ThemedText>
            </View>
            <View style={tab.histRight}>
              <ThemedText variant="body" color="muted" style={{ fontSize: B }}>{fmtAmt(e.amount)}</ThemedText>
              <ThemedText variant="small" color="mint" style={{ fontSize: S }}>Paid</ThemedText>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const ef = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingBottom: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  heading: {
    fontSize: S,
    letterSpacing: 1,
    textAlign: 'center',
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: Theme.spacing.md, marginBottom: Theme.spacing.sm },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },
  field: { paddingHorizontal: Theme.spacing.md, marginBottom: Theme.spacing.sm },
  input: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    color: Theme.colors.text.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    paddingVertical: Theme.spacing.xs,
  },
  btns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
  },
});

// ── Shared tab styles ─────────────────────────────────────────
const tab = StyleSheet.create({
  scroll:       { paddingBottom: Theme.spacing.xl * 2 },
  sectionLabel: {
    fontSize: S, letterSpacing: 1,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md, paddingBottom: Theme.spacing.xs,
  },
  empty:    { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.sm, fontSize: B },
  card: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  cardTop:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLeft:  { flex: 1, marginRight: Theme.spacing.sm },
  amount:    { fontSize: B + 2, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: Theme.spacing.sm },
  approveBtn: {
    backgroundColor: Theme.colors.status.success,
    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 6,
  },
  rejectBtn: {
    backgroundColor: Theme.colors.status.error,
    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 6,
  },
  paidLink: { fontSize: S, marginTop: Theme.spacing.sm, textAlign: 'right' },
  histRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  histRight: { alignItems: 'flex-end', gap: 4 },
});

// ── Main screen ───────────────────────────────────────────────
export function ExpenseManagerScreen({ navigation }: { navigation: AdminNavProp }) {
  const [tab, setTab]         = useState<MainTab>('Claims');
  const [showForm, setShowForm] = useState(false);

  const { data: claims = [] } = useAllExpenseClaimsAdmin();
  const { data: businessExpenses = [] } = useBusinessExpenses();
  const pendingCount = useMemo(
    () => claims.filter((c) => c.status === 'Pending').length,
    [claims]
  );

  const handleTabChange = (t: MainTab) => {
    setTab(t);
    setShowForm(false);
  };

  // Export the active tab as a CSV — staff claims, or business expenses.
  const handleExport = async () => {
    try {
      if (tab === 'Claims') {
        if (claims.length === 0) {
          Alert.alert('Nothing to export', 'No expense claims yet.');
          return;
        }
        const rows = claims.map((c) => [
          formatDate(c.created_at),
          c.profiles?.full_name || c.profiles?.phone_number || 'Staff',
          c.profiles?.employee_id ?? '',
          c.category,
          c.description ?? '',
          c.amount,
          c.status,
          c.status === 'Paid' ? formatDate(c.paid_at) : '',
        ]);
        await exportCsv(
          `expense_claims_${todayIST()}.csv`,
          ['Date', 'Staff', 'Employee ID', 'Category', 'Description', 'Amount', 'Status', 'Paid On'],
          rows,
        );
      } else {
        if (businessExpenses.length === 0) {
          Alert.alert('Nothing to export', 'No business expenses yet.');
          return;
        }
        const rows = businessExpenses.map((e) => [
          formatDate(e.expense_date),
          e.category,
          e.description,
          e.vendor ?? '',
          e.amount,
          e.is_paid ? 'Paid' : 'Unpaid',
          e.is_paid ? formatDate(e.paid_at) : '',
        ]);
        await exportCsv(
          `business_expenses_${todayIST()}.csv`,
          ['Date', 'Category', 'Description', 'Vendor', 'Amount', 'Paid', 'Paid On'],
          rows,
        );
      }
    } catch (e) {
      Alert.alert('Download failed', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Expense Manager
        </ThemedText>
        <TouchableOpacity onPress={handleExport} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="mint" style={styles.export}>⬇ CSV</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['Claims', 'Expenses'] as MainTab[]).map((t, i) => (
          <React.Fragment key={t}>
            {i > 0 && <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>}
            <TouchableOpacity onPress={() => handleTabChange(t)}>
              <ThemedText
                variant="body"
                color={tab === t ? 'primary' : 'muted'}
                style={[styles.tabTxt, tab === t && styles.tabActive]}
              >
                {t === 'Claims' && pendingCount > 0 ? `Claims  (${pendingCount})` : t}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      <Divider />

      {/* Tab content */}
      {tab === 'Claims' && <ClaimsTab />}
      {tab === 'Expenses' && (
        <ExpensesTab showForm={showForm} onCloseForm={() => setShowForm(false)} />
      )}

      {/* Footer — Add Expense (Expenses tab only) */}
      {tab === 'Expenses' && !showForm && (
        <TouchableOpacity
          style={styles.footer}
          onPress={() => setShowForm(true)}
          activeOpacity={0.7}
        >
          <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Add Expense  ›</ThemedText>
        </TouchableOpacity>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back:   { fontSize: B, minWidth: 60 },
  title:  { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },
  export: { minWidth: 60, textAlign: 'right' },

  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  pipe:      { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  tabTxt:    { fontSize: B },
  tabActive: {  },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
});
