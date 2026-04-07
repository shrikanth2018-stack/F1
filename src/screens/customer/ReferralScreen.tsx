/**
 * 1stOne F1 — Referral Screen
 *
 * Share your referral code, enter someone else's code,
 * view referral history and rewards.
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
} from 'react-native';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { EmptyState } from '../../components/EmptyState';
import { Divider } from '../../components/Divider';
import {
  useMyReferralCode,
  useReferralSettings,
  useMyReferrals,
  useGenerateReferralCode,
  useApplyReferralCode,
} from '../../hooks/useReferrals';

export function ReferralScreen({ navigation }: { navigation: any }) {
  const [applyCode, setApplyCode] = useState('');
  const { data: myCode, isLoading: codeLoading } = useMyReferralCode();
  const { data: settings } = useReferralSettings();
  const { data: referrals } = useMyReferrals();
  const generateCode = useGenerateReferralCode();
  const applyReferral = useApplyReferralCode();

  const handleShare = async () => {
    if (!myCode) return;
    try {
      await Share.share({
        message: `Join 1stOne and get fresh vegetarian food delivered daily! Use my referral code: ${myCode}`,
      });
    } catch {
      // User cancelled share
    }
  };

  const handleGenerate = () => {
    generateCode.mutate(undefined, {
      onSuccess: (code) => {
        Alert.alert('Code Generated', `Your referral code is: ${code}`);
      },
      onError: (err) => {
        Alert.alert('Error', err.message);
      },
    });
  };

  const handleApply = () => {
    if (!applyCode.trim()) {
      Alert.alert('Error', 'Please enter a referral code');
      return;
    }
    applyReferral.mutate(applyCode.trim(), {
      onSuccess: () => {
        Alert.alert('Success', 'Referral code applied!');
        setApplyCode('');
      },
      onError: (err) => {
        Alert.alert('Error', err.message);
      },
    });
  };

  const completedCount = (referrals ?? []).filter((r) => r.status === 'completed').length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">{'< Back'}</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Referrals</ThemedText>
        <View style={{ width: 50 }} />
      </View>

      {/* My Code */}
      <View style={styles.codeCard}>
        <ThemedText variant="small" color="subtitle">
          Your Referral Code
        </ThemedText>
        {myCode ? (
          <>
            <ThemedText variant="title" color="primary" style={styles.codeText}>
              {myCode}
            </ThemedText>
            <ThemedButton
              title="Share Code"
              variant="primary"
              onPress={handleShare}
            />
          </>
        ) : (
          <ThemedButton
            title="Generate My Code"
            variant="primary"
            onPress={handleGenerate}
            loading={generateCode.isPending || codeLoading}
          />
        )}
      </View>

      {/* Rewards Info */}
      {settings?.is_active && (
        <View style={styles.rewardsCard}>
          <ThemedText variant="subtitle" color="primary">
            Rewards
          </ThemedText>
          <View style={styles.rewardRow}>
            <ThemedText variant="body" color="subtitle">You get</ThemedText>
            <ThemedText variant="body" color="primary">
              {settings.referrer_reward_points} pts + {'\u20B9'}{settings.referrer_wallet_credit}
            </ThemedText>
          </View>
          <View style={styles.rewardRow}>
            <ThemedText variant="body" color="subtitle">Friend gets</ThemedText>
            <ThemedText variant="body" color="primary">
              {settings.referee_reward_points} pts + {'\u20B9'}{settings.referee_wallet_credit}
            </ThemedText>
          </View>
        </View>
      )}

      <Divider />

      {/* Apply Code */}
      <View style={styles.applySection}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          Have a referral code?
        </ThemedText>
        <View style={styles.applyRow}>
          <TextInput
            style={styles.input}
            placeholder="Enter code"
            placeholderTextColor={Theme.colors.text.muted}
            value={applyCode}
            onChangeText={setApplyCode}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.applyBtn} onPress={handleApply}>
            <ThemedText variant="small" color="primary">
              {applyReferral.isPending ? '...' : 'Apply'}
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>

      <Divider />

      {/* Referral History */}
      <View style={styles.historySection}>
        <ThemedText variant="subtitle" color="primary" style={styles.sectionTitle}>
          My Referrals ({completedCount})
        </ThemedText>

        {(referrals ?? []).length === 0 ? (
          <EmptyState message="No referrals yet. Share your code!" />
        ) : (
          (referrals ?? []).map((ref) => (
            <View key={ref.id} style={styles.referralRow}>
              <View>
                <ThemedText variant="body" color="primary">
                  {ref.profiles?.full_name || ref.profiles?.phone_number || 'User'}
                </ThemedText>
                <ThemedText variant="small" color="muted">
                  {new Date(ref.created_at).toLocaleDateString('en-IN')}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor:
                      ref.status === 'completed'
                        ? Theme.colors.status.success
                        : Theme.colors.status.warning,
                  },
                ]}
              >
                <ThemedText variant="micro" color="primary">
                  {ref.status}
                </ThemedText>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { padding: Theme.spacing.md, paddingTop: Theme.spacing.xl + Theme.spacing.md, paddingBottom: Theme.spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Theme.spacing.md },
  codeCard: { backgroundColor: Theme.colors.background.secondary, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.lg, alignItems: 'center', marginBottom: Theme.spacing.md },
  codeText: { marginVertical: Theme.spacing.md, letterSpacing: 3 },
  rewardsCard: { backgroundColor: Theme.colors.background.secondary, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.md, marginBottom: Theme.spacing.md },
  rewardRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Theme.spacing.sm },
  applySection: { marginVertical: Theme.spacing.md },
  sectionTitle: { marginBottom: Theme.spacing.sm },
  applyRow: { flexDirection: 'row', gap: Theme.spacing.sm },
  input: { flex: 1, backgroundColor: Theme.colors.background.input, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.sm, color: Theme.colors.text.primary, fontFamily: Theme.typography.fontFamily, fontSize: Theme.typography.sizes.body },
  applyBtn: { backgroundColor: Theme.colors.action.primary, paddingHorizontal: Theme.spacing.md, borderRadius: Theme.components.inputRadius, justifyContent: 'center' },
  historySection: { marginVertical: Theme.spacing.md },
  referralRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: Theme.colors.layout.divider },
  statusBadge: { paddingHorizontal: Theme.spacing.sm, paddingVertical: 2, borderRadius: 6 },
});
