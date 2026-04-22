/**
 * 1stOne F1 — Profile Popup
 * Top-right dropdown anchored below the profile button.
 * Simple fade + 6px slide — no bounce, no spring.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  StyleSheet,
  Alert,
  Dimensions,
  Text,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Theme } from '../theme';
import { useAuth } from '../hooks/useAuth';
import { useStoreConfig } from '../hooks/useStoreConfig';
import { useWalletBalance } from '../hooks/useWallet';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { useUIStore } from '../store/uiStore';
import { formatPhone, formatCurrency } from '../utils/formatters';
import { openWhatsApp } from '../utils/links';

const { height: SCREEN_H } = Dimensions.get('window');
const PANEL_W = 292;

// ── iOS grouped list primitives ──────────────────────────────

function IOSGroup({ children }: { children: React.ReactNode }) {
  return <View style={group.wrap}>{children}</View>;
}

function InsetDivider() {
  return <View style={group.divider} />;
}

function IOSRow({
  label,
  subtitle,
  onPress,
  destructive,
}: {
  label: string;
  subtitle?: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity style={[group.row, destructive && group.destructiveRow]} activeOpacity={0.55} onPress={onPress}>
      <View style={destructive ? undefined : { flex: 1 }}>
        <Text style={[group.label, destructive && group.destructiveLabel]}>{label}</Text>
        {subtitle ? <Text style={group.sub}>{subtitle}</Text> : null}
      </View>
      {!destructive && <Text style={group.chevron}>›</Text>}
    </TouchableOpacity>
  );
}

const group = StyleSheet.create({
  wrap: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  label: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 1,
    color: Theme.colors.text.primary,
    fontWeight: '400',
  },
  destructiveLabel: {
    color: Theme.colors.status.error,
  },
  destructiveRow: {
    justifyContent: 'center',
  },
  sub: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.micro + 1,
    color: Theme.colors.text.muted,
    marginTop: 2,
  },
  chevron: {
    color: Theme.colors.text.subtitle,
    fontSize: Theme.typography.sizes.body + 3,
  },
  divider: {
    height: 0.5,
    backgroundColor: Theme.colors.layout.divider,
    marginLeft: 14,
  },
});

// ── Profile Popup ────────────────────────────────────────────

export function ProfilePopup() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const { data: config } = useStoreConfig();
  const { data: wallet } = useWalletBalance();

  const isVisible = useUIStore((s) => s.isProfileVisible);
  const setProfileVisible = useUIStore((s) => s.setProfileVisible);
  const referralEnabled = useFeatureFlag('referral_system', true);

  const [modalMounted, setModalMounted] = useState(false);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-6);

  useEffect(() => {
    if (isVisible) {
      opacity.value = 0;
      translateY.value = -6;
      setModalMounted(true);
      requestAnimationFrame(() => {
        opacity.value = withTiming(1, { duration: 180 });
        translateY.value = withTiming(0, { duration: 180 });
      });
    } else {
      opacity.value = withTiming(0, { duration: 140 });
      translateY.value = withTiming(-6, { duration: 140 }, (finished) => {
        if (finished) runOnJS(setModalMounted)(false);
      });
    }
  }, [isVisible]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value * 0.55,
  }));

  const close = () => setProfileVisible(false);

  const go = (screen: string) => {
    close();
    setTimeout(() => navigation.navigate(screen), 120);
  };

  const handleWhatsApp = () => {
    close();
    openWhatsApp(config?.whatsapp_support_number);
  };

  const handleSignOut = () => {
    close();
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const userName = wallet?.fullName || (session?.user.phone
    ? formatPhone(session.user.phone)
    : 'Guest');
  const walletLabel = wallet
    ? `My Wallet  ${formatCurrency(wallet.balance)}`
    : 'My Wallet';
  const loyaltyLabel = wallet?.loyaltyPoints
    ? `My Loyalty Points · ${wallet.loyaltyPoints} pts`
    : 'My Loyalty Points';

  if (!modalMounted) return null;

  return (
    <Modal visible={modalMounted} transparent animationType="none" onRequestClose={close}>
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={close}>
        <Animated.View style={[StyleSheet.absoluteFillObject, styles.backdrop, backdropStyle]} />
      </TouchableWithoutFeedback>

      {/* Dropdown panel — top-right, below profile button */}
      <Animated.View style={[styles.panel, { top: insets.top + 52 }, panelStyle]}>
        {/* User name */}
        <View style={styles.nameSection}>
          <Text style={styles.userName}>{userName}</Text>
        </View>

        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <IOSGroup>
            <IOSRow label={walletLabel} onPress={() => go('Wallet')} />
            <InsetDivider />
            <IOSRow label="My Orders" onPress={() => go('Orders')} />
            <InsetDivider />
            <IOSRow label="My Subscriptions" onPress={() => go('Subscriptions')} />
            <InsetDivider />
            <IOSRow label="My Addresses" onPress={() => go('Addresses')} />
            <InsetDivider />
            <IOSRow label={loyaltyLabel} onPress={() => go('LoyaltyPoints')} />
          </IOSGroup>

          <IOSGroup>
            {referralEnabled && (
              <>
                <IOSRow label="Referrals" onPress={() => go('Referral')} />
                <InsetDivider />
              </>
            )}
            <IOSRow label="Rate the App" onPress={() => go('Feedback')} />
            <InsetDivider />
            <IOSRow label="Support / Help" onPress={handleWhatsApp} />
          </IOSGroup>

          <IOSGroup>
            <IOSRow label="Sign Out" onPress={handleSignOut} destructive />
          </IOSGroup>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: '#000000',
  },
  panel: {
    position: 'absolute',
    right: Theme.spacing.sm,
    width: PANEL_W,
    maxHeight: SCREEN_H * 0.65,
    backgroundColor: Theme.colors.background.primary,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: Theme.colors.layout.divider,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 16,
  },
  nameSection: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Theme.colors.layout.divider,
    marginBottom: 8,
  },
  userName: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 3,
    color: Theme.colors.text.mint,
    fontWeight: '400',
  },
  scrollContent: {
    paddingBottom: 12,
  },
});
