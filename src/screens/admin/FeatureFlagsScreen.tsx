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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { useFeatureFlags } from '../../hooks/useFeatureFlag';
import { useUpdateFeatureFlag } from '../../hooks/useStaffManagement';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// Flags removed from product — hide from UI even if rows exist in DB
const HIDDEN_FLAGS = new Set(['loyalty_program', 'route_pdf_generation']);

// Flags wired in app code — show as active toggles
// branch_management_active: toggle saves to DB but query-layer gating is a pending build
const FLAG_NOTES: Record<string, string> = {
  branch_management_active: 'Saves to DB — full query gating is a pending build',
};

export function FeatureFlagsScreen({ navigation }: { navigation: any }) {
  const { data: flags = [], isLoading } = useFeatureFlags();
  const updateFlag = useUpdateFeatureFlag();

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
                onValueChange={() =>
                  updateFlag.mutate({ id: flag.id, flag_value: !flag.flag_value })
                }
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
});
