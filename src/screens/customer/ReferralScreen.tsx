/**
 * 1stOne F1 — Referral Screen (Customer)
 *
 * Shows:
 *  - My referral code (generate / share)
 *  - How-it-works reward tiers
 *  - Milestone badge progress (Star / Ambassador)
 *  - Apply a code (if not yet referred)
 *  - My referrals list with per-row status
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Share,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import {
  useMyReferralCode,
  useReferralSettings,
  useMyReferrals,
  useGenerateReferralCode,
  useApplyReferralCode,
  REFERRAL_DEFAULTS,
} from '../../hooks/useReferrals';
import { formatDateShort } from '../../utils/formatters';
import { trackReferralApplied, trackReferralShared } from '../../utils/analytics';
import type { CustomerNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

const STATUS_LABEL: Record<string, string> = {
  pending:          'Signed up',
  first_order_done: 'Ordered ✓',
  month_complete:   'Month done ✓',
  expired:          'Expired',
};

const STATUS_COLOR: Record<string, string> = {
  pending:          Theme.colors.text.muted,
  first_order_done: Theme.colors.status.warning,
  month_complete:   Theme.colors.text.mint,
  expired:          Theme.colors.text.muted,
};

// ── Milestone progress bar ────────────────────────────────────
function MilestoneRow({
  label,
  badge,
  current,
  target,
}: {
  label: string;
  badge: string;
  current: number;
  target: number;
}) {
  const pct = Math.min(current / target, 1);
  const reached = current >= target;
  return (
    <View style={ms.row}>
      <ThemedText variant="body" color={reached ? 'mint' : 'primary'} style={ms.badge}>
        {badge}
      </ThemedText>
      <View style={ms.right}>
        <View style={ms.labelRow}>
          <ThemedText variant="body" color={reached ? 'mint' : 'primary'} style={ms.label}>
            {label}
          </ThemedText>
          <ThemedText variant="small" color="muted" style={ms.count}>
            {current}/{target}
          </ThemedText>
        </View>
        <View style={ms.track}>
          <View style={[ms.fill, { width: `${Math.round(pct * 100)}%` as any }]} />
        </View>
        {reached && (
          <ThemedText variant="small" color="mint" style={ms.earned}>Achieved!</ThemedText>
        )}
      </View>
    </View>
  );
}

const ms = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Theme.spacing.md },
  badge: { fontSize: B + 6, width: 36 },
  right: { flex: 1 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { fontSize: B },
  count: { fontSize: S },
  track: {
    height: 4,
    backgroundColor: Theme.colors.background.tertiary,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    backgroundColor: Theme.colors.text.mint,
    borderRadius: 2,
  },
  earned: { fontSize: S, marginTop: 3 },
});

// ── Main screen ───────────────────────────────────────────────
export function ReferralScreen({ navigation }: { navigation: CustomerNavProp }) {
  const [applyCode, setApplyCode] = useState('');
  const { data: myCode, isLoading: codeLoading } = useMyReferralCode();
  const { data: settings } = useReferralSettings();
  const { data: referrals = [] } = useMyReferrals();
  const generateCode = useGenerateReferralCode();
  const applyReferral = useApplyReferralCode();

  const g = (key: keyof typeof REFERRAL_DEFAULTS): number =>
    (settings?.[key as keyof typeof settings] as number) ??
    (REFERRAL_DEFAULTS[key] as number) ?? 0;

  const orderedCount = referrals.filter(
    (r) => r.status === 'first_order_done' || r.status === 'month_complete'
  ).length;

  const starTarget   = g('milestone_star_count');
  const ambassTarget = g('milestone_ambassador_count');

  const handleShare = async () => {
    if (!myCode) return;
    try {
      // Deep link: opens the app directly to the signup screen with code pre-filled.
      // Format: 1stone://referral?code=XXXXX
      // Falls back gracefully on devices without the app installed (shows as plain text).
      const deepLink = `1stone://referral?code=${myCode}`;
      const credit = g('referee_signup_credit');
      const result = await Share.share({
        title: 'Join 1stOne — Fresh food daily!',
        message: `Join 1stOne and get fresh food delivered daily!\nUse my referral code: ${myCode} — you get ₹${credit} wallet credit on signup!\n\nDownload & use code: ${deepLink}`,
        url: deepLink, // iOS share sheet uses url separately
      });
      if (result.action === Share.sharedAction) {
        trackReferralShared();
      }
    } catch {}
  };

  const handleGenerate = () =>
    generateCode.mutate(undefined, {
      onSuccess: (code) => Alert.alert('Code Generated', `Your referral code is: ${code}`),
      onError: (err: any) => Alert.alert('Error', err.message),
    });

  const handleApply = () => {
    if (!applyCode.trim()) return;
    applyReferral.mutate(applyCode.trim(), {
      onSuccess: () => {
        trackReferralApplied(applyCode.trim());
        Alert.alert('', 'Referral code applied!');
        setApplyCode('');
      },
      onError: (err: any) => Alert.alert('Error', err.message),
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText variant="header" color="primary" style={styles.title}>Referrals</ThemedText>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ThemedText variant="body" color="muted">Close</ThemedText>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* MY CODE */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          YOUR REFERRAL CODE
        </ThemedText>
        {codeLoading ? (
          <ActivityIndicator color={Theme.colors.text.mint} style={styles.padV} />
        ) : myCode ? (
          <View style={styles.codeRow}>
            <ThemedText variant="title" color="mint" style={styles.codeText}>{myCode}</ThemedText>
            <TouchableOpacity onPress={handleShare} activeOpacity={0.6}>
              <ThemedText variant="body" color="accent" style={styles.shareLink}>Share  ›</ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={handleGenerate}
            activeOpacity={0.6}
            disabled={generateCode.isPending}
            style={styles.padV}
          >
            {generateCode.isPending
              ? <ActivityIndicator color={Theme.colors.text.mint} />
              : <ThemedText variant="body" color="mint" style={styles.txt}>Generate my code  ›</ThemedText>
            }
          </TouchableOpacity>
        )}

        <Divider />

        {/* HOW IT WORKS */}
        {settings?.is_active && (
          <>
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
              HOW IT WORKS
            </ThemedText>
            <View style={styles.tierTable}>
              {/* Friend signs up */}
              <View style={styles.tierRow}>
                <ThemedText variant="body" color="muted" style={styles.tierWho}>Friend signs up</ThemedText>
                <ThemedText variant="body" color="primary" style={styles.tierVal}>
                  Friend gets ₹{g('referee_signup_credit')} wallet credit
                  {g('referee_reward_points') > 0 ? ` + ${g('referee_reward_points')} pts` : ''}
                </ThemedText>
              </View>
              {/* Friend places first order */}
              <View style={styles.tierRow}>
                <ThemedText variant="body" color="muted" style={styles.tierWho}>Friend orders</ThemedText>
                <ThemedText variant="body" color="primary" style={styles.tierVal}>
                  You get {g('referrer_first_order_points')} pts
                  {g('referrer_first_order_credit') > 0 ? ` + ₹${g('referrer_first_order_credit')}` : ''}
                </ThemedText>
              </View>
              {/* After 30 days */}
              {g('referrer_month_credit') > 0 && (
                <View style={styles.tierRow}>
                  <ThemedText variant="body" color="muted" style={styles.tierWho}>After 30 days</ThemedText>
                  <ThemedText variant="body" color="primary" style={styles.tierVal}>
                    You get ₹{g('referrer_month_credit')} bonus
                  </ThemedText>
                </View>
              )}
            </View>
            <Divider />
          </>
        )}

        {/* MILESTONES */}
        {settings?.is_active && referrals.length > 0 && (
          <>
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
              MILESTONES
            </ThemedText>
            <View style={styles.milestoneWrap}>
              <MilestoneRow
                label="Star Referrer"
                badge="★"
                current={orderedCount}
                target={starTarget}
              />
              <MilestoneRow
                label="Ambassador"
                badge="⚡"
                current={orderedCount}
                target={ambassTarget}
              />
            </View>
            <Divider />
          </>
        )}

        {/* APPLY CODE */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          HAVE A CODE?
        </ThemedText>
        <View style={styles.applyRow}>
          <TextInput
            style={styles.applyInput}
            placeholder="Enter referral code"
            placeholderTextColor={Theme.colors.text.muted}
            value={applyCode}
            onChangeText={setApplyCode}
            autoCapitalize="characters"
            returnKeyType="done"
            onSubmitEditing={handleApply}
          />
          <TouchableOpacity onPress={handleApply} activeOpacity={0.6} disabled={applyReferral.isPending}>
            {applyReferral.isPending
              ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
              : <ThemedText variant="body" color="mint" style={styles.txt}>Apply  ›</ThemedText>
            }
          </TouchableOpacity>
        </View>

        <Divider />

        {/* MY REFERRALS */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          MY REFERRALS  ({referrals.length})
        </ThemedText>
        {referrals.length === 0 ? (
          <ThemedText variant="body" color="muted" style={styles.empty}>
            No referrals yet — share your code!
          </ThemedText>
        ) : (
          referrals.map((ref) => {
            const name = ref.profiles?.full_name || ref.profiles?.phone_number || 'User';
            const status = ref.status as string;
            return (
              <View key={ref.id} style={styles.refRow}>
                <View style={styles.refLeft}>
                  <ThemedText variant="body" color="primary" style={styles.txt}>{name}</ThemedText>
                  <ThemedText variant="small" color="muted" style={{ fontSize: S }}>
                    {formatDateShort(ref.created_at)}
                  </ThemedText>
                </View>
                <ThemedText
                  variant="small"
                  color="muted"
                  style={{ fontSize: S, color: STATUS_COLOR[status] ?? Theme.colors.text.muted }}
                >
                  {STATUS_LABEL[status] ?? status}
                </ThemedText>
              </View>
            );
          })
        )}
      </ScrollView>
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
  title:  { flex: 1, textAlign: 'left' },

  scroll: { paddingBottom: Theme.spacing.xl * 2 },

  sectionLabel: {
    fontSize: S,
    letterSpacing: 1,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },

  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  codeText:  { letterSpacing: 4, fontSize: B + 8 },
  shareLink: { fontSize: B },

  padV: { paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm },

  tierTable: { paddingHorizontal: Theme.spacing.md },
  tierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  tierWho: { fontSize: B, flex: 0.45 },
  tierVal: { fontSize: B, flex: 0.55, textAlign: 'right' },

  milestoneWrap: { paddingHorizontal: Theme.spacing.md, paddingTop: Theme.spacing.sm },

  applyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  applyInput: {
    flex: 1,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    color: Theme.colors.text.primary,
    paddingVertical: Theme.spacing.sm,
  },

  refRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  refLeft: { flex: 1, marginRight: Theme.spacing.sm },

  empty: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    fontSize: B,
  },

  txt: { fontSize: B },
});
