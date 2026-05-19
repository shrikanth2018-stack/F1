/**
 * 1stOne F1 — Driver Dashboard
 *
 * Shows today's deliveries assigned to this driver. Driver is identified
 * by membership in delivery_hubs.driver_user_id and/or delivery_zones.driver_user_id.
 *
 * Per-row actions: status advance (Dispatched → Received at Hub if hub
 * order → On the Way → Delivered), call customer, open in maps with
 * directions, show full address.
 */

import React from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { getErrorMessage } from '../../utils/formatters';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { DeliveryOrderRow } from '../../components/DeliveryOrderRow';
import { useAuth } from '../../hooks/useAuth';
import { useUpdateOrderStatus } from '../../hooks/useStaffOrders';
import { useActiveStaffBatch } from '../../hooks/useActiveStaffBatch';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { isOperationalOrder } from '../../utils/orderFilters';
import { todayIST } from '../../utils/istDate';
import { supabase } from '../../api/supabaseClient';
import type { CustomerScreenProps } from '../../navigation/types';
import type { OrderStatus } from '../../types';

export function DriverDashboardScreen({ navigation }: CustomerScreenProps<'DriverDashboard'>) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  // The driver board shows exactly one cycle's batch — the active batch
  // released by the most recent kitchen push (same as Kitchen/Packing/Hub).
  const { data: batch } = useActiveStaffBatch();
  // IST calendar date — basis for the D2 "unsuccessful delivery" cut-off.
  const today = todayIST();

  const { mutateAsync: updateStatus, isPending: isUpdating } = useUpdateOrderStatus();
  // Realtime: refresh when an order is dispatched / advances through hub handoff.
  useRealtimeOrders(true);

  const { data: orders = [], isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ['driver_orders', userId, batch ? `${batch.cycle_id}:${batch.push_date}` : 'none', today],
    queryFn: async () => {
      if (!userId) return [];

      // Find which hubs and zones this driver is assigned to.
      const [hubsRes, zonesRes] = await Promise.all([
        supabase.from('delivery_hubs').select('id').eq('driver_user_id', userId),
        supabase.from('delivery_zones').select('id').eq('driver_user_id', userId),
      ]);
      const myHubIds = (hubsRes.data ?? []).map((h: any) => h.id);
      const myZoneIds = (zonesRes.data ?? []).map((z: any) => z.id);

      if (myHubIds.length === 0 && myZoneIds.length === 0) return [];

      // The driver's list = the active batch's cycle, PLUS any "unsuccessful
      // delivery" (D2) — a past-dated order still not Delivered/Cancelled/
      // Failed — so an undelivered perishable order never vanishes when the
      // batch flips. Filtered client-side by hub/zone membership below.
      const unsuccessful =
        `and(dispatch_date.lt.${today},status.not.in.(Delivered,Cancelled,Failed))`;
      let ordersQuery = supabase
        .from('orders')
        .select(`
          *,
          order_items(*),
          customer_addresses(*),
          profiles(phone_number)
        `)
        .order('created_at', { ascending: false });
      if (batch) {
        const active =
          `and(cycle_id.eq.${batch.cycle_id},dispatch_date.eq.${batch.push_date},status.neq.Cancelled)`;
        ordersQuery = ordersQuery.or(`${active},${unsuccessful}`);
      } else {
        ordersQuery = ordersQuery.or(unsuccessful);
      }
      const { data, error: ordersErr } = await ordersQuery;

      if (ordersErr) throw ordersErr;

      // Drop subscription-purchase orders (no physical delivery) — the same
      // operational filter Kitchen/Packing/Hub use. Daily sub-dispatch rows
      // carry real items and pass.
      return (data ?? []).filter((o: any) => {
        if (!isOperationalOrder(o)) return false;
        const addr = o.customer_addresses;
        if (!addr) return false;
        if (addr.hub_id != null && myHubIds.includes(addr.hub_id)) return true;
        if (addr.zone_id != null && myZoneIds.includes(addr.zone_id)) return true;
        return false;
      });
    },
    enabled: !!userId && batch !== undefined,
    refetchOnMount: 'always',
  });

  const handleAdvanceStatus = async (
    orderId: number,
    next: OrderStatus,
    customerUserId: string | null,
  ) => {
    try {
      await updateStatus({ orderId, status: next, userId: customerUserId ?? undefined });
    } catch (e) {
      Alert.alert('Could not update status', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">My Deliveries</ThemedText>
        <View style={styles.spacer} />
      </View>

      {error ? (
        <ErrorRetry message="Failed to load deliveries" onRetry={refetch} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o: any) => String(o.id)}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Theme.colors.text.mint} />
          }
          ItemSeparatorComponent={() => <Divider />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !isLoading ? <EmptyState title="No deliveries today" subtitle="New orders will appear here as they're dispatched." /> : null
          }
          renderItem={({ item }) => (
            <DeliveryOrderRow
              order={item}
              onAdvanceStatus={handleAdvanceStatus}
              isUpdating={isUpdating}
              persona="driver"
            />
          )}
        />
      )}

      {isLoading && orders.length === 0 && (
        <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
      )}
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
  spacer: { minWidth: 60 },
  list: { paddingBottom: Theme.spacing.xl },
  loader: { marginTop: Theme.spacing.xl },
});
