/**
 * 1stOne F1 — Customer Lookup (order history by phone)
 *
 * Enter a phone number, get the customer and every order placed for them —
 * whether they placed it themselves or an admin did from the back office.
 * This is the "order history for a phone number" surface that invoicing and
 * support need; tapping a row opens the canonical AdminOrderDetail.
 *
 * Read-only. Branch-scoped admin reads are already permitted by the existing
 * orders / profiles RLS policies, so there is no new server surface here.
 */

import React, { useState } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { DispatchBadge } from '../../components/DispatchBadge';
import { orderStatusVariant } from '../../utils/orderStatus';
import { formatDateShort, formatPriceShort, formatPhone } from '../../utils/formatters';
import {
  useCustomerByPhone,
  useCustomerOrders,
  toStoredPhone,
  type AdminCustomerOrder,
} from '../../hooks/useAdminOrderEntry';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export function AdminCustomerLookupScreen({ navigation }: AdminScreenProps<'AdminCustomerLookup'>) {
  const [phone, setPhone] = useState('');
  const complete = toStoredPhone(phone) != null;

  const { data: customer, isFetching: lookingUp } = useCustomerByPhone(phone);
  const { data: orders, isLoading: loadingOrders } = useCustomerOrders(customer?.id);

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Customer Lookup" />

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Phone number (10 digits)"
          placeholderTextColor={Theme.colors.text.muted}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={13}
          returnKeyType="search"
        />
        {phone.length > 0 && (
          <TouchableOpacity onPress={() => setPhone('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ThemedText variant="body" color="muted">×</ThemedText>
          </TouchableOpacity>
        )}
      </View>

      {lookingUp && <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />}

      {complete && !lookingUp && !customer && (
        <EmptyState title="No customer with this number" subtitle="They have never ordered or signed in." />
      )}

      {customer && (
        <>
          <View style={styles.customerBlock}>
            <ThemedText variant="body" color="primary" style={styles.txt}>
              {customer.full_name || 'Unnamed customer'}
            </ThemedText>
            <ThemedText variant="small" color="muted" style={styles.sub}>
              {formatPhone(customer.phone_number ?? '')} · wallet {formatPriceShort(customer.wallet_balance ?? 0)}
            </ThemedText>
          </View>
          <Divider />
        </>
      )}

      {customer && loadingOrders && <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />}

      {customer && !loadingOrders && (
        <FlatList
          data={orders ?? []}
          keyExtractor={(o: AdminCustomerOrder) => String(o.id)}
          ItemSeparatorComponent={() => <Divider />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState title="No orders yet" />}
          renderItem={({ item }: { item: AdminCustomerOrder }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.6}
              onPress={() => navigation.navigate('AdminOrderDetail', { orderId: item.id })}
            >
              <View style={styles.rowTop}>
                <ThemedText variant="body" color="primary" style={styles.rowId}>#{item.id}</ThemedText>
                <ThemedText variant="small" color="subtitle" style={styles.rowMid}>
                  {formatDateShort(item.dispatch_date)} · {formatPriceShort(item.total_amount)}
                </ThemedText>
                <DispatchBadge label={item.status ?? ''} variant={orderStatusVariant(item.status)} />
              </View>
              {/* paid/unpaid is shown for back-office orders only, where the
                  question ("has this invoice been settled?") is the point of
                  the row. On the customer path the status badge above already
                  says it, and orders placed before confirm-order started
                  stamping paid_at (2026-07-30) carry no timestamp even though
                  they were paid — so showing it there would misread history. */}
              <ThemedText variant="small" color="muted" style={styles.sub}>
                {item.placed_by
                  ? `Back office · ${item.paid_at ? 'paid' : 'unpaid'}`
                  : 'Placed by customer'}
              </ThemedText>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  input: {
    flex: 1,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  loader: { marginTop: Theme.spacing.lg },

  customerBlock: { paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm },
  sub: { fontSize: S, marginTop: 2 },

  list: { paddingBottom: Theme.spacing.xl },
  row: { paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm + 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  rowId: { fontSize: B, minWidth: 56 },
  rowMid: { fontSize: S, flex: 1 },

  txt: { fontSize: B },
});
