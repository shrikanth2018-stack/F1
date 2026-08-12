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
  Dimensions,
  Text,
  Linking,
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
import { useMyVendor } from '../hooks/useMyVendor';
import { useMyHub } from '../hooks/useDeliveryHubs';
import { useUIStore } from '../store/uiStore';
import { formatPhone, formatPrice } from '../utils/formatters';
import { assetUrl } from '../utils/assets';
import { openWhatsApp } from '../utils/links';
import { confirmDialog } from '../utils/confirmDialog';

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
    marginBottom: 4,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
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
  const isHubManager = session?.role === 'customer' && session?.assignedHubId != null;
  // Only fetches for an operator — the hook is disabled without the claim.
  const { data: myHub } = useMyHub();
  const isDriver = session?.isDriver === true;
  // A vendor is a customer-role profile with a vendors row, the same shape a
  // hub operator has. Read from the table rather than a JWT claim: the token
  // hook runs for every login of every user and has drifted before (BF-37).
  const { data: myVendor } = useMyVendor();

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
  }, [isVisible, opacity, translateY]);

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

  const handleQA = () => {
    close();
    Linking.openURL('https://1stone.in/faq').catch(() => {});
  };

  const handlePrivacy = () => {
    close();
    Linking.openURL(assetUrl('Privacy-Policy.pdf')).catch(() => {});
  };

  const handleTerms = () => {
    close();
    Linking.openURL(assetUrl('Terms.pdf')).catch(() => {});
  };

  const handleSignOut = async () => {
    close();
    const confirmed = await confirmDialog({
      title: 'Sign Out',
      message: 'Are you sure you want to sign out?',
      confirmLabel: 'Sign Out',
      destructive: true,
    });
    if (confirmed) signOut();
  };

  const userName = wallet?.fullName || (session?.user.phone
    ? formatPhone(session.user.phone)
    : 'Guest');
  const walletLabel = wallet
    ? `My Wallet  ${formatPrice(wallet.balance)}`
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
        {/* User name + gear → Edit Profile */}
        <View style={styles.nameSection}>
          <Text style={styles.userName}>{userName}</Text>
          <TouchableOpacity
            onPress={() => go('EditProfile')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
          >
            <Text style={styles.gearIcon}>{'⚙︎'}</Text>
          </TouchableOpacity>
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
          </IOSGroup>

          <IOSGroup>
            <IOSRow label={loyaltyLabel} onPress={() => go('LoyaltyPoints')} />
            {referralEnabled && (
              <>
                <InsetDivider />
                <IOSRow label="My Referrals" onPress={() => go('Referral')} />
              </>
            )}
          </IOSGroup>

          {isHubManager && (
            <IOSGroup>
              {/* Named, so an operator can confirm at a glance which hub this
                  account is attached to without opening the dashboard. */}
              <IOSRow
                label={myHub?.hub_name ? `My Hub · ${myHub.hub_name}` : 'My Hub Dashboard'}
                onPress={() => go('HubDashboard')}
              />
            </IOSGroup>
          )}

          {/* One entry whose destination follows the vendor's state: finish
              registering, or run the store once approved. */}
          {myVendor && (
            <IOSGroup>
              {myVendor.status === 'invited' || myVendor.status === 'submitted' ? (
                <IOSRow
                  label={myVendor.status === 'invited'
                    ? 'Complete vendor registration'
                    : 'Vendor registration — in review'}
                  onPress={() => go('VendorRegistration')}
                />
              ) : myVendor.status === 'rejected' ? null : (
                <IOSRow
                  label={myVendor.status === 'suspended' ? 'My Store (paused)' : 'My Store'}
                  onPress={() => go('VendorDashboard')}
                />
              )}
            </IOSGroup>
          )}

          {isDriver && (
            <IOSGroup>
              <IOSRow label="My Deliveries" onPress={() => go('DriverDashboard')} />
            </IOSGroup>
          )}

          <IOSGroup>
            <IOSRow label="FAQ" onPress={handleQA} />
            <InsetDivider />
            <IOSRow label="Help & Support" onPress={handleWhatsApp} />
            <InsetDivider />
            <IOSRow label="Rate the App" onPress={() => go('Feedback')} />
          </IOSGroup>

          <IOSGroup>
            <View style={[group.row, { justifyContent: 'center' }]}>
              <TouchableOpacity onPress={handlePrivacy} activeOpacity={0.55}>
                <Text style={[group.label, { fontSize: Theme.typography.sizes.body - 1 }]}>Privacy Policy</Text>
              </TouchableOpacity>
              <Text style={[group.label, { fontSize: Theme.typography.sizes.body - 1, color: Theme.colors.text.muted, paddingHorizontal: 12 }]}>|</Text>
              <TouchableOpacity onPress={handleTerms} activeOpacity={0.55}>
                <Text style={[group.label, { fontSize: Theme.typography.sizes.body - 1 }]}>Terms of Service</Text>
              </TouchableOpacity>
            </View>
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
    backgroundColor: Theme.colors.layout.black,
  },
  panel: {
    position: 'absolute',
    right: Theme.spacing.sm,
    width: PANEL_W,
    maxHeight: SCREEN_H * 0.82,
    backgroundColor: Theme.colors.background.primary,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: Theme.colors.layout.divider,
    overflow: 'hidden',
    shadowColor: Theme.colors.layout.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 16,
  },
  nameSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 0.5,
    borderBottomColor: Theme.colors.layout.divider,
    marginBottom: 4,
  },
  userName: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 3,
    color: Theme.colors.text.mint,
    fontWeight: '400',
  },
  gearIcon: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 14,
    color: Theme.colors.text.mint,
    fontWeight: '400',
  },
  scrollContent: {
    paddingBottom: 8,
  },
});
