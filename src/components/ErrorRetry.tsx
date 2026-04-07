/**
 * 1stOne F1 — ErrorRetry
 * Error state with retry button. Used when queries fail.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';
import { ThemedButton } from './ThemedButton';

interface ErrorRetryProps {
  message?: string;
  onRetry: () => void;
}

export function ErrorRetry({
  message = 'Something went wrong',
  onRetry,
}: ErrorRetryProps) {
  return (
    <View style={styles.container}>
      <ThemedText variant="body" color="subtitle" style={styles.message}>
        {message}
      </ThemedText>
      <ThemedButton title="Retry" variant="text" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.xl,
  },
  message: {
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
  },
});
