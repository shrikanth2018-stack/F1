/**
 * 1stOne F1 — Vendor Manager
 *
 * The list of vendors and their onboarding state. Vendors sell their own
 * items in the Essentials section, scoped to the zones/hubs an admin grants
 * them. Food is never involved.
 *
 * Onboarding is two-sided, so this screen leads with what needs YOUR
 * action: "Ready to verify" first, because a vendor who has filled in their
 * details is waiting on you.
 *
 *   invited    they still owe you their business details
 *   submitted  ready to verify  ← your move
 *   approved   selling
 *   suspended  catalogue down, existing orders honoured, balance claimable
 */

import React, { useState } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { DispatchBadge } from '../../components/DispatchBadge';
import { formatPhone } from '../../utils/formatters';
import {
  useVendors,
  STATUS_LABEL,
  type Vendor,
  type VendorStatus,
} from '../../hooks/useVendors';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type Filter = VendorStatus | 'all';

// "Ready to verify" leads: those are the ones waiting on the admin.
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'submitted', label: 'To verify' },
  { key: 'approved', label: 'Approved' },
  { key: 'invited', label: 'Awaiting them' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'all', label: 'All' },
];

const STATUS_VARIANT: Record<VendorStatus, 'success' | 'warning' | 'info' | 'error'> = {
  approved: 'success',
  submitted: 'warning',
  invited: 'info',
  suspended: 'error',
  rejected: 'error',
};

export function AdminVendorManagerScreen({ navigation }: AdminScreenProps<'AdminVendorManager'>) {
  const [filter, setFilter] = useState<Filter>('submitted');
  const { data: vendors, isLoading, error, refetch } = useVendors(filter);

  if (error) return <ErrorRetry message="Could not load vendors" onRetry={refetch} />;

  const renderItem = ({ item }: { item: Vendor }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.6}
      onPress={() => navigation.navigate('AdminVendorDetail', { vendorId: item.id })}
    >
      <View style={styles.rowTop}>
        <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]} numberOfLines={1}>
          {item.business_name || item.profiles?.full_name || 'Unnamed vendor'}
        </ThemedText>
        <DispatchBadge label={STATUS_LABEL[item.status]} variant={STATUS_VARIANT[item.status]} />
      </View>
      <ThemedText variant="small" color="muted" style={styles.sub} numberOfLines={1}>
        {item.profiles?.full_name ?? '—'}
        {item.profiles?.phone_number ? ` · ${formatPhone(item.profiles.phone_number)}` : ''}
        {item.status === 'approved' ? ` · ${item.commission_percent}% commission` : ''}
      </ThemedText>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Vendors</ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(f.key)}
              activeOpacity={0.7}
            >
              <ThemedText variant="small" color={active ? 'mint' : 'muted'}>{f.label}</ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Divider />

      {isLoading && <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />}

      <FlatList
        data={vendors ?? []}
        keyExtractor={(v) => String(v.id)}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <Divider />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              title={filter === 'submitted' ? 'Nothing waiting on you' : 'No vendors here'}
              subtitle={'Tap "+ Onboard vendor" below'}
            />
          ) : null
        }
      />

      <TouchableOpacity
        style={styles.footer}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('AdminVendorOnboard')}
      >
        <ThemedText variant="body" color="mint" style={styles.txt}>+ Onboard vendor  ›</ThemedText>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chipRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },

  loader: { marginTop: Theme.spacing.lg },
  list: { paddingBottom: Theme.spacing.xl },
  row: { paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm + 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  flex1: { flex: 1 },
  sub: { fontSize: S, marginTop: 2 },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },

  txt: { fontSize: B },
});
