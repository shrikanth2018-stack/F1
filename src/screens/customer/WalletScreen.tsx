/**
 * 1stOne F1 — Wallet Screen
 *
 * Presented as a bottom-sheet modal.
 * Layout: Balance → Top-up input → Quick amounts (text) → ADD (green) → Transactions
 * Top-up triggers Razorpay checkout → webhook credits wallet.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RazorpayCheckout from '../../utils/razorpay';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import {
  useWalletBalance,
  useWalletTransactions,
  useWalletTopup,
  useRefreshWallet,
} from '../../hooks/useWallet';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useAuth } from '../../hooks/useAuth';
import { RAZORPAY_KEY_ID } from '../../utils/env';

const QUICK_AMOUNTS = [500, 1000, 2000];

export function WalletScreen({ navigation }: { navigation: any }) {
  const [customAmount, setCustomAmount] = useState('');
  const insets = useSafeAreaInsets();

  const { session } = useAuth();
  const { data: wallet } = useWalletBalance();
  const { data: transactions, isLoading: txLoading } = useWalletTransactions();
  const { data: config } = useStoreConfig();
  const topup = useWalletTopup();
  const refreshWallet = useRefreshWallet();

  const minTopup = config?.min_wallet_topup ?? 100;

  const handleTopup = (amount: number) => {
    if (amount < minTopup) {
      Alert.alert('Minimum', `Minimum top-up is \u20B9${minTopup}`);
      return;
    }
    topup.mutate(amount, {
      onSuccess: async (data) => {
        if (!data) return;
        try {
          const rawPhone = session?.user.phone ?? '';
          const contact = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;
          await Promise.race([
            RazorpayCheckout.open({
              description: '1stOne Wallet Top-up',
              currency: 'INR',
              key: RAZORPAY_KEY_ID,
              amount: Math.round(data.amount * 100),
              order_id: data.razorpay_order_id,
              name: '1stOne',
              prefill: { email: 'customer@1stone.in', contact },
              theme: { color: Theme.colors.action.primary },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 30_000)
            ),
          ]);
        } catch {
          Alert.alert('Payment Cancelled', 'Your top-up was not completed.');
        }
        refreshWallet();
      },
      onError: (err) => Alert.alert('Error', err.message),
    });
  };

  const handleAdd = () => {
    const amt = parseFloat(customAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Error', 'Enter a valid amount');
      return;
    }
    handleTopup(amt);
    setCustomAmount('');
  };

  return (
    <View style={[styles.card, { paddingBottom: insets.bottom || Theme.spacing.lg }]}>
      {/* Drag handle */}
      <View style={styles.handle} />

      {/* Header row */}
      <View style={styles.header}>
        <ThemedText variant="header" color="primary">Wallet</ThemedText>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="muted">Close</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Balance — prominent, centred */}
      <View style={styles.balanceSection}>
        <ThemedText variant="title" color="primary" style={styles.balanceAmount}>
          {'\u20B9'}{(wallet?.balance ?? 0).toLocaleString('en-IN')}
        </ThemedText>
        <ThemedText variant="small" color="subtitle">Available Balance</ThemedText>
        {(wallet?.loyaltyPoints ?? 0) > 0 && (
          <ThemedText variant="small" color="muted" style={styles.loyaltyText}>
            {wallet?.loyaltyPoints} loyalty points
          </ThemedText>
        )}
      </View>

      <Divider />

      {/* Top-up section */}
      <View style={styles.topupSection}>
        <ThemedText variant="subtitle" color="primary" style={styles.topupTitle}>Top Up</ThemedText>

        {/* Custom input */}
        <TextInput
          style={styles.input}
          placeholder={`Enter amount (min \u20B9${minTopup})`}
          placeholderTextColor={Theme.colors.text.muted}
          value={customAmount}
          onChangeText={setCustomAmount}
          keyboardType="numeric"
        />

        {/* Predefined amounts — centred */}
        <View style={styles.quickRow}>
          {QUICK_AMOUNTS.map((amt) => (
            <TouchableOpacity
              key={amt}
              onPress={() => setCustomAmount(amt.toString())}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <ThemedText variant="body" color="accent">{'\u20B9'}{amt}</ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        {/* ADD right-aligned */}
        <TouchableOpacity
          onPress={handleAdd}
          disabled={topup.isPending}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.addBtn}
        >
          <ThemedText variant="body" style={styles.addText}>
            {topup.isPending ? 'Adding…' : 'ADD'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      <Divider />

      {/* Transactions */}
      <ThemedText variant="subtitle" color="primary" style={styles.txTitle}>
        Recent Transactions
      </ThemedText>

      <ScrollView style={styles.txList} showsVerticalScrollIndicator={false}>
        {(transactions ?? []).length === 0 ? (
          <EmptyState title="No transactions yet" />
        ) : (
          (transactions ?? []).map((tx) => (
            <View key={tx.id} style={styles.txRow}>
              <View style={styles.txInfo}>
                <ThemedText variant="body" color="primary">{tx.description}</ThemedText>
                <ThemedText variant="small" color="muted">
                  {new Date(tx.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </ThemedText>
              </View>
              <ThemedText
                variant="subtitle"
                style={{
                  color: tx.transaction_type === 'credit'
                    ? Theme.colors.status.success
                    : Theme.colors.status.error,
                }}
              >
                {tx.transaction_type === 'credit' ? '+' : '-'}{'\u20B9'}{Math.abs(tx.amount)}
              </ThemedText>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Theme.colors.background.secondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: 60,          // leaves a sliver of the screen behind visible
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Theme.colors.layout.divider,
    alignSelf: 'center',
    marginTop: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  balanceSection: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.lg,
  },
  balanceAmount: {
    fontSize: 40,
    marginBottom: Theme.spacing.xs,
  },
  loyaltyText: {
    marginTop: Theme.spacing.xs,
  },
  topupSection: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  topupTitle: {
    marginBottom: Theme.spacing.sm,
  },
  input: {
    backgroundColor: Theme.colors.background.input,
    borderRadius: Theme.components.inputRadius,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    marginBottom: Theme.spacing.sm,
  },
  quickRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
  },
  addBtn: {
    alignSelf: 'flex-end',
  },
  addText: {
    color: Theme.colors.status.success,
  },
  txTitle: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xs,
    textAlign: 'center',
  },
  txList: {
    flex: 1,
    paddingHorizontal: Theme.spacing.md,
  },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  txInfo: {
    flex: 1,
    marginRight: Theme.spacing.sm,
  },
});
