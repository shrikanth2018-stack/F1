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
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { useWalletBalance, useRefreshWallet, useLoyaltyHistory } from '../../hooks/useWallet';
import { formatPriceShort, formatDateShort } from '../../utils/formatters';
import { supabase } from '../../api/supabaseClient';
import { useSupabaseMutation } from '../../api/useSupabaseQuery';
import type { CustomerNavProp } from '../../navigation/types';

export function LoyaltyPointsScreen({ navigation }: { navigation: CustomerNavProp }) {
  const insets = useSafeAreaInsets();
  const { data: wallet } = useWalletBalance();
  const refreshWallet = useRefreshWallet();

  const points = wallet?.loyaltyPoints ?? 0;
  const { data: history = [], isLoading: historyLoading } = useLoyaltyHistory();
  const [redeemInput, setRedeemInput] = useState('');

  const redeem = useSupabaseMutation<number, { wallet_credited: number; loyalty_points_remaining: number }>(
    // RPC not in the generated types — cast (same pattern as the other RPCs).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n) => (supabase as any).rpc('redeem_loyalty_points', { p_points: n }),
    undefined,
    {
      onSuccess: (data) => {
        const res = Array.isArray(data) ? data[0] : data;
        refreshWallet();
        setRedeemInput('');
        Alert.alert(
          'Points Redeemed',
          `${formatPriceShort(res?.wallet_credited ?? 0)} added to your wallet. ${res?.loyalty_points_remaining ?? 0} points left.`,
        );
      },
      onError: (e) => Alert.alert('Could not redeem', e.message),
    },
  );

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

      {/* Points history — earns + redemptions from loyalty_redemptions */}
      <ThemedText variant="subtitle" color="primary" style={styles.txTitle}>
        Points History
      </ThemedText>

      <ScrollView style={styles.txList} showsVerticalScrollIndicator={false}>
        {history.length === 0 ? (
          <EmptyState
            title={historyLoading ? 'Loading…' : 'No points history yet'}
            subtitle={historyLoading ? '' : 'Your earns and redemptions will show here'}
          />
        ) : (
          history.map((tx) => {
            const earned = tx.type === 'earned';
            return (
              <View key={tx.id} style={styles.txRow}>
                <View style={styles.txInfo}>
                  <ThemedText variant="body" color="primary" style={styles.txDesc}>
                    {tx.description ?? (earned ? 'Points earned' : 'Points redeemed')}
                  </ThemedText>
                  <ThemedText variant="small" color="muted">
                    {tx.created_at ? formatDateShort(tx.created_at) : ''}
                  </ThemedText>
                </View>
                <ThemedText
                  variant="body"
                  style={[
                    styles.txPoints,
                    { color: earned ? Theme.colors.status.success : Theme.colors.text.muted },
                  ]}
                >
                  {earned ? '+' : '−'}{tx.points}
                </ThemedText>
              </View>
            );
          })
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
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  txInfo: { flex: 1, marginRight: Theme.spacing.sm },
  txDesc: { marginBottom: 2 },
  txPoints: { fontFamily: Theme.typography.fontFamily },
});
