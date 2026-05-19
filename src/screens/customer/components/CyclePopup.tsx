/**
 * 1stOne F1 — Cycle detail popup
 *
 * Tap a cycle's "Dispatch by …" link to see its cutoff / dispatch times.
 * Extracted from HomeScreen (audit D22).
 */

import React from 'react';
import { View, Modal, TouchableOpacity, TouchableWithoutFeedback, StyleSheet } from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import type { SectionMeta } from './homeShared';

export function CyclePopup({ cycle, onClose }: { cycle: SectionMeta; onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={popup.backdrop} />
      </TouchableWithoutFeedback>
      <View style={popup.box}>
        <ThemedText variant="subtitle" color="mint" style={popup.title}>
          {cycle.title}
        </ThemedText>
        <View style={popup.row}>
          <ThemedText variant="small" color="muted">Order cutoff</ThemedText>
          <ThemedText variant="small" color="primary">{cycle.cutoffTime}</ThemedText>
        </View>
        <View style={popup.row}>
          <ThemedText variant="small" color="muted">Dispatch by</ThemedText>
          <ThemedText variant="small" color="primary">{cycle.deliveryBy}</ThemedText>
        </View>
        <TouchableOpacity onPress={onClose} style={popup.closeBtn}>
          <ThemedText variant="small" color="muted">Close</ThemedText>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const popup = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Theme.colors.layout.overlay },
  box: {
    position: 'absolute',
    alignSelf: 'center',
    top: '40%',
    width: 260,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 10,
    borderWidth: 0.5,
    borderColor: Theme.colors.layout.divider,
  },
  title: { marginBottom: Theme.spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Theme.spacing.xs },
  closeBtn: { marginTop: Theme.spacing.sm, alignItems: 'center' },
});
