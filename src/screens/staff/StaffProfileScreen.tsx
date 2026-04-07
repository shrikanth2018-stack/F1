/**
 * 1stOne F1 — Staff Profile Screen
 *
 * Staff info, salary history, offline queue status,
 * WhatsApp support, sign out.
 */

import React from 'react';
import { View, ScrollView, Linking, Alert, StyleSheet } from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { SettingsRow } from '../../components/SettingsRow';
import { useAuth } from '../../hooks/useAuth';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useOfflineSync } from '../../hooks/useOfflineSync';

export function StaffProfileScreen() {
  const { session, signOut } = useAuth();
  const { data: config } = useStoreConfig();
  const { pendingCount, isSyncing, manualSync } = useOfflineSync();

  const handleWhatsApp = () => {
    const number = config?.whatsapp_support_number || '9448364017';
    const url = `https://wa.me/91${number}?text=Hi, I need help (Staff)`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Could not open WhatsApp');
    });
  };

  const handleManualSync = () => {
    if (pendingCount === 0) {
      Alert.alert('All synced', 'No pending offline mutations.');
      return;
    }
    manualSync();
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ThemedText variant="header" color="primary">
        Profile
      </ThemedText>

      {/* Staff Info Card */}
      <View style={styles.infoCard}>
        <ThemedText variant="subtitle" color="primary">
          {session?.user.phone || 'Staff Member'}
        </ThemedText>
        <ThemedText variant="small" color="subtitle" style={styles.role}>
          Role: Staff
        </ThemedText>
        {session?.assignedHubId && (
          <ThemedText variant="small" color="muted">
            Hub ID: {session.assignedHubId}
          </ThemedText>
        )}
      </View>

      {/* Offline Queue */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Sync Status
        </ThemedText>

        <View style={styles.syncCard}>
          <View style={styles.syncRow}>
            <ThemedText variant="body" color="primary">
              Pending mutations
            </ThemedText>
            <ThemedText
              variant="subtitle"
              color={pendingCount > 0 ? 'accent' : 'primary'}
            >
              {pendingCount}
            </ThemedText>
          </View>

          {pendingCount > 0 && (
            <ThemedButton
              title={isSyncing ? 'Syncing...' : 'Sync Now'}
              variant="primary"
              onPress={handleManualSync}
              loading={isSyncing}
            />
          )}

          {pendingCount === 0 && (
            <ThemedText variant="small" color="subtitle" style={styles.syncNote}>
              All data synced with server
            </ThemedText>
          )}
        </View>
      </View>

      {/* Settings */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Support
        </ThemedText>

        <SettingsRow
          label="WhatsApp Support"
          onPress={handleWhatsApp}
        />
      </View>

      {/* Sign Out */}
      <View style={styles.signOut}>
        <ThemedButton
          title="Sign Out"
          variant="text"
          onPress={handleSignOut}
        />
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
  infoCard: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    marginTop: Theme.spacing.md,
  },
  role: {
    marginTop: Theme.spacing.xs,
  },
  section: {
    marginTop: Theme.spacing.lg,
  },
  sectionTitle: {
    marginBottom: Theme.spacing.sm,
  },
  syncCard: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
  },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  syncNote: {
    textAlign: 'center',
  },
  signOut: {
    marginTop: Theme.spacing.xl,
    alignItems: 'center',
  },
});
