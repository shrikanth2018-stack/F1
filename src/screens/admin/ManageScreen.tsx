/**
 * 1stOne F1 — Admin Manage Screen
 *
 * Settings-style hub that navigates to management sub-screens.
 * Menu, Store, Team sections with navigation rows.
 */

import React from 'react';
import { View, ScrollView, Alert, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { SettingsRow } from '../../components/SettingsRow';
import { Divider } from '../../components/Divider';
import { ThemedButton } from '../../components/ThemedButton';
import { useAuth } from '../../hooks/useAuth';

export function ManageScreen() {
  const navigation = useNavigation<any>();
  const { signOut } = useAuth();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <ThemedText variant="header" color="primary" style={styles.header}>
        Settings Hub
      </ThemedText>

      <ThemedText variant="small" color="muted" style={styles.section}>
        MENU
      </ThemedText>
      <SettingsRow
        label="Menu Items"
        showChevron
        onPress={() => navigation.navigate('MenuManage')}
      />
      <SettingsRow
        label="Delivery Cycles"
        showChevron
        onPress={() => navigation.navigate('CyclesManage')}
      />
      <SettingsRow
        label="Subscription Plans"
        showChevron
        onPress={() => navigation.navigate('PlansManage')}
      />

      <Divider />

      <ThemedText variant="small" color="muted" style={styles.section}>
        STORE
      </ThemedText>
      <SettingsRow
        label="Store Config"
        showChevron
        onPress={() => navigation.navigate('StoreConfig')}
      />
      <SettingsRow
        label="Feature Flags"
        showChevron
        onPress={() => navigation.navigate('StoreConfig')}
      />
      <SettingsRow
        label="Banners"
        showChevron
        onPress={() => {}}
      />

      <Divider />

      <ThemedText variant="small" color="muted" style={styles.section}>
        TEAM
      </ThemedText>
      <SettingsRow
        label="Staff Management"
        showChevron
        onPress={() => navigation.navigate('StaffManage')}
      />
      <SettingsRow
        label="Expense Approvals"
        showChevron
        onPress={() => navigation.navigate('StaffManage')}
      />
      <SettingsRow
        label="Leave Approvals"
        showChevron
        onPress={() => navigation.navigate('StaffManage')}
      />

      <Divider />

      <View style={styles.signOut}>
        <ThemedButton title="Sign Out" variant="text" onPress={handleSignOut} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
  },
  content: {
    padding: Theme.spacing.md,
    paddingTop: Theme.spacing.xl + Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  header: {
    marginBottom: Theme.spacing.lg,
  },
  section: {
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.xs,
    letterSpacing: 1,
  },
  signOut: {
    marginTop: Theme.spacing.xl,
    alignItems: 'center',
  },
});
