/**
 * 1stOne F1 — LoadingOverlay
 * Full-screen semi-transparent loading indicator.
 * Used during async operations (payment, order placement).
 */

import React from 'react';
import { View, ActivityIndicator, StyleSheet, Modal } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

export function LoadingOverlay({ visible, message }: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <ActivityIndicator size="large" color={Theme.colors.action.primary} />
          {message && (
            <ThemedText variant="small" color="subtitle" style={styles.text}>
              {message}
            </ThemedText>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  box: {
    backgroundColor: Theme.colors.background.card,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.xl,
    alignItems: 'center',
    minWidth: 150,
  },
  text: {
    marginTop: Theme.spacing.md,
  },
});
