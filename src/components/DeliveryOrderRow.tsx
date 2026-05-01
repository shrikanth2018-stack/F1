/**
 * 1stOne F1 — Delivery Order Row
 *
 * Shared component used by DriverDashboardScreen, HubDashboardScreen,
 * AdminDeliveryLiveScreen — and historically the staff Delivery tab.
 *
 *  - Shows: order #, customer name + items, optional driver chip
 *  - Status toggle that advances through the delivery flow:
 *      Dispatched → Received at Hub (hub orders only) → On the Way → Delivered
 *  - Action icons: Call customer (tel:), Open Maps (directions), Show Address (alert)
 *
 * Map button uses a directions URL — works on both iOS and Android,
 * opens Google Maps app or Apple Maps depending on what's installed,
 * falls back to web if neither is.
 */

import React from 'react';
import { View, Text, TouchableOpacity, Alert, Linking, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';
import type { OrderStatus } from '../types';

const BODY2 = Theme.typography.sizes.body + 2;
const SMALL2 = Theme.typography.sizes.small + 2;

function statusColor(status: string): string {
  switch (status) {
    case 'Dispatched': return Theme.colors.action.primary;
    case 'Received at Hub': return Theme.colors.status.info;
    case 'On the Way': return Theme.colors.status.warning;
    case 'Delivered': return Theme.colors.status.success;
    case 'Cancelled': return Theme.colors.status.error;
    default: return Theme.colors.text.muted;
  }
}

function nextDeliveryStatus(current: string, deliveryMethod: string | null): OrderStatus | null {
  if (deliveryMethod === 'hub') {
    if (current === 'Dispatched') return 'Received at Hub';
    if (current === 'Received at Hub') return 'On the Way';
    if (current === 'On the Way') return 'Delivered';
  } else {
    if (current === 'Dispatched') return 'On the Way';
    if (current === 'On the Way') return 'Delivered';
  }
  return null;
}

export interface DriverInfo {
  code: string | null;
  label: string;
}

export interface DeliveryOrderRowProps {
  /** Order with customer_addresses, order_items, profiles relations populated */
  order: any;
  /** Called when user taps the status pill — provides next status or null if no advance */
  onAdvanceStatus: (orderId: number, nextStatus: OrderStatus, userId: string | null) => void;
  /** True for admin contexts: shows the driver code/name chip below customer name */
  showDriverInfo?: boolean;
  /** Required when showDriverInfo=true — derives driver code/label from the order */
  getDriverInfo?: (order: any) => DriverInfo;
  /** Disable status pill while a mutation is in flight */
  isUpdating?: boolean;
}

export function DeliveryOrderRow({
  order,
  onAdvanceStatus,
  showDriverInfo = false,
  getDriverInfo,
  isUpdating = false,
}: DeliveryOrderRowProps) {
  const address = order.customer_addresses;
  const phone = address?.phone_number || order.profiles?.phone_number;
  const itemNames = (order.order_items ?? [])
    .map((oi: any) => `${oi.item_name} ×${oi.quantity}`)
    .join(', ');

  const next = nextDeliveryStatus(order.status, order.delivery_method);
  const canAdvance = next != null && !isUpdating;

  const driverInfo = showDriverInfo && getDriverInfo ? getDriverInfo(order) : null;
  const driverUnassigned = driverInfo && !driverInfo.code;

  const handleCall = () => {
    if (!phone) {
      Alert.alert('No phone', 'Customer phone number is missing.');
      return;
    }
    Linking.openURL(`tel:${phone}`);
  };

  const handleMap = () => {
    if (address?.latitude != null && address?.longitude != null) {
      // Cross-platform directions URL — opens Google Maps / Apple Maps app
      const url = `https://www.google.com/maps/dir/?api=1&destination=${address.latitude},${address.longitude}`;
      Linking.openURL(url);
      return;
    }
    // Fallback if no coordinates — query by address text
    if (address) {
      const q = encodeURIComponent(`${address.address_line ?? ''} ${address.city ?? ''}`);
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
      return;
    }
    Alert.alert('No location', 'Address information is missing.');
  };

  const handleShowAddress = () => {
    if (!address) {
      Alert.alert('No address', 'Address details are missing.');
      return;
    }
    const lines = [
      address.full_name,
      address.address_line,
      address.landmark,
      address.city,
    ].filter(Boolean);
    Alert.alert('Delivery address', lines.join('\n'));
  };

  return (
    <View style={styles.row}>
      <View style={styles.main}>
        <View style={{ flex: 1 }}>
          <ThemedText variant="subtitle" color="primary" style={styles.idText}>
            #{order.id}
          </ThemedText>
          <ThemedText variant="small" color="subtitle" numberOfLines={2} style={styles.smallLine}>
            {itemNames || '—'}
          </ThemedText>
          {address && (
            <ThemedText variant="small" color="muted" numberOfLines={1} style={styles.smallLine}>
              {address.full_name}
            </ThemedText>
          )}
          {driverInfo && (
            <ThemedText
              variant="small"
              color={driverUnassigned ? 'accent' : 'mint'}
              numberOfLines={1}
              style={[styles.smallLine, driverUnassigned && { color: Theme.colors.status.error }]}
            >
              {driverInfo.label}
            </ThemedText>
          )}
        </View>

        <View style={styles.rightColumn}>
          <TouchableOpacity
            style={[styles.statusPill, { borderColor: statusColor(order.status) }]}
            disabled={!canAdvance}
            onPress={() => next && onAdvanceStatus(order.id, next, order.user_id ?? null)}
          >
            <Text style={[styles.statusText, { color: statusColor(order.status) }]}>
              {order.status}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.iconsRow}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleCall} accessibilityLabel="Call customer">
          <Text style={styles.iconText}>☎</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={handleMap} accessibilityLabel="Open in maps">
          <Text style={styles.iconText}>⊙</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={handleShowAddress} accessibilityLabel="Show full address">
          <Text style={styles.iconText}>⊞</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: Theme.spacing.sm + 2,
    paddingHorizontal: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  idText: { fontSize: BODY2 },
  smallLine: { fontSize: SMALL2, marginTop: 2 },
  rightColumn: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: Theme.spacing.sm,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 3,
    minWidth: 80,
    alignItems: 'center',
  },
  statusText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: SMALL2,
  },
  iconsRow: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.xs,
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 13,
    color: Theme.colors.text.accent,
  },
});
