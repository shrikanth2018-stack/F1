/**
 * 1stOne F1 — My Addresses Screen
 * Lists saved addresses; tap "Add Address" to add a new one.
 */

import React from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import { useAddresses } from '../../hooks/useAddresses';
import type { CustomerAddress } from '../../types';

export function AddressesScreen({ navigation }: any) {
  const { data: addresses, isLoading } = useAddresses();

  const renderAddress = ({ item }: { item: CustomerAddress }) => (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <ThemedText variant="subtitle" color="primary">{item.label}</ThemedText>
        <ThemedText variant="body" color="subtitle" style={styles.addressLine}>
          {item.full_name}
        </ThemedText>
        <ThemedText variant="body" color="subtitle">{item.address_line}</ThemedText>
        {item.landmark ? (
          <ThemedText variant="small" color="muted">{item.landmark}</ThemedText>
        ) : null}
        {item.city ? (
          <ThemedText variant="small" color="muted">{item.city}</ThemedText>
        ) : null}
      </View>
      {item.is_default && (
        <ThemedText variant="small" color="mint">Default</ThemedText>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">My Addresses</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={addresses ?? []}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderAddress}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              title="No addresses saved"
              subtitle="Add your delivery address below"
            />
          ) : null
        }
        ListFooterComponent={
          <TouchableOpacity
            style={styles.addBtn}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('AddAddress')}
          >
            <ThemedText variant="body" color="mint" style={styles.addBtnText}>
              + Add Address
            </ThemedText>
          </TouchableOpacity>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  list: {
    paddingBottom: Theme.spacing.xl,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
  },
  rowLeft: { flex: 1 },
  addressLine: { marginTop: 2 },
  addBtn: {
    margin: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    borderRadius: Theme.components.inputRadius,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Theme.colors.background.secondary,
  },
  addBtnText: { fontWeight: '600' },
});
