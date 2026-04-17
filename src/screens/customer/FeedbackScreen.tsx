/**
 * 1stOne F1 — App Feedback Screen
 * Plain text layout — no cards or buttons.
 */

import React, { useState } from 'react';
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
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../../api/supabaseClient';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { useAuth } from '../../hooks/useAuth';
import { trackFeedbackSubmitted } from '../../utils/analytics';

export function FeedbackScreen({ navigation, route }: { navigation: any; route: any }) {
  const orderId: number | null = route?.params?.orderId ?? null;
  const { session } = useAuth();
  const [rating, setRating] = useState(0);
  const [comments, setComments] = useState('');

  const submitFeedback = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not authenticated');
      if (rating === 0) throw new Error('Please select a rating');

      const { error } = await supabase.from('app_feedback').insert({
        user_id: session.user.id,
        order_id: orderId,
        rating,
        comments: comments.trim() || null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      trackFeedbackSubmitted(rating);
      Alert.alert('Thank you!', 'Your feedback helps us improve.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    },
    onError: (err) => Alert.alert('Error', err.message),
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent">‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary">Rate the App</ThemedText>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.section}>
          <ThemedText variant="body" color="subtitle" style={styles.question}>
            How would you rate 1stOne?
          </ThemedText>

          {/* Stars */}
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <TouchableOpacity key={s} onPress={() => setRating(s)} activeOpacity={0.7}>
                <ThemedText
                  variant="title"
                  color="primary"
                  style={[
                    styles.star,
                    { color: s <= rating ? Theme.colors.status.warning : Theme.colors.text.muted },
                  ]}
                >
                  {s <= rating ? '★' : '☆'}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          {/* Comments — underline input */}
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

          {/* Submit — plain text link */}
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
  question: { marginBottom: Theme.spacing.md },
  starsRow: {
    flexDirection: 'row',
    gap: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
  },
  star: { fontSize: 40 },
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
