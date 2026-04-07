/**
 * 1stOne F1 — Wallet Screen
 *
 * Balance display, quick top-up amounts, transaction history.
 * Top-up triggers Razorpay checkout → webhook credits wallet.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
  StyleSheet,
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { EmptyState } from '../../components/EmptyState';
import { Divider } from '../../components/Divider';
import {
  useWalletBalance,
  useWalletTransactions,
  useWalletTopup,
  useRefreshWallet,
} from '../../hooks/useWallet';
import { useStoreConfig } from '../../hooks/useStoreConfig';

const QUICK_AMOUNTS = [100, 200, 500, 1000];

export function WalletScreen({ navigation }: { navigation: any }) {
  const [customAmount, setCustomAmount] = useState('');
  const { data: wallet, isLoading: balLoading } = useWalletBalance();
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
      onSuccess: (data) => {
        // In real implementation, open Razorpay checkout with data.razorpay_order_id
        // For now, show the order ID and refresh after
        Alert.alert(
          'Razorpay Checkout',
          `Order created: ${data.razorpay_order_id}\nAmount: \u20B9${data.amount}\n\nRazorpay native checkout will open here.`,
          [
            {
              text: 'Done',
              onPress: () => refreshWallet(),
            },
          ]
        );
      },
      onError: (err) => {
        Alert.alert('Error', err.message);
      },
    });
  };

  const handleCustomTopup = () => {
    const amt = parseFloat(customAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Error', 'Enter a valid amount');
      return;
    }
    handleTopup(amt);
    setCustomAmount('');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">{'< Back'}</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Wallet</ThemedText>
        <View style={{ width: 50 }} />
      </View>

      {/* Balance Card */}
      <View style={styles.balanceCard}>
        <ThemedText variant="small" color="subtitle">Available Balance</ThemedText>
        <ThemedText variant="title" color="primary" style={styles.balance}>
          {'\u20B9'}{(wallet?.balance ?? 0).toLocaleString('en-IN')}
        </ThemedText>
        {(wallet?.loyaltyPoints ?? 0) > 0 && (
          <ThemedText variant="small" color="muted">
            {wallet?.loyaltyPoints} loyalty points
          </ThemedText>
        )}
      </View>

      {/* Quick Top-up */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Top Up
        </ThemedText>

        <View style={styles.quickRow}>
          {QUICK_AMOUNTS.map((amt) => (
            <TouchableOpacity
              key={amt}
              style={styles.quickBtn}
              onPress={() => handleTopup(amt)}
            >
              <ThemedText variant="body" color="primary">
                {'\u20B9'}{amt}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.customRow}>
          <TextInput
            style={styles.input}
            placeholder={`Custom (min \u20B9${minTopup})`}
            placeholderTextColor={Theme.colors.text.muted}
            value={customAmount}
            onChangeText={setCustomAmount}
            keyboardType="numeric"
          />
          <ThemedButton
            title="Add"
            variant="primary"
            onPress={handleCustomTopup}
            loading={topup.isPending}
          />
        </View>
      </View>

      <Divider />

      {/* Transaction History */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Recent Transactions
        </ThemedText>

        {(transactions ?? []).length === 0 ? (
          <EmptyState message="No transactions yet" />
        ) : (
          (transactions ?? []).map((tx) => (
            <View key={tx.id} style={styles.txRow}>
              <View style={styles.txInfo}>
                <ThemedText variant="body" color="primary">
                  {tx.description}
                </ThemedText>
                <ThemedText variant="small" color="muted">
                  {new Date(tx.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </ThemedText>
              </View>
              <ThemedText
                variant="subtitle"
                color="primary"
                style={{
                  color:
                    tx.transaction_type === 'credit'
                      ? Theme.colors.status.success
                      : Theme.colors.status.error,
                }}
              >
                {tx.transaction_type === 'credit' ? '+' : '-'}{'\u20B9'}{Math.abs(tx.amount)}
              </ThemedText>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { padding: Theme.spacing.md, paddingTop: Theme.spacing.xl + Theme.spacing.md, paddingBottom: Theme.spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Theme.spacing.md },
  balanceCard: { backgroundColor: Theme.colors.background.secondary, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.lg, alignItems: 'center', marginBottom: Theme.spacing.md },
  balance: { marginVertical: Theme.spacing.xs },
  section: { marginBottom: Theme.spacing.md },
  sectionTitle: { marginBottom: Theme.spacing.sm },
  quickRow: { flexDirection: 'row', gap: Theme.spacing.sm, marginBottom: Theme.spacing.sm },
  quickBtn: { flex: 1, backgroundColor: Theme.colors.background.tertiary, borderRadius: Theme.components.inputRadius, paddingVertical: Theme.spacing.md, alignItems: 'center' },
  customRow: { flexDirection: 'row', gap: Theme.spacing.sm },
  input: { flex: 1, backgroundColor: Theme.colors.background.input, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.sm, color: Theme.colors.text.primary, fontFamily: Theme.typography.fontFamily, fontSize: Theme.typography.sizes.body },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: Theme.colors.layout.divider },
  txInfo: { flex: 1, marginRight: Theme.spacing.sm },
});
