import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { Theme } from '../theme';
import { formatPriceShort } from '../utils/formatters';
import type { Order } from '../types';

interface Props {
  order: Order;
  onViewOrder: () => void;
  onDismiss?: () => void;
}

export function PendingPaymentBanner({ order, onViewOrder, onDismiss }: Props) {
  return (
    <View style={styles.banner}>
      <View style={styles.left}>
        <ThemedText variant="small" style={styles.title}>
          Payment confirming…
        </ThemedText>
        <ThemedText variant="micro" color="muted">
          Order #{order.id} · {formatPriceShort(order.total_amount)} — awaiting bank confirmation
        </ThemedText>
      </View>
      <TouchableOpacity onPress={onViewOrder} style={styles.btn} activeOpacity={0.7}>
        <ThemedText variant="small" color="mint">View ›</ThemedText>
      </TouchableOpacity>
      {onDismiss && (
        <TouchableOpacity onPress={onDismiss} style={styles.dismiss} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="small" color="muted">✕</ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.status.warning + '20',
    borderLeftWidth: 3,
    borderLeftColor: Theme.colors.status.warning,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    marginHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
    borderRadius: 6,
  },
  left: { flex: 1 },
  title: { color: Theme.colors.status.warning, fontWeight: '600', marginBottom: 2 },
  btn: { paddingLeft: Theme.spacing.sm },
  dismiss: { paddingLeft: Theme.spacing.sm },
});
