/**
 * 1stOne F1 — Profile Popup
 *
 * Semi-transparent overlay that drops down from the profile button
 * (top-right anchored). NOT a bottom sheet. NOT a full-screen tab.
 *
 * Contains: user name/phone, wallet, orders, subscriptions,
 * addresses, rate, support, sign out.
 * Tapping backdrop or "Close" dismisses.
 */

import React from 'react';
import {
  View,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';
import { Divider } from './Divider';
import { useAuth } from '../hooks/useAuth';
import { useStoreConfig } from '../hooks/useStoreConfig';
import { useWalletBalance } from '../hooks/useWallet';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { useUIStore } from '../store/uiStore';
import { formatPhone, formatCurrency } from '../utils/formatters';
import { openWhatsApp } from '../utils/links';

function PopupRow({
  label,
  subtitle,
  onPress,
}: {
  label: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.6} onPress={onPress}>
      <ThemedText variant="body" color="primary">
        {label}
      </ThemedText>
      {subtitle ? (
        <ThemedText variant="small" color="muted">
          {subtitle}
        </ThemedText>
      ) : null}
    </TouchableOpacity>
  );
}

export function ProfilePopup() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const { data: config } = useStoreConfig();
  const { data: wallet } = useWalletBalance();

  const isVisible = useUIStore((s) => s.isProfileVisible);
  const setProfileVisible = useUIStore((s) => s.setProfileVisible);
  const referralEnabled = useFeatureFlag('referral_system');

  const close = () => setProfileVisible(false);

  const go = (screen: string) => {
    close();
    setTimeout(() => navigation.navigate(screen), 150);
  };

  const handleWhatsApp = () => {
    close();
    openWhatsApp(config?.whatsapp_support_number);
  };

  const handleSignOut = () => {
    close();
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: signOut },
    ]);
  };

  const userName = wallet?.fullName || (session?.user.phone
    ? formatPhone(session.user.phone)
    : 'Guest');
  const walletLabel = wallet
    ? `My Wallet ${formatCurrency(wallet.balance)}`
    : 'My Wallet';
  const loyaltyLabel = wallet?.loyaltyPoints
    ? `Loyalty Points · ${wallet.loyaltyPoints}`
    : 'Loyalty Points';

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <TouchableWithoutFeedback onPress={close}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      {/* Popup anchored top-right, below header (safe-area + header height) */}
      <View style={[styles.popup, { top: insets.top + 70 }]}>
        <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
          {/* User info */}
          <View style={styles.userSection}>
            <ThemedText variant="subtitle" color="mint" style={styles.userName}>
              {userName}
            </ThemedText>
          </View>

          <Divider />

          <PopupRow label={walletLabel} onPress={() => go('Wallet')} />
          <PopupRow label="My Orders" onPress={() => go('Orders')} />
          <PopupRow label="My Subscriptions" onPress={() => go('Subscriptions')} />
          <PopupRow label="My Addresses" onPress={() => go('Addresses')} />
          <PopupRow label={loyaltyLabel} onPress={() => go('LoyaltyPoints')} />

          <Divider />

          {referralEnabled && <PopupRow label="Referrals" onPress={() => go('Referral')} />}
          <PopupRow label="Rate the App" onPress={() => go('Feedback')} />
          <PopupRow label="Support / Help" onPress={handleWhatsApp} />
        </ScrollView>

        {/* Footer always visible outside scroll */}
        <Divider />
        <View style={styles.footerRow}>
          <TouchableOpacity onPress={close} style={styles.footerBtn}>
            <ThemedText variant="body" color="muted">
              Close
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSignOut} style={styles.footerBtn}>
            <ThemedText variant="body" color="primary" style={styles.logoutText}>
              Logout
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  popup: {
    position: 'absolute',
    // top is set dynamically via inline style using useSafeAreaInsets
    right: Theme.spacing.md,
    width: 220,
    maxHeight: 500,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    overflow: 'hidden',
    // subtle shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  userSection: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  userName: {
    fontSize: Theme.typography.sizes.subtitle + 2,
  },
  row: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  footerBtn: {
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
  },
  logoutText: {
    color: Theme.colors.status.error,
  },
});
