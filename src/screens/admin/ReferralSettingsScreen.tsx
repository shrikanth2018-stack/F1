/**
 * 1stOne F1 — Referral Settings Screen (Admin)
 *
 * Configure every tier of the referral programme + view live referral table.
 *
 * Sections:
 *  PROGRAMME  — master on/off toggle
 *  REFEREE    — signup credit (₹) + points
 *  REFERRER   — first-order bonus (pts + ₹) + month bonus (₹)
 *  MILESTONES — Star / Ambassador thresholds
 *  REFERRALS  — live table with 3 tabs: Pending | Ordered | Month Done
 *               Each row has "Issue Month Bonus ›" when eligible
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import {
  useReferralSettings,
  useUpdateReferralSettings,
  useAllReferrals,
  useIssueMonthBonus,
  REFERRAL_DEFAULTS,
} from '../../hooks/useReferrals';
import type { ReferralSettings } from '../../types';
import { formatDateShort } from '../../utils/formatters';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type ReferralTab = 'Pending' | 'Ordered' | 'Month Done';
const REF_TABS: ReferralTab[] = ['Pending', 'Ordered', 'Month Done'];

// ── Editable number field ────────────────────────────────────
function NumField({
  label,
  value,
  prefix = '',
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && n >= 0) onChange(n);
    else setDraft(String(value));
  };

  return (
    <View style={nf.row}>
      <ThemedText variant="body" color="primary" style={nf.label}>{label}</ThemedText>
      <View style={nf.inputWrap}>
        {!!prefix && <ThemedText variant="body" color="muted" style={nf.affix}>{prefix}</ThemedText>}
        <TextInput
          style={nf.input}
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="numeric"
          returnKeyType="done"
        />
        {!!suffix && <ThemedText variant="body" color="muted" style={nf.affix}>{suffix}</ThemedText>}
      </View>
    </View>
  );
}

const nf = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  label: { fontSize: B, flex: 1 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  affix: { fontSize: B, color: Theme.colors.text.muted },
  input: {
    color: Theme.colors.text.mint,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    minWidth: 60,
    textAlign: 'right',
    paddingVertical: 2,
  },
});

// ── Referral row ─────────────────────────────────────────────
function ReferralRow({
  item,
  tab,
}: {
  item: any;
  tab: ReferralTab;
}) {
  const issueBonus = useIssueMonthBonus();
  const referrerName = item.referrer?.full_name || item.referrer?.phone_number || '—';
  const refereeName = item.referee?.full_name || item.referee?.phone_number || '—';

  const daysSince = Math.floor(
    (Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );
  const monthEligible = tab === 'Ordered' && daysSince >= 30 && !item.month_reward_given;

  const handleIssueMonth = () => {
    Alert.alert(
      'Issue Month Bonus',
      `Credit month completion bonus to ${referrerName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Issue',
          onPress: () =>
            issueBonus.mutate(
              { referralId: item.id, referrerId: item.referrer_id },
              { onError: (e: any) => Alert.alert('Error', e?.message) }
            ),
        },
      ]
    );
  };

  return (
    <View style={rr.container}>
      <View style={rr.row}>
        <View style={rr.names}>
          <ThemedText variant="body" color="primary" style={rr.name}>{referrerName}</ThemedText>
          <ThemedText variant="small" color="muted" style={rr.arrow}>→ {refereeName}</ThemedText>
        </View>
        <ThemedText variant="small" color="muted" style={rr.date}>
          {formatDateShort(item.created_at)}
        </ThemedText>
      </View>
      {monthEligible && (
        <TouchableOpacity onPress={handleIssueMonth} disabled={issueBonus.isPending} activeOpacity={0.7}>
          <ThemedText variant="small" color="mint" style={rr.bonusLink}>
            {issueBonus.isPending ? 'Issuing…' : `Issue month bonus  ›  (day ${daysSince})`}
          </ThemedText>
        </TouchableOpacity>
      )}
      {tab === 'Ordered' && !monthEligible && (
        <ThemedText variant="small" color="muted" style={rr.bonusLink}>
          Month bonus eligible in {30 - daysSince} day{30 - daysSince !== 1 ? 's' : ''}
        </ThemedText>
      )}
    </View>
  );
}

const rr = StyleSheet.create({
  container: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  names: { flex: 1, marginRight: Theme.spacing.sm },
  name: { fontSize: B },
  arrow: { fontSize: S, marginTop: 2 },
  date: { fontSize: S },
  bonusLink: { fontSize: S, marginTop: Theme.spacing.xs },
});

// ── Main screen ──────────────────────────────────────────────
export function ReferralSettingsScreen({ navigation }: { navigation: AdminNavProp }) {
  const { data: savedSettings, isLoading } = useReferralSettings();
  const updateSettings = useUpdateReferralSettings();
  const { data: allReferrals = [], isLoading: refLoading, refetch } = useAllReferrals();

  const [s, setS] = useState<Partial<ReferralSettings>>({});
  const [refTab, setRefTab] = useState<ReferralTab>('Pending');

  useEffect(() => {
    if (savedSettings) setS(savedSettings);
  }, [savedSettings]);

  const set = (key: keyof ReferralSettings, val: any) =>
    setS((prev) => ({ ...prev, [key]: val }));

  const g = (key: keyof ReferralSettings, fallback: number): number =>
    (s[key] as number) ?? (REFERRAL_DEFAULTS[key] as number) ?? fallback;

  const filteredReferrals = useMemo(() => {
    if (refTab === 'Pending') return allReferrals.filter((r) => r.status === 'pending');
    if (refTab === 'Ordered') return allReferrals.filter((r) => r.status === 'first_order_done');
    return allReferrals.filter((r) => r.status === 'month_complete');
  }, [allReferrals, refTab]);

  const handleSave = () => {
    updateSettings.mutate(s, {
      onSuccess: () => Alert.alert('Saved', 'Referral settings updated.'),
      onError: (e: any) => Alert.alert('Error', e?.message),
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Theme.colors.text.mint} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Referral Settings
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* PROGRAMME */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>PROGRAMME</ThemedText>
        <View style={styles.switchRow}>
          <ThemedText variant="body" color="primary" style={styles.txt}>Referral program active</ThemedText>
          <Switch
            value={s.is_active ?? false}
            onValueChange={(v) => set('is_active', v)}
            trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
            thumbColor={Theme.colors.text.primary}
          />
        </View>

        <Divider />

        {/* REFEREE */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          REFEREE  (new customer, on signup)
        </ThemedText>
        <NumField label="Wallet credit" prefix="₹" value={g('referee_signup_credit', 50)}
          onChange={(n) => set('referee_signup_credit', n)} />
        <NumField label="Loyalty points" suffix="pts" value={g('referee_reward_points', 0)}
          onChange={(n) => set('referee_reward_points', n)} />

        <Divider />

        {/* REFERRER — FIRST ORDER */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          REFERRER  (when friend places first order)
        </ThemedText>
        <NumField label="Loyalty points" suffix="pts" value={g('referrer_first_order_points', 100)}
          onChange={(n) => set('referrer_first_order_points', n)} />
        <NumField label="Wallet credit" prefix="₹" value={g('referrer_first_order_credit', 30)}
          onChange={(n) => set('referrer_first_order_credit', n)} />

        <Divider />

        {/* REFERRER — MONTH BONUS */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          REFERRER  (after friend's first month)
        </ThemedText>
        <NumField label="Month bonus" prefix="₹" value={g('referrer_month_credit', 100)}
          onChange={(n) => set('referrer_month_credit', n)} />

        <Divider />

        {/* MILESTONES */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>MILESTONES</ThemedText>
        <NumField label="★  Star Referrer at" suffix="friends" value={g('milestone_star_count', 3)}
          onChange={(n) => set('milestone_star_count', n)} />
        <NumField label="⚡ Ambassador at" suffix="friends" value={g('milestone_ambassador_count', 5)}
          onChange={(n) => set('milestone_ambassador_count', n)} />

        <Divider />

        {/* REFERRALS TABLE */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>REFERRALS</ThemedText>

        {/* Sub-tabs */}
        <View style={styles.subTabs}>
          {REF_TABS.map((tab, idx) => (
            <React.Fragment key={tab}>
              {idx > 0 && (
                <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>
              )}
              <TouchableOpacity onPress={() => setRefTab(tab)}>
                <ThemedText
                  variant="body"
                  color={refTab === tab ? 'primary' : 'muted'}
                  style={[styles.subTabTxt, refTab === tab && styles.subTabActive]}
                >
                  {tab}
                </ThemedText>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>

        {filteredReferrals.length === 0 ? (
          <EmptyState title={`No ${refTab.toLowerCase()} referrals`} />
        ) : (
          filteredReferrals.map((item) => (
            <ReferralRow key={item.id} item={item} tab={refTab} />
          ))
        )}
      </ScrollView>

      {/* Save footer */}
      <TouchableOpacity
        style={styles.footer}
        onPress={handleSave}
        disabled={updateSettings.isPending}
        activeOpacity={0.7}
      >
        {updateSettings.isPending
          ? <ActivityIndicator color={Theme.colors.text.mint} />
          : <ThemedText variant="body" color="mint" style={styles.txt}>Save Settings  ›</ThemedText>
        }
      </TouchableOpacity>
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
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  scroll: { paddingBottom: Theme.spacing.xl * 2 },

  sectionLabel: {
    fontSize: S,
    letterSpacing: 1,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },

  subTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  subTabTxt: { fontSize: B },
  subTabActive: { fontWeight: '600' },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },

  txt: { fontSize: B },
});
