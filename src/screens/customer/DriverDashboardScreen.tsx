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
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { supabase } from '../../api/supabaseClient';
import type { CustomerScreenProps } from '../../navigation/types';
import type { OrderStatus } from '../../types';

const ACTIVE_DELIVERY_STATUSES: OrderStatus[] = ['Dispatched', 'Received at Hub', 'On the Way'];

export function DriverDashboardScreen({ navigation }: CustomerScreenProps<'DriverDashboard'>) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const today = new Date().toISOString().split('T')[0];

  const { mutateAsync: updateStatus, isPending: isUpdating } = useUpdateOrderStatus();
  // Realtime: refresh when an order is dispatched / advances through hub handoff.
  useRealtimeOrders(true);

  const { data: orders = [], isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ['driver_orders', userId, today],
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

      // Fetch today's active-delivery orders. Filter client-side by hub/zone
      // membership — keeps the query simple, fine at trial scale.
      const { data, error: ordersErr } = await supabase
        .from('orders')
        .select(`
          *,
          order_items(*),
          customer_addresses(*),
          profiles(phone_number)
        `)
        .eq('dispatch_date', today)
        .in('status', ACTIVE_DELIVERY_STATUSES)
        .order('created_at', { ascending: false });

      if (ordersErr) throw ordersErr;

      return (data ?? []).filter((o: any) => {
        const addr = o.customer_addresses;
        if (!addr) return false;
        if (addr.hub_id != null && myHubIds.includes(addr.hub_id)) return true;
        if (addr.zone_id != null && myZoneIds.includes(addr.zone_id)) return true;
        return false;
      });
    },
    enabled: !!userId,
    refetchOnMount: 'always',
  });

  const handleAdvanceStatus = async (
    orderId: number,
    next: OrderStatus,
    customerUserId: string | null,
  ) => {
    try {
      await updateStatus({ orderId, status: next, userId: customerUserId ?? undefined });
    } catch (e: any) {
      Alert.alert('Could not update status', e?.message ?? 'Please try again.');
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
