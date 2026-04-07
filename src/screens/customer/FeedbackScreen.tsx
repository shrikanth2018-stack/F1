/**
 * 1stOne F1 — App Feedback Screen
 *
 * Star rating + comments. Linked to most recent order if available.
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../api/supabaseClient';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ThemedButton } from '../../components/ThemedButton';
import { useAuth } from '../../hooks/useAuth';

export function FeedbackScreen({ navigation }: { navigation: any }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comments, setComments] = useState('');

  const submitFeedback = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not authenticated');
      if (rating === 0) throw new Error('Please select a rating');

      const { error } = await supabase.from('app_feedback').insert({
        user_id: session.user.id,
        rating,
        comments: comments.trim() || null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      Alert.alert('Thank you!', 'Your feedback helps us improve.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    },
    onError: (err) => {
      Alert.alert('Error', err.message);
    },
  });

  const stars = [1, 2, 3, 4, 5];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent">{'< Back'}</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary">Feedback</ThemedText>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.card}>
        <ThemedText variant="subtitle" color="primary" style={styles.question}>
          How would you rate 1stOne?
        </ThemedText>

        <View style={styles.starsRow}>
          {stars.map((s) => (
            <TouchableOpacity key={s} onPress={() => setRating(s)}>
              <ThemedText
                variant="title"
                color="primary"
                style={[
                  styles.star,
                  { color: s <= rating ? Theme.colors.status.warning : Theme.colors.text.muted },
                ]}
              >
                {s <= rating ? '\u2605' : '\u2606'}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.input}
          placeholder="Tell us more (optional)"
          placeholderTextColor={Theme.colors.text.muted}
          value={comments}
          onChangeText={setComments}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <ThemedButton
          title="Submit Feedback"
          variant="primary"
          onPress={() => submitFeedback.mutate()}
          loading={submitFeedback.isPending}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { padding: Theme.spacing.md, paddingTop: Theme.spacing.xl + Theme.spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Theme.spacing.lg },
  card: { backgroundColor: Theme.colors.background.secondary, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.lg },
  question: { textAlign: 'center', marginBottom: Theme.spacing.md },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: Theme.spacing.md, marginBottom: Theme.spacing.lg },
  star: { fontSize: 40 },
  input: { backgroundColor: Theme.colors.background.input, borderRadius: Theme.components.inputRadius, padding: Theme.spacing.md, color: Theme.colors.text.primary, fontFamily: Theme.typography.fontFamily, fontSize: Theme.typography.sizes.body, minHeight: 100, marginBottom: Theme.spacing.md },
});
