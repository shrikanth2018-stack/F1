/**
 * 1stOne F1 — Feature Flags (Admin)
 *
 * Flat list of all feature flags — toggle on/off, description below each key.
 */

import React from 'react';
import {
  View,
  FlatList,
  Switch,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { useFeatureFlags } from '../../hooks/useFeatureFlag';
import { useUpdateFeatureFlag, useUpdateStoreConfig } from '../../hooks/useStaffManagement';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// Flags removed from product — hide from UI even if rows exist in DB.
// storm_mode_active is surfaced separately at the top of this screen as a
// dedicated section (canonical source: store_config.storm_mode_active), so
// the feature_flags row itself stays hidden to avoid two-toggle confusion.
const HIDDEN_FLAGS = new Set(['loyalty_program', 'route_pdf_generation', 'storm_mode_active']);

// Flags wired in app code — show as active toggles.
// Per-flag helper notes shown on the admin row (empty object = no notes today).
const FLAG_NOTES: Record<string, string> = {};

export function FeatureFlagsScreen({ navigation }: { navigation: AdminNavProp }) {
  const { data: flags = [], isLoading } = useFeatureFlags();
  const updateFlag = useUpdateFeatureFlag();
  const { data: storeConfig } = useStoreConfig();
  const updateStoreConfig = useUpdateStoreConfig();
  const stormActive = storeConfig?.storm_mode_active === true;

  const handleStormToggle = (next: boolean) => {
    if (next) {
      Alert.alert(
        '⚠ Enable Storm Mode?',
        'This will pause all new orders immediately. Existing orders continue processing.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Enable',
            style: 'destructive',
            onPress: () => updateStoreConfig.mutate({ storm_mode_active: true }),
          },
        ],
      );
    } else {
      updateStoreConfig.mutate({ storm_mode_active: false });
    }
  };

  const handleToggle = (flag: any) => {
    const apply = (value: boolean) => updateFlag.mutate(
      { id: flag.id, flag_value: value },
      { onError: (e: any) => Alert.alert('Update Failed', e?.message ?? 'Could not update flag.') },
    );
    const turningOff = flag.flag_value === true;
    if (turningOff) {
      Alert.alert(
        `Disable ${flag.flag_key}?`,
        'Turning this off will immediately affect all users. Are you sure?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: () => apply(false),
          },
        ]
      );
    } else {
      apply(true);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={{ fontSize: B, minWidth: 60 }}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={{ flex: 1, textAlign: 'center' }}>
          Feature Flags
        </ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: Theme.spacing.xl }} color={Theme.colors.action.primary} />
      ) : (
        <FlatList
          data={flags.filter((f: any) => !HIDDEN_FLAGS.has(f.flag_key))}
          keyExtractor={(f: any) => String(f.id)}
          contentContainerStyle={{ paddingBottom: Theme.spacing.xl * 2 }}
          ListHeaderComponent={
            <View>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>EMERGENCY</ThemedText>
              <View style={[styles.flagRow, styles.flagBorder]}>
                <View style={{ flex: 1 }}>
                  <ThemedText
                    variant="body"
                    color="primary"
                    style={{ fontSize: B, color: Theme.colors.status.error }}
                  >
                    ⚠ Storm Mode
                  </ThemedText>
                  <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                    {stormActive ? 'All new orders are paused' : 'Pause all new orders instantly'}
                  </ThemedText>
                </View>
                <Switch
                  value={stormActive}
                  onValueChange={handleStormToggle}
                  trackColor={{
                    true: Theme.colors.status.error,
                    false: Theme.colors.background.tertiary,
                  }}
                />
              </View>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>FEATURE FLAGS</ThemedText>
            </View>
          }
          ListEmptyComponent={
            <ThemedText variant="body" color="muted" style={styles.empty}>
              No feature flags configured
            </ThemedText>
          }
          renderItem={({ item: flag, index }) => (
            <View style={[
              styles.flagRow,
              index < flags.length - 1 && styles.flagBorder,
            ]}>
              <View style={{ flex: 1 }}>
                <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
                  {flag.flag_key}
                </ThemedText>
                {(flag.description || FLAG_NOTES[flag.flag_key]) ? (
                  <ThemedText variant="small" color="muted" style={{ fontSize: S, marginTop: 2 }}>
                    {flag.description || FLAG_NOTES[flag.flag_key]}
                  </ThemedText>
                ) : null}
              </View>
              <Switch
                value={flag.flag_value}
                onValueChange={() => handleToggle(flag)}
                trackColor={{
                  true: Theme.colors.status.success,
                  false: Theme.colors.background.tertiary,
                }}
              />
            </View>
          )}
        />
      )}
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

  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    gap: Theme.spacing.sm,
  },
  flagBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  empty: {
    textAlign: 'center',
    marginTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
  },

  sectionLabel: {
    fontSize: Theme.typography.sizes.small,
    letterSpacing: 0.5,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
  },
});
