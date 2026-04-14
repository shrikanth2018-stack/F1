/**
 * 1stOne F1 — Loyalty Points Screen
 *
 * Popup modal showing loyalty points balance, dummy redeem toggle,
 * and points transaction history (logic added later).
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { useWalletBalance } from '../../hooks/useWallet';

export function LoyaltyPointsScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const { data: wallet } = useWalletBalance();
  const [redeemEnabled, setRedeemEnabled] = useState(false);

  const points = wallet?.loyaltyPoints ?? 0;

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

      {/* Redeem toggle — dummy for now */}
      <View style={styles.redeemRow}>
        <View style={styles.redeemInfo}>
          <ThemedText variant="body" color="primary">Redeem on next order</ThemedText>
          <ThemedText variant="small" color="muted">
            Apply points as discount at checkout
          </ThemedText>
        </View>
        <Switch
          value={redeemEnabled}
          onValueChange={setRedeemEnabled}
          trackColor={{
            false: Theme.colors.background.tertiary,
            true: Theme.colors.status.success,
          }}
          thumbColor={Theme.colors.text.primary}
        />
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
  redeemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
  },
  redeemInfo: {
    flex: 1,
    marginRight: Theme.spacing.md,
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
