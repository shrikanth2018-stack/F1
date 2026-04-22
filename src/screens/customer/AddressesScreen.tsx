/**
 * 1stOne F1 — My Addresses Screen
 * Lists saved addresses with set-default and delete actions.
 * Delete is only available when the user has more than one address.
 */

import React from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import { useAddresses, useSetDefaultAddress, useDeleteAddress } from '../../hooks/useAddresses';
import type { CustomerAddress } from '../../types';

export function AddressesScreen({ navigation }: any) {
  const { data: addresses, isLoading } = useAddresses();
  const { mutate: setDefault, isPending: isSettingDefault } = useSetDefaultAddress();
  const { mutate: deleteAddress } = useDeleteAddress();

  const handleSetDefault = (id: number) => {
    setDefault(id, {
      onError: () => Alert.alert('Error', 'Could not update default address. Please try again.'),
    });
  };

  const handleDelete = (id: number) => {
    Alert.alert(
      'Delete Address',
      'Remove this address from your saved list?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteAddress(id, {
              onError: () => Alert.alert('Error', 'Could not delete address. Please try again.'),
            }),
        },
      ]
    );
  };

  const canDelete = (addresses?.length ?? 0) > 1;

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

      <View style={styles.rowActions}>
        {item.is_default ? (
          <ThemedText variant="small" color="mint" style={styles.defaultLabel}>Default</ThemedText>
        ) : (
          <TouchableOpacity
            onPress={() => handleSetDefault(item.id)}
            disabled={isSettingDefault}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isSettingDefault ? (
              <ActivityIndicator size="small" color={Theme.colors.text.muted} />
            ) : (
              <ThemedText variant="small" color="muted" style={styles.setDefaultText}>
                Set default
              </ThemedText>
            )}
          </TouchableOpacity>
        )}
        {canDelete && (
          <TouchableOpacity
            onPress={() => handleDelete(item.id)}
            style={styles.deleteBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ThemedText variant="small" style={styles.deleteText}>Delete</ThemedText>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ThemedText variant="header" color="primary">My Addresses</ThemedText>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="muted">Close</ThemedText>
        </TouchableOpacity>
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
  rowLeft: { flex: 1, marginRight: Theme.spacing.sm },
  addressLine: { marginTop: 2 },
  rowActions: {
    alignItems: 'flex-end',
    gap: Theme.spacing.sm,
    flexShrink: 0,
  },
  defaultLabel: { fontWeight: '500' },
  setDefaultText: { textDecorationLine: 'underline' },
  deleteBtn: { marginTop: 2 },
  deleteText: { color: Theme.colors.status.error },
  addBtn: {
    margin: Theme.spacing.md,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: `${Theme.colors.text.mint}4D`,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.background.secondary,
  },
  addBtnText: { fontWeight: '400' },
});
