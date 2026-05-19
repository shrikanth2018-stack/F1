/**
 * 1stOne F1 — Loyalty Points Screen
 *
 * Popup modal showing the loyalty points balance and redemption.
 * D1: points redeem to wallet credit at 1 point = ₹1 via the atomic
 * redeem_loyalty_points RPC. The credited wallet balance is then
 * spendable on any future order.
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
import { useMutation } from '@tanstack/react-query';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { useWalletBalance, useRefreshWallet } from '../../hooks/useWallet';
import { formatPriceShort } from '../../utils/formatters';
import { supabase } from '../../api/supabaseClient';
import type { CustomerNavProp } from '../../navigation/types';

export function LoyaltyPointsScreen({ navigation }: { navigation: CustomerNavProp }) {
  const insets = useSafeAreaInsets();
  const { data: wallet } = useWalletBalance();
  const refreshWallet = useRefreshWallet();

  const points = wallet?.loyaltyPoints ?? 0;
  const [redeemInput, setRedeemInput] = useState('');

  const redeem = useMutation({
    mutationFn: async (n: number) => {
      // RPC not in generated types — cast (same pattern as the other RPCs).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('redeem_loyalty_points', { p_points: n });
      if (error) throw new Error(error.message);
      return data as { wallet_credited: number; loyalty_points_remaining: number };
    },
    onSuccess: (res) => {
      refreshWallet();
      setRedeemInput('');
      Alert.alert(
        'Points Redeemed',
        `${formatPriceShort(res.wallet_credited)} added to your wallet. ${res.loyalty_points_remaining} points left.`,
      );
    },
    onError: (e: Error) => Alert.alert('Could not redeem', e.message),
  });

  const handleRedeem = () => {
    const n = parseInt(redeemInput, 10);
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert('Enter points', 'Enter how many points to redeem.');
      return;
    }
    if (n > points) {
      Alert.alert('Not enough points', `You have ${points} points.`);
      return;
    }
    redeem.mutate(n);
  };

  return (
    <View style={[styles.card, { paddingBottom: insets.bottom || Theme.spacing.lg }]}>
      {/* Drag handle */}
      <View style={styles.handle} />

      {/* Header */}
      <View style={styles.header}>
        <ThemedText variant="header" color="primary">My Loyalty Points</ThemedText>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ThemedText variant="body" color="muted">Close</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Points balance — prominent, centred */}
      <View style={styles.balanceSection}>
        <ThemedText variant="title" color="mint" style={styles.pointsAmount}>
          {points.toLocaleString('en-IN')}
        </ThemedText>
        <ThemedText variant="small" color="subtitle">Available Points</ThemedText>
      </View>

      <Divider />

      {/* Redeem — points → wallet credit at 1 point = ₹1 */}
      <View style={styles.redeemSection}>
        <ThemedText variant="subtitle" color="primary" style={styles.redeemTitle}>
          Redeem to Wallet
        </ThemedText>
        <ThemedText variant="small" color="muted" style={styles.redeemHint}>
          1 point = ₹1 wallet credit · use it on any future order
        </ThemedText>

        {points > 0 ? (
          <>
            <View style={styles.redeemRow}>
              <TextInput
                style={styles.input}
                placeholder={`Points to redeem (max ${points})`}
                placeholderTextColor={Theme.colors.text.muted}
                value={redeemInput}
                onChangeText={setRedeemInput}
                keyboardType="numeric"
              />
              <TouchableOpacity
                onPress={handleRedeem}
                disabled={redeem.isPending}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <ThemedText variant="body" style={styles.redeemBtn}>
                  {redeem.isPending ? 'Redeeming…' : 'Redeem'}
                </ThemedText>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => setRedeemInput(String(points))}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <ThemedText variant="small" color="accent" style={styles.redeemAll}>
                Redeem all {points} →
              </ThemedText>
            </TouchableOpacity>
          </>
        ) : (
          <ThemedText variant="small" color="muted" style={styles.redeemHint}>
            Earn points by placing orders, then redeem them here.
          </ThemedText>
        )}
      </View>

      <Divider />

      {/* Transactions */}
      <ThemedText variant="subtitle" color="primary" style={styles.txTitle}>
        Points History
      </ThemedText>

      <ScrollView style={styles.txList} showsVerticalScrollIndicator={false}>
        <EmptyState
          title="No points history yet"
          subtitle="Earn points by placing orders"
        />
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
    marginTop: 60,
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
  pointsAmount: {
    fontSize: 40,
    marginBottom: Theme.spacing.xs,
  },
  redeemSection: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  redeemTitle: {
    marginBottom: 2,
  },
  redeemHint: {
    marginBottom: Theme.spacing.sm,
  },
  redeemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.md,
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    paddingHorizontal: Theme.spacing.md,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
  },
  redeemBtn: {
    color: Theme.colors.status.success,
  },
  redeemAll: {
    alignSelf: 'flex-end',
    marginTop: Theme.spacing.xs,
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
});
