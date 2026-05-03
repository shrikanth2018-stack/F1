/**
 * 1stOne F1 — Admin Running Orders Screen
 *
 * Single canonical admin view of orders for a given date. Each row shows
 * order # · zone-or-hub label · status pill. Tapping a row navigates to
 * AdminOrderDetailScreen for full context + actions (cancel, advance status,
 * call customer, open in Maps).
 *
 * Filter chips at top narrow by status; search box narrows by partial
 * order number. Both compose. Filters are component-lifetime only.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { DispatchBadge } from '../../components/DispatchBadge';
import { supabase } from '../../api/supabaseClient';
import { formatDateShort } from '../../utils/formatters';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info' | 'error'> = {
  Confirmed: 'info', Preparing: 'info', Ready: 'info', Packed: 'info',
  Dispatched: 'warning', 'On the Way': 'warning', Delivered: 'success',
  'Received at Hub': 'info', Cancelled: 'error', Pending: 'warning', Failed: 'error',
};

const STATUS_OPTIONS = [
  'All', 'Confirmed', 'Preparing', 'Ready', 'Packed',
  'Dispatched', 'Received at Hub', 'On the Way', 'Delivered', 'Cancelled',
] as const;
type StatusFilter = typeof STATUS_OPTIONS[number];

function getDateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function useOrdersForDate(date: string) {
  return useQuery({
    queryKey: ['admin_orders_manage', date],
    queryFn: async () => {
      // Row-level data only: id, status, routing label. Customer name,
      // items, payment, and full address load in AdminOrderDetailScreen
      // when admin taps a row.
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, status, delivery_method,
          customer_addresses(
            delivery_hubs(hub_name),
            delivery_zones(zone_name)
          )
        `)
        .eq('dispatch_date', date)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function AdminOrdersScreen({ navigation }: { navigation: AdminNavProp }) {
  const [dateOffset, setDateOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const date = getDateStr(dateOffset);

  const { data: orders, isLoading, error, refetch } = useOrdersForDate(date);

  const filteredOrders = useMemo(() => {
    const all = orders ?? [];
    const term = searchTerm.trim();
    return all.filter((o) => {
      if (statusFilter !== 'All' && o.status !== statusFilter) return false;
      if (term && !String(o.id).includes(term)) return false;
      return true;
    });
  }, [orders, statusFilter, searchTerm]);

  if (error) return <ErrorRetry message="Could not load orders" onRetry={refetch} />;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Running Orders</ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      <View style={styles.dateRow}>
        <TouchableOpacity onPress={() => setDateOffset((d) => d - 1)} style={styles.dateArrow} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}>
          <ThemedText style={styles.arrowText} color="mint">‹</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="body" color="primary" style={styles.dateLabel}>{formatDateShort(date)}</ThemedText>
        <TouchableOpacity onPress={() => setDateOffset((d) => d + 1)} style={styles.dateArrow} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}>
          <ThemedText style={styles.arrowText} color="mint">›</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {STATUS_OPTIONS.map((opt) => {
          const active = statusFilter === opt;
          return (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setStatusFilter(opt)}
              activeOpacity={0.7}
            >
              <ThemedText
                variant="small"
                color={active ? 'mint' : 'muted'}
                style={[styles.chipText, active && styles.chipTextActive]}
              >
                {opt}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Order # search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchTerm}
          onChangeText={setSearchTerm}
          placeholder="Search order #"
          placeholderTextColor={Theme.colors.text.muted}
          keyboardType="numeric"
          returnKeyType="search"
        />
        {searchTerm.length > 0 && (
          <TouchableOpacity onPress={() => setSearchTerm('')} style={styles.searchClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ThemedText variant="body" color="muted">×</ThemedText>
          </TouchableOpacity>
        )}
      </View>

      <Divider />

      {isLoading && (
        <ActivityIndicator color={Theme.colors.action.primary} style={{ marginTop: Theme.spacing.xl }} />
      )}

      <FlatList
        data={filteredOrders}
        keyExtractor={(item: any) => item.id.toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={!isLoading ? <EmptyState title="No orders for this date" /> : null}
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }: { item: any }) => {
          // Routing label: hub takes precedence (more specific). Reads what's
          // actually populated on the address rather than trusting
          // order.delivery_method, which can be null/'direct' even when the
          // customer's address has a hub assigned.
          const addr = item.customer_addresses;
          const routingLabel =
            addr?.delivery_hubs?.hub_name
            || addr?.delivery_zones?.zone_name
            || 'Unassigned';
          const status = item.status ?? '';
          return (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.6}
              onPress={() => navigation.navigate('AdminOrderDetail', { orderId: item.id })}
            >
              <ThemedText variant="body" color="primary" style={styles.rowId}>
                #{item.id}
              </ThemedText>
              <ThemedText
                variant="body"
                color="subtitle"
                numberOfLines={1}
                style={styles.rowRouting}
              >
                {routingLabel}
              </ThemedText>
              <DispatchBadge
                label={status}
                variant={STATUS_VARIANT[status] ?? 'info'}
              />
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
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
  title: { flex: 1, textAlign: 'center' },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
  },
  dateArrow: {
    paddingHorizontal: Theme.spacing.lg,
    paddingVertical: Theme.spacing.sm,
  },
  arrowText: {
    fontSize: 28,
    lineHeight: 32,
  },
  dateLabel: {
    minWidth: 140,
    textAlign: 'center',
  },
  list: { paddingBottom: Theme.spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 4,
    gap: Theme.spacing.sm,
  },
  rowId: { fontSize: B, fontWeight: '600', minWidth: 56 },
  rowRouting: { fontSize: S, flex: 1 },
  txt: { fontSize: B },

  chipRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    gap: Theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },
  chipText: { fontSize: S - 1 },
  chipTextActive: { fontWeight: '600' },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  searchClear: { paddingHorizontal: Theme.spacing.sm },
});
