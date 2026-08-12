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
  Platform,
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
import { invokeFunction } from '../../api/invokeFunction';
import { trackWalletTopUp } from '../../utils/analytics';
import { RAZORPAY_KEY_ID } from '../../utils/env';
import { formatPriceShort } from '../../utils/formatters';
import { infoDialog } from '../../utils/confirmDialog';
import type { CustomerNavProp } from '../../navigation/types';

const QUICK_AMOUNTS = [500, 1000, 2000];

export function WalletScreen({ navigation }: { navigation: CustomerNavProp }) {
  const [customAmount, setCustomAmount] = useState('');
  const insets = useSafeAreaInsets();

  const { session } = useAuth();
  const { data: wallet } = useWalletBalance();
  const { data: transactions } = useWalletTransactions();
  const { data: config } = useStoreConfig();
  const topup = useWalletTopup();
  const refreshWallet = useRefreshWallet();

  const minTopup = config?.min_wallet_topup ?? 100;
  const maxTopup = config?.max_wallet_topup ?? 50000;

  const handleTopup = (amount: number) => {
    if (Platform.OS === 'web') {
      void infoDialog(
        'Mobile App Required',
        'Wallet top-up uses online payment which is only available on the 1stOne mobile app. Please open the app on your phone to add money.',
      );
      return;
    }
    if (amount < minTopup) {
      infoDialog('Minimum', `Minimum top-up is ${formatPriceShort(minTopup)}`);
      return;
    }
    if (amount > maxTopup) {
      infoDialog('Maximum', `Maximum top-up is ${formatPriceShort(maxTopup)}`);
      return;
    }
    topup.mutate(amount, {
      onSuccess: async (data) => {
        if (!data) return;
        const rawPhone = session?.user.phone ?? '';
        const contact = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;

        let rzpResult: any;
        try {
          rzpResult = await RazorpayCheckout.open({
            description: '1stOne Wallet Top-up',
            currency: 'INR',
            key: RAZORPAY_KEY_ID,
            amount: Math.round(data.amount * 100),
            order_id: data.razorpay_order_id,
            name: '1stOne',
            prefill: { contact },
            theme: { color: Theme.colors.action.primary },
          });
        } catch {
          infoDialog('Payment Cancelled', 'Your top-up was not completed.');
          return;
        }

        // Confirm payment server-side (HMAC verify + credit wallet via service role).
        // verify-payment webhook is the fallback; whichever fires first wins.
        try {
          const confirmData = await invokeFunction<{ status?: string; amount?: number }>(
            'confirm-topup',
            {
              razorpay_order_id: data.razorpay_order_id,
              razorpay_payment_id: rzpResult?.razorpay_payment_id,
              razorpay_signature: rzpResult?.razorpay_signature,
            },
          );
          if (confirmData?.status === 'credited') {
            trackWalletTopUp(confirmData.amount ?? amount);
            infoDialog('Wallet Topped Up!', `${formatPriceShort(confirmData.amount ?? 0)} has been added to your wallet.`);
          }
        } catch {
          // Webhook will resolve — silent fail is intentional.
        }

        refreshWallet();
      },
      onError: (err) => infoDialog('Error', err.message),
    });
  };

  const handleAdd = () => {
    const amt = parseFloat(customAmount);
    if (!amt || amt <= 0) {
      infoDialog('Enter an amount', 'Please enter a top-up amount.');
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
        <ThemedText variant="header" color="primary">My Wallet</ThemedText>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="muted">Close</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Balance — prominent, centred */}
      <View style={styles.balanceSection}>
        <ThemedText variant="title" color="primary" style={styles.balanceAmount}>
          {formatPriceShort(wallet?.balance ?? 0)}
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
          placeholder={`Enter amount (min ${formatPriceShort(minTopup)})`}
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
              <ThemedText variant="body" color="accent">{formatPriceShort(amt)}</ThemedText>
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
          (transactions ?? []).map((tx, idx) => (
            <React.Fragment key={tx.id}>
              {idx > 0 && <View style={styles.txSep} />}
              <View style={styles.txRow}>
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
                  style={[styles.txAmount, {
                    color: tx.transaction_type === 'credit'
                      ? Theme.colors.status.success
                      : Theme.colors.status.error,
                  }]}
                >
                  {tx.transaction_type === 'credit' ? '+' : '-'}{formatPriceShort(Math.abs(tx.amount))}
                </ThemedText>
              </View>
            </React.Fragment>
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
    fontSize: Theme.typography.sizes.display,
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
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    backgroundColor: Theme.colors.background.secondary,
    paddingHorizontal: Theme.spacing.md,
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
  },
  txSep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
  },
  txAmount: {
    fontSize: Theme.typography.sizes.subtitle + 2,
  },
  txInfo: {
    flex: 1,
    marginRight: Theme.spacing.sm,
  },
});
