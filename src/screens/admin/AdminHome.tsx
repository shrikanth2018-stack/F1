/**
 * 1stOne F1 — Admin Home
 *
 * Unified 2-tab admin page per blueprint Section 11.
 *
 * Header: Logo (left) + Sign Out (right) — shared across both tabs.
 * Tabs: Reports  |  Manage  — pipe-separated, same pattern as StaffDashboard.
 *
 * Reports: flat metrics, date range toggle, daily bar chart, drill-down rows.
 * Manage: iOS-settings-style list — each row navigates to its own screen.
 */

import React, { useState } from 'react';
import {
  View,
  Image,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { SettingsRow } from '../../components/SettingsRow';
import { useAuth } from '../../hooks/useAuth';
import { useRealtimeOrders } from '../../hooks/useRealtimeOrders';
import { useAdminStats } from '../../hooks/useAdminStats';
import { useBranchFilter } from '../../hooks/useBranchFilter';
import { useBranches } from '../../hooks/useBranches';
import { useBranchStore } from '../../store/branchStore';
import { confirmDialog } from '../../utils/confirmDialog';

type AdminTab = 'Reports' | 'Manage';

const LOGO_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/logo.png`;

// Font size constants — all Manage content is +2pt over base
const MR = Theme.typography.sizes.body + 2;   // manage row label
const MS = Theme.typography.sizes.small + 2;   // manage section label

/** SettingsRow pre-wired with Manage-tab font size */
function AdminRow(props: React.ComponentProps<typeof SettingsRow>) {
  return <SettingsRow {...props} labelSize={MR} />;
}

// ── Branch Row — settings-style row inside Manage tab ───
function BranchRow() {
  const { data: branches } = useBranches();
  const bf = useBranchFilter();
  const { setSelectedBranch, selectedBranchName } = useBranchStore();

  // Only super-admins (no branch_id in JWT) need this
  if (!bf.isSuperAdmin) return null;

  const label = selectedBranchName ?? 'All Branches';

  const handlePress = () => {
    const options: any[] = [
      { text: 'All Branches', onPress: () => setSelectedBranch(null, null) },
      ...(branches ?? []).map((b) => ({
        text: b.branch_name,
        onPress: () => setSelectedBranch(b.id, b.branch_name),
      })),
      { text: 'Cancel', style: 'cancel' },
    ];
    Alert.alert('Select Branch', 'Data will be filtered for:', options);
  };

  return (
    <AdminRow
      label="Viewing Branch"
      subtitle={label}
      showChevron
      onPress={handlePress}
    />
  );
}

// ── Reports Tab — clean list, today's number as subtext ──
function ReportsTab() {
  const navigation = useNavigation<any>();
  const { data: stats, isLoading, isError, refetch } = useAdminStats();

  if (isError) {
    return (
      <View style={styles.errorBox}>
        <ThemedText variant="body" color="muted" style={styles.rowText}>Could not load stats.</ThemedText>
        <TouchableOpacity onPress={() => refetch()} style={styles.retryLink}>
          <ThemedText variant="body" color="mint" style={styles.rowText}>Retry  ›</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabScroll}
      refreshControl={
        <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Theme.colors.action.primary} />
      }
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity style={styles.reportRow} onPress={() => navigation.navigate('OrderReport')}>
        <View>
          <ThemedText variant="body" color="primary" style={styles.rowText}>Orders</ThemedText>
          <ThemedText variant="small" color="muted" style={[styles.reportSub, styles.subText]}>
            {stats ? `${stats.todayOrders} today` : '—'}
          </ThemedText>
        </View>
        <ThemedText variant="body" color="muted" style={styles.rowText}>›</ThemedText>
      </TouchableOpacity>

      <TouchableOpacity style={styles.reportRow} onPress={() => navigation.navigate('RevenueReport')}>
        <View>
          <ThemedText variant="body" color="primary" style={styles.rowText}>Revenue</ThemedText>
          <ThemedText variant="small" color="muted" style={[styles.reportSub, styles.subText]}>
            {stats ? `₹${stats.todayRevenue.toLocaleString('en-IN')} today` : '—'}
          </ThemedText>
        </View>
        <ThemedText variant="body" color="muted" style={styles.rowText}>›</ThemedText>
      </TouchableOpacity>

      <TouchableOpacity style={styles.reportRow} onPress={() => navigation.navigate('SubscriptionReport')}>
        <View>
          <ThemedText variant="body" color="primary" style={styles.rowText}>Subscriptions</ThemedText>
          <ThemedText variant="small" color="muted" style={[styles.reportSub, styles.subText]}>
            {stats ? `${stats.activeSubscriptions} running` : '—'}
          </ThemedText>
        </View>
        <ThemedText variant="body" color="muted" style={styles.rowText}>›</ThemedText>
      </TouchableOpacity>

      <TouchableOpacity style={styles.reportRow} onPress={() => navigation.navigate('StaffReport')}>
        <View>
          <ThemedText variant="body" color="primary" style={styles.rowText}>Staff</ThemedText>
          <ThemedText variant="small" color="muted" style={[styles.reportSub, styles.subText]}>
            {stats ? `${stats.staffPresentToday} present today` : '—'}
          </ThemedText>
        </View>
        <ThemedText variant="body" color="muted" style={styles.rowText}>›</ThemedText>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.reportRow, styles.reportRowLast]} onPress={() => navigation.navigate('HubReport')}>
        <View>
          <ThemedText variant="body" color="primary" style={styles.rowText}>Hub Delivery</ThemedText>
          <ThemedText variant="small" color="muted" style={[styles.reportSub, styles.subText]}>
            Per-hub order counts & revenue
          </ThemedText>
        </View>
        <ThemedText variant="body" color="muted" style={styles.rowText}>›</ThemedText>
      </TouchableOpacity>

    </ScrollView>
  );
}

// ── Manage Tab ───────────────────────────────────────────
function ManageTab() {
  const navigation = useNavigation<any>();

  return (
    <ScrollView
      style={styles.tabContent}
      contentContainerStyle={styles.tabScroll}
      showsVerticalScrollIndicator={false}
    >
      {/* BRANCH — visible to super-admins only */}
      <BranchRow />
      <AdminRow label="Manage Running Orders" showChevron onPress={() => navigation.navigate('AdminOrders')} />
      <AdminRow label="Manage Running Subscriptions" showChevron onPress={() => navigation.navigate('AdminSubscriptions')} />

      <Divider />

      {/* MENU */}
      <View style={styles.section}>
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>MENU</ThemedText>
      </View>

      <AdminRow label="Menu Manager" showChevron onPress={() => navigation.navigate('MenuManage')} />
      <AdminRow label="Essentials Manager" showChevron onPress={() => navigation.navigate('EssentialsCatalogManage')} />
      <AdminRow label="Subscriptions Manager" showChevron onPress={() => navigation.navigate('PlansManage')} />

      <Divider />

      {/* DELIVERY */}
      <View style={styles.section}>
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>DELIVERY</ThemedText>
      </View>
      <AdminRow label="Delivery Manager" showChevron onPress={() => navigation.navigate('DeliveryManage')} />

      <Divider />

      {/* NOTIFICATIONS */}
      <View style={styles.section}>
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>NOTIFICATIONS</ThemedText>
      </View>
      <AdminRow label="Note to Staff" showChevron onPress={() => navigation.navigate('PushNotifications')} />
      <AdminRow label="Manage Notifications" showChevron onPress={() => navigation.navigate('NotificationManager')} />

      <Divider />

      {/* MARKETING */}
      <View style={styles.section}>
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>MARKETING</ThemedText>
      </View>
      <AdminRow label="Special Offer Banner" showChevron onPress={() => navigation.navigate('CustomerPush')} />
      <AdminRow label="App + Website Backgrounds" showChevron onPress={() => navigation.navigate('LoginBg')} />
      <AdminRow label="Referral Settings" showChevron onPress={() => navigation.navigate('ReferralSettings')} />
      <AdminRow label="Customer Feedback" showChevron onPress={() => navigation.navigate('CustomerFeedback')} />

      <Divider />

      {/* RESOURCES */}
      <View style={styles.section}>
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>RESOURCES</ThemedText>
      </View>
      <AdminRow label="Resource Manager" showChevron onPress={() => navigation.navigate('ResourceManager')} />

      <Divider />

      {/* FINANCE */}
      <View style={styles.section}>
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>FINANCE</ThemedText>
      </View>
      <AdminRow label="Expense Manager" showChevron onPress={() => navigation.navigate('ExpenseManager')} />
      <AdminRow label="Stock Manager" showChevron onPress={() => navigation.navigate('StockManager')} />

      <Divider />

      {/* OPERATIONS */}
      <View style={styles.section}>
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>OPERATIONS</ThemedText>
      </View>
      <AdminRow label="Operations Manager" showChevron onPress={() => navigation.navigate('StoreConfig')} />

      <Divider />

    </ScrollView>
  );
}

// ── Admin Home ───────────────────────────────────────────
export function AdminHome() {
  const [activeTab, setActiveTab] = useState<AdminTab>('Reports');
  const { signOut } = useAuth();

  useRealtimeOrders(true);

  const handleSignOut = async () => {
    const confirmed = await confirmDialog({
      title: 'Sign Out',
      message: 'Are you sure?',
      confirmLabel: 'Sign Out',
      destructive: true,
    });
    if (confirmed) signOut();
  };

  const TABS: AdminTab[] = ['Reports', 'Manage'];

  return (
    <SafeAreaView style={styles.container}>
      {/* Shared header: logo + sign out */}
      <View style={styles.header}>
        <Image source={{ uri: LOGO_URL }} style={styles.logo} resizeMode="contain" />
        <TouchableOpacity onPress={handleSignOut}>
          <ThemedText variant="body" color="muted">Sign Out</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Pipe-separated top tabs */}
      <View style={styles.topTabs}>
        {TABS.map((tab, idx) => (
          <React.Fragment key={tab}>
            {idx > 0 && (
              <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>
            )}
            <TouchableOpacity style={styles.topTab} onPress={() => setActiveTab(tab)}>
              <ThemedText
                variant="body"
                color={activeTab === tab ? 'primary' : 'muted'}
                style={[styles.tabText, activeTab === tab && styles.tabTextActive]}
              >
                {tab}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      {/* Tab content */}
      {activeTab === 'Reports' ? <ReportsTab /> : <ManageTab />}
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
  },
  logo: { width: 60, height: 44 },

  topTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: Theme.spacing.sm,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4 },
  topTab: { paddingHorizontal: Theme.spacing.sm },
  tabText: { fontSize: Theme.typography.sizes.body + 8 },
  tabTextActive: { fontWeight: '600' },

  tabContent: { flex: 1 },
  tabScroll: { paddingBottom: Theme.spacing.xl * 2 },

  section: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
  },
  sectionLabel: { letterSpacing: 1, marginBottom: Theme.spacing.xs, fontSize: MS },

  reportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  reportRowLast: { borderBottomWidth: 0 },
  reportSub: { marginTop: 2 },
  rowText: { fontSize: Theme.typography.sizes.body + 2 },
  subText: { fontSize: Theme.typography.sizes.small + 2 },

  errorBox: {
    padding: Theme.spacing.md,
    gap: Theme.spacing.sm,
  },
  retryLink: { marginTop: Theme.spacing.xs },
});
