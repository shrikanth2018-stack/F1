/**
 * 1stOne F1 — Feedback Screen
 *
 * Blueprint Sec 5.2: after Delivered, customer rates individual items AND the
 * overall experience. Overall lives in app_feedback; per-item in order_item_ratings.
 *
 * When no orderId is supplied (opened from Profile → Rate the App), only
 * overall rating is shown.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '../../api/supabaseClient';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { useAuth } from '../../hooks/useAuth';
import { trackFeedbackSubmitted } from '../../utils/analytics';
import type { CustomerScreenProps } from '../../navigation/types';

interface OrderItemLite {
  id: number;
  item_name: string | null;
  quantity: number | null;
}

function StarRow({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map((s) => (
        <TouchableOpacity key={s} onPress={() => onChange(s)} activeOpacity={0.7}>
          <ThemedText
            variant="title"
            color="primary"
            style={[
              styles.star,
              { color: s <= value ? Theme.colors.status.warning : Theme.colors.text.muted },
            ]}
          >
            {s <= value ? '★' : '☆'}
          </ThemedText>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function FeedbackScreen({ navigation, route }: CustomerScreenProps<'Feedback'>) {
  const orderId: number | null = route?.params?.orderId ?? null;
  const { session } = useAuth();

  const [overallRating, setOverallRating] = useState(0);
  const [comments, setComments] = useState('');
  const [itemRatings, setItemRatings] = useState<Record<number, number>>({});

  // Load order items only when we have an orderId (per-item mode)
  const { data: items = [] } = useQuery({
    queryKey: ['feedback_items', orderId],
    queryFn: async (): Promise<OrderItemLite[]> => {
      if (orderId == null) return [];
      const { data, error } = await supabase
        .from('order_items')
        .select('id, item_name, quantity')
        .eq('order_id', orderId);
      if (error) throw error;
      return (data ?? []).filter((i) => i.item_name);
    },
    enabled: orderId != null,
    staleTime: 60_000,
  });

  const hasItemContext = orderId != null && items.length > 0;

  const submitFeedback = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not authenticated');
      if (overallRating === 0) throw new Error('Please give an overall rating');

      // Overall feedback row
      const { error: overallErr } = await supabase.from('app_feedback').insert({
        user_id: session.user.id,
        order_id: orderId,
        rating: overallRating,
        comments: comments.trim() || null,
      });
      if (overallErr) throw overallErr;

      // Per-item rows — only those where the user actually rated
      if (hasItemContext) {
        const rows = Object.entries(itemRatings)
          .filter(([, r]) => r > 0)
          .map(([order_item_id, rating]) => ({
            order_id: orderId,
            order_item_id: Number(order_item_id),
            user_id: session.user.id,
            rating,
          }));
        if (rows.length > 0) {
          const { error: itemErr } = await supabase.from('order_item_ratings').insert(rows);
          // Per-item insert is best-effort — overall feedback already saved.
          // Log but don't fail the user's submission if this errors.
          if (itemErr) console.error('[feedback] per-item insert failed:', itemErr.message);
        }
      }
    },
    onSuccess: () => {
      trackFeedbackSubmitted(overallRating);
      Alert.alert('Thank you!', 'Your feedback helps us improve.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    },
    onError: (err) => Alert.alert('Error', err.message),
  });

  const headingText = useMemo(
    () => (hasItemContext ? `Rate Order #${orderId}` : 'Rate the App'),
    [hasItemContext, orderId]
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <ThemedText variant="header" color="primary">{headingText}</ThemedText>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ThemedText variant="body" color="muted">Close</ThemedText>
          </TouchableOpacity>
        </View>

        {/* Per-item ratings — only when rating a specific order */}
        {hasItemContext && (
          <View style={styles.section}>
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>YOUR ITEMS</ThemedText>
            {items.map((item) => (
              <View key={item.id} style={styles.itemBlock}>
                <ThemedText variant="body" color="primary" style={styles.itemName}>
                  {item.item_name}
                  {item.quantity != null && item.quantity > 1 ? ` ×${item.quantity}` : ''}
                </ThemedText>
                <StarRow
                  value={itemRatings[item.id] ?? 0}
                  onChange={(n) => setItemRatings((prev) => ({ ...prev, [item.id]: n }))}
                />
              </View>
            ))}
            <View style={styles.hairline} />
          </View>
        )}

        {/* Overall */}
        <View style={styles.section}>
          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
            {hasItemContext ? 'OVERALL EXPERIENCE' : 'YOUR RATING'}
          </ThemedText>
          <ThemedText variant="body" color="subtitle" style={styles.question}>
            {hasItemContext ? 'How was the delivery overall?' : 'How would you rate 1stOne?'}
          </ThemedText>
          <StarRow value={overallRating} onChange={setOverallRating} />

          <TextInput
            style={styles.commentsInput}
            placeholder="Tell us more (optional)"
            placeholderTextColor={Theme.colors.text.muted}
            value={comments}
            onChangeText={setComments}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          <View style={styles.hairline} />

          <TouchableOpacity
            style={styles.submitRow}
            onPress={() => submitFeedback.mutate()}
            activeOpacity={0.6}
            disabled={submitFeedback.isPending}
          >
            {submitFeedback.isPending
              ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
              : <ThemedText variant="subtitle" color="mint">Submit Feedback  ›</ThemedText>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { paddingBottom: Theme.spacing.xl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  section: { padding: Theme.spacing.md },
  sectionLabel: { letterSpacing: 1, marginBottom: Theme.spacing.sm },
  question: { marginBottom: Theme.spacing.md },
  itemBlock: {
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  itemName: { marginBottom: Theme.spacing.xs },
  starsRow: {
    flexDirection: 'row',
    gap: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
  },
  star: { fontSize: 34 },
  commentsInput: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    color: Theme.colors.text.primary,
    paddingVertical: Theme.spacing.sm,
    minHeight: 80,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.text.mint,
    marginTop: Theme.spacing.lg,
  },
  submitRow: {
    paddingVertical: Theme.spacing.md,
    alignItems: 'flex-end',
  },
});
