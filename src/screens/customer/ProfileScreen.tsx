/**
 * 1stOne F1 — Customer Profile Screen (Placeholder)
 * Will show: user info, addresses, wallet, support, sign out
 */

import React from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { SettingsRow } from '../../components/SettingsRow';
import { Divider } from '../../components/Divider';
import { ThemedButton } from '../../components/ThemedButton';
import { useAuth } from '../../hooks/useAuth';
import { useStoreConfig } from '../../hooks/useStoreConfig';
import { useWalletBalance } from '../../hooks/useWallet';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { formatPhone, formatCurrency } from '../../utils/formatters';
import { openWhatsApp } from '../../utils/links';

export function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { session, signOut } = useAuth();
  const { data: config } = useStoreConfig();
  const { data: wallet } = useWalletBalance();
  const referralEnabled = useFeatureFlag('referral_system');
  const essentialsEnabled = useFeatureFlag('essentials_module_active');

  const handleWhatsApp = () => {
    openWhatsApp(config?.whatsapp_support_number);
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const walletSubtitle = wallet
    ? `${formatCurrency(wallet.balance)} · ${wallet.loyaltyPoints} pts`
    : '';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <ThemedText variant="header" color="primary" style={styles.header}>
        Profile
      </ThemedText>

      {session && (
        <ThemedText variant="body" color="subtitle" style={styles.phone}>
          {formatPhone(session.user.phone)}
        </ThemedText>
      )}

      <Divider />

      <SettingsRow
        label="My Addresses"
        showChevron
        onPress={() => navigation.navigate('AddAddress')}
      />
      <SettingsRow
        label="Wallet"
        subtitle={walletSubtitle}
        showChevron
        onPress={() => navigation.navigate('Wallet')}
      />
      {referralEnabled && (
        <SettingsRow
          label="Referrals"
          showChevron
          onPress={() => navigation.navigate('Referral')}
        />
      )}
      {essentialsEnabled && (
        <SettingsRow
          label="Essentials"
          subtitle="Daily essentials"
          showChevron
          onPress={() => navigation.navigate('Essentials')}
        />
      )}

      <Divider />

      <SettingsRow
        label="WhatsApp Support"
        subtitle={config?.whatsapp_support_number || ''}
        onPress={handleWhatsApp}
      />
      <SettingsRow
        label="App Feedback"
        showChevron
        onPress={() => navigation.navigate('Feedback')}
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
    paddingTop: Theme.spacing.xl,
  },
  header: {
    marginBottom: Theme.spacing.xs,
  },
  phone: {
    marginBottom: Theme.spacing.md,
  },
  signOut: {
    marginTop: Theme.spacing.xl,
    alignItems: 'center',
  },
});
