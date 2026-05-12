/**
 * 1stOne F1 — Hub Order History Detail
 *
 * Read-only detail view for a single order, opened from the History tab
 * on HubDashboardScreen. No status timeline, no Cancel, no Feedback,
 * no Call/Map/Address actions — pure display. Hub op uses this to look
 * up what was in a past order and where it went.
 *
 * RLS scopes the read: hub op can only fetch orders whose
 * customer_addresses.hub_id matches their assigned_hub_id.
 */

import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { ErrorRetry } from '../../components/ErrorRetry';
import { supabase } from '../../api/supabaseClient';
import { formatDateShort, formatPriceShort, formatRelativeTime } from '../../utils/formatters';
import type { CustomerScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export function HubOrderHistoryDetailScreen({ route, navigation }: CustomerScreenProps<'HubOrderHistoryDetail'>) {
  const { orderId } = route.params;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['hub_history_detail', orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items(*),
          customer_addresses(*),
          profiles(full_name, phone_number)
        `)
        .eq('id', orderId)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  if (error) {
    return <ErrorRetry message="Could not load order" onRetry={refetch} />;
  }
  if (isLoading || !data) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">Order</ThemedText>
          <View style={styles.spacer} />
        </View>
        <ActivityIndicator style={{ marginTop: Theme.spacing.xl }} color={Theme.colors.text.mint} />
      </SafeAreaView>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const order: any = data;
  const addr = order.customer_addresses ?? null;
  const cust = order.profiles ?? null;
  const items: any[] = Array.isArray(order.order_items) ? order.order_items : [];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Order #{order.id}</ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Summary */}
        <SectionLabel title="Order" />
        <View style={styles.group}>
          <Row label="Status" value={order.status} />
          <Row label="Type" value={order.order_type === 'essential' ? 'Essentials' : 'Food'} />
          <Row label="Dispatch date" value={order.dispatch_date ? formatDateShort(order.dispatch_date) : '—'} />
          <Row label="Placed" value={order.created_at ? formatRelativeTime(order.created_at) : '—'} />
          <Row label="Delivery method" value={order.delivery_method === 'hub' ? 'Hub' : 'Direct'} last />
        </View>

        <Divider />

        {/* Items */}
        <SectionLabel title="Items" />
        <View style={styles.group}>
          {items.length === 0 ? (
            <ThemedText variant="body" color="muted" style={styles.empty}>No items recorded</ThemedText>
          ) : (
            items.map((it, idx) => (
              <View key={it.id ?? idx} style={[styles.itemRow, idx < items.length - 1 && styles.itemBorder]}>
                <ThemedText variant="body" color="primary" style={{ flex: 1, fontSize: B }}>
                  {it.item_name} ×{it.quantity}
                </ThemedText>
                <ThemedText variant="body" color="subtitle" style={{ fontSize: B }}>
                  {formatPriceShort((it.price_at_time ?? 0) * (it.quantity ?? 1))}
                </ThemedText>
              </View>
            ))
          )}
        </View>

        <Divider />

        {/* Customer (display only) */}
        <SectionLabel title="Customer" />
        <View style={styles.group}>
          <Row label="Name" value={cust?.full_name ?? addr?.full_name ?? '—'} />
          <Row
            label="Phone"
            value={addr?.phone_number ?? cust?.phone_number ?? '—'}
            last
          />
        </View>

        <Divider />

        {/* Delivery (display only) */}
        <SectionLabel title="Delivery address" />
        <View style={styles.group}>
          <ThemedText variant="body" color="primary" style={{ fontSize: B, paddingVertical: Theme.spacing.sm + 2 }}>
            {[addr?.address_line, addr?.landmark, addr?.city, addr?.pincode].filter(Boolean).join(', ') || '—'}
          </ThemedText>
        </View>

        <Divider />

        {/* Totals */}
        <SectionLabel title="Total" />
        <View style={styles.group}>
          <Row label="Subtotal" value={formatPriceShort(Number(order.total_amount) - Number(order.delivery_fee ?? 0) - Number(order.tax_amount ?? 0))} />
          <Row label="Delivery fee" value={formatPriceShort(Number(order.delivery_fee ?? 0))} />
          <Row label="Tax" value={formatPriceShort(Number(order.tax_amount ?? 0))} />
          <Row label="Paid" value={formatPriceShort(order.total_amount)} last />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <ThemedText
      variant="small"
      color="muted"
      style={{ fontSize: S, letterSpacing: 1, paddingHorizontal: Theme.spacing.md, paddingTop: Theme.spacing.md, paddingBottom: Theme.spacing.xs }}
    >
      {title.toUpperCase()}
    </ThemedText>
  );
}

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <ThemedText variant="body" color="muted" style={{ fontSize: B }}>{label}</ThemedText>
      <ThemedText variant="body" color="primary" style={{ fontSize: B, flexShrink: 1, textAlign: 'right' }}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  spacer: { minWidth: 60 },

  scroll: { paddingBottom: Theme.spacing.xl * 2 },

  group: { paddingHorizontal: Theme.spacing.md },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm + 2,
    gap: Theme.spacing.sm,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm + 2,
  },
  itemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  empty: {
    paddingVertical: Theme.spacing.md,
    textAlign: 'center',
  },
});
