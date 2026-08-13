/**
 * 1stOne F1 — Customer Manager
 *
 * One entry point for the two things the back office does with a customer:
 * register one, and look one up. They were two separate rows on the Manage
 * page, which made that page longer without making either easier to find —
 * they are the same job at different moments.
 *
 * Registration usually happens well before a first order (a B2B account is
 * often set up days ahead), and lookup is a support task rather than an
 * ordering one. That is why neither belongs under ORDERS.
 *
 * EXPORT MOVED HERE from Operations Manager. It was filed there as a
 * super-admin action over the whole base, but nobody looking for "the
 * customer list" thinks to open Operations. It is still super-admin only —
 * the row is simply absent for a branch admin rather than shown and refused,
 * because an entry that exists only to reject you is worse than no entry.
 */

import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ScreenHeader } from '../../components/ScreenHeader';
import { SettingsRow } from '../../components/SettingsRow';
import { useBranchFilter } from '../../hooks/useBranchFilter';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;

export function AdminCustomerManagerScreen({
  navigation,
}: AdminScreenProps<'AdminCustomerManager'>) {
  const { isSuperAdmin } = useBranchFilter();

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Customer Manager" />

      <ScrollView contentContainerStyle={styles.list}>
        <SettingsRow
          label="Add Customer"
          subtitle="Register a customer and their address from the back office"
          showChevron
          labelSize={B}
          onPress={() => navigation.navigate('AdminCreateCustomer')}
        />
        <SettingsRow
          label="Customer Lookup"
          subtitle="Order history and details for a phone number"
          showChevron
          labelSize={B}
          onPress={() => navigation.navigate('AdminCustomerLookup')}
        />
        {isSuperAdmin && (
          <SettingsRow
            label="Export Customers"
            subtitle="Filter the base and download it as a spreadsheet"
            showChevron
            labelSize={B}
            onPress={() => navigation.navigate('CustomerExport')}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  list: { paddingBottom: Theme.spacing.xl },
});
