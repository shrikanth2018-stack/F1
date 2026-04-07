/**
 * 1stOne F1 — Admin Store Config Screen
 *
 * Edit store config (singleton id=1) + toggle feature flags.
 * All changes save immediately via mutation.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  StyleSheet,
} from 'react-native';
import { TouchableOpacity } from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { Divider } from '../../components/Divider';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useFeatureFlags } from '../../hooks/useFeatureFlag';
import { useUpdateStoreConfig, useUpdateFeatureFlag } from '../../hooks/useStaffManagement';

function ConfigRow({
  label,
  value,
  onChangeText,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: 'default' | 'numeric';
}) {
  return (
    <View style={styles.configRow}>
      <ThemedText variant="body" color="primary" style={styles.configLabel}>
        {label}
      </ThemedText>
      <TextInput
        style={styles.configInput}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholderTextColor={Theme.colors.text.muted}
      />
    </View>
  );
}

export function StoreConfigScreen({ navigation }: { navigation: any }) {
  const { data: config, isLoading } = useStoreConfig();
  const { data: flags } = useFeatureFlags();
  const updateConfig = useUpdateStoreConfig();
  const updateFlag = useUpdateFeatureFlag();

  // Editable config fields
  const [taxRate, setTaxRate] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [cancelWindow, setCancelWindow] = useState('');
  const [minTopup, setMinTopup] = useState('');
  const [loyaltyRate, setLoyaltyRate] = useState('');
  const [whatsappNum, setWhatsappNum] = useState('');
  const [stormMode, setStormMode] = useState(false);

  // Populate form when config loads
  useEffect(() => {
    if (config) {
      setTaxRate(String(config.tax_rate_percentage));
      setDeliveryFee(String(config.delivery_fee));
      setCancelWindow(String(config.cancellation_window_hours));
      setMinTopup(String(config.min_wallet_topup));
      setLoyaltyRate(String(config.loyalty_points_per_rupee));
      setWhatsappNum(config.whatsapp_support_number ?? '');
      setStormMode(config.storm_mode_active);
    }
  }, [config]);

  const handleSaveConfig = () => {
    updateConfig.mutate(
      {
        tax_rate_percentage: parseFloat(taxRate) || 0,
        delivery_fee: parseFloat(deliveryFee) || 0,
        cancellation_window_hours: parseInt(cancelWindow, 10) || 2,
        min_wallet_topup: parseFloat(minTopup) || 100,
        loyalty_points_per_rupee: parseFloat(loyaltyRate) || 0.1,
        whatsapp_support_number: whatsappNum || null,
        storm_mode_active: stormMode,
      },
      {
        onSuccess: () => Alert.alert('Saved', 'Store config updated.'),
      }
    );
  };

  const handleToggleFlag = (flagId: number, currentValue: boolean) => {
    updateFlag.mutate({ id: flagId, flag_value: !currentValue });
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ThemedText variant="body" color="subtitle">
          Loading config...
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">
            {'< Back'}
          </ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">
          Store Config
        </ThemedText>
        <View style={{ width: 50 }} />
      </View>

      {/* Config Fields */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Pricing
        </ThemedText>
        <ConfigRow
          label="Tax Rate (%)"
          value={taxRate}
          onChangeText={setTaxRate}
          keyboardType="numeric"
        />
        <ConfigRow
          label="Delivery Fee"
          value={deliveryFee}
          onChangeText={setDeliveryFee}
          keyboardType="numeric"
        />
        <ConfigRow
          label="Min Wallet Top-up"
          value={minTopup}
          onChangeText={setMinTopup}
          keyboardType="numeric"
        />
        <ConfigRow
          label="Loyalty pts/rupee"
          value={loyaltyRate}
          onChangeText={setLoyaltyRate}
          keyboardType="numeric"
        />
      </View>

      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Operations
        </ThemedText>
        <ConfigRow
          label="Cancel Window (hrs)"
          value={cancelWindow}
          onChangeText={setCancelWindow}
          keyboardType="numeric"
        />
        <ConfigRow
          label="WhatsApp Number"
          value={whatsappNum}
          onChangeText={setWhatsappNum}
        />
        <View style={styles.switchRow}>
          <ThemedText variant="body" color="primary">
            Storm Mode
          </ThemedText>
          <Switch
            value={stormMode}
            onValueChange={setStormMode}
            trackColor={{
              true: Theme.colors.status.error,
              false: Theme.colors.background.tertiary,
            }}
          />
        </View>
      </View>

      <ThemedButton
        title="Save Config"
        variant="primary"
        onPress={handleSaveConfig}
        loading={updateConfig.isPending}
      />

      <Divider />

      {/* Feature Flags */}
      <View style={styles.section}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Feature Flags
        </ThemedText>

        {(flags ?? []).map((flag: any) => (
          <View key={flag.id} style={styles.flagRow}>
            <View style={styles.flagInfo}>
              <ThemedText variant="body" color="primary">
                {flag.flag_key}
              </ThemedText>
              {flag.description && (
                <ThemedText variant="small" color="muted">
                  {flag.description}
                </ThemedText>
              )}
            </View>
            <Switch
              value={flag.flag_value}
              onValueChange={() => handleToggleFlag(flag.id, flag.flag_value)}
              trackColor={{
                true: Theme.colors.status.success,
                false: Theme.colors.background.tertiary,
              }}
            />
          </View>
        ))}
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Theme.colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.lg,
  },
  section: {
    marginBottom: Theme.spacing.lg,
  },
  sectionTitle: {
    marginBottom: Theme.spacing.sm,
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  configLabel: {
    flex: 1,
  },
  configInput: {
    width: 120,
    backgroundColor: Theme.colors.background.input,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.sm,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    textAlign: 'right',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  flagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.layout.divider,
  },
  flagInfo: {
    flex: 1,
    marginRight: Theme.spacing.sm,
  },
});
