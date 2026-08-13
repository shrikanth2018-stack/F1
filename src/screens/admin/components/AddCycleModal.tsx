/**
 * 1stOne F1 — Add delivery cycle modal
 *
 * Form modal for creating a new delivery cycle (name, cut-off, dispatch,
 * essentials toggle + label). Extracted from DeliveryManagerScreen
 * (audit D22).
 */

import React, { useState } from 'react';
import { infoDialog } from '../../../utils/confirmDialog';
import {
  View,
  Modal,
  TextInput,
  Switch,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { getErrorMessage } from '../../../utils/formatters';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { useAddDeliveryCycle } from '../../../hooks/useMenuManagement';

const S = Theme.typography.sizes.small + 2;

export function AddCycleModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const addCycle = useAddDeliveryCycle();
  const [name, setName] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [dispatch, setDispatch] = useState('');
  const [isEss, setIsEss] = useState(false);
  const [essLabel, setEssLabel] = useState('');

  React.useEffect(() => {
    if (visible) {
      setName('');
      setCutoff('');
      setDispatch('');
      setIsEss(false);
      setEssLabel('');
    }
  }, [visible]);

  const toHHMMSS = (v: string) => (v.length === 5 ? `${v}:00` : v);

  const save = async () => {
    if (!name.trim()) { infoDialog('Missing', 'Enter a cycle name'); return; }
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(cutoff)) { infoDialog('Missing', 'Enter cut-off as HH:MM'); return; }
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(dispatch)) { infoDialog('Missing', 'Enter dispatch as HH:MM'); return; }
    try {
      await addCycle.mutateAsync({
        cycle_name: name.trim(),
        cutoff_time: toHHMMSS(cutoff),
        delivery_start: toHHMMSS(dispatch),
        kitchen_push_time: toHHMMSS(cutoff),
        is_essentials: isEss,
        essentials_label: isEss ? (essLabel.trim() || null) : null,
      });
      onClose();
    } catch (e) {
      infoDialog('Failed', getErrorMessage(e));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={addModal.backdrop}>
        <View style={addModal.sheet}>
          <ThemedText variant="subtitle" color="primary" style={addModal.title}>Add Cycle</ThemedText>

          <View style={addModal.row}>
            <ThemedText variant="small" color="muted" style={addModal.label}>Name</ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Late Dinner"
              placeholderTextColor={Theme.colors.text.muted}
              style={addModal.input}
            />
          </View>

          <View style={addModal.row}>
            <ThemedText variant="small" color="muted" style={addModal.label}>Cut-off (HH:MM)</ThemedText>
            <TextInput
              value={cutoff}
              onChangeText={setCutoff}
              placeholder="21:00"
              placeholderTextColor={Theme.colors.text.muted}
              style={addModal.input}
              maxLength={5}
            />
          </View>

          <View style={addModal.row}>
            <ThemedText variant="small" color="muted" style={addModal.label}>Dispatch (HH:MM)</ThemedText>
            <TextInput
              value={dispatch}
              onChangeText={setDispatch}
              placeholder="22:00"
              placeholderTextColor={Theme.colors.text.muted}
              style={addModal.input}
              maxLength={5}
            />
          </View>

          <View style={addModal.row}>
            <ThemedText variant="small" color="muted" style={addModal.label}>Essentials cycle</ThemedText>
            <Switch
              value={isEss}
              onValueChange={setIsEss}
              trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
              thumbColor={Theme.colors.text.primary}
            />
          </View>

          {isEss && (
            <View style={addModal.row}>
              <ThemedText variant="small" color="muted" style={addModal.label}>Essentials Label</ThemedText>
              <TextInput
                value={essLabel}
                onChangeText={setEssLabel}
                placeholder="e.g. Morning"
                placeholderTextColor={Theme.colors.text.muted}
                style={addModal.input}
              />
            </View>
          )}

          <View style={addModal.actions}>
            <TouchableOpacity onPress={onClose} style={addModal.btn}>
              <ThemedText variant="body" color="muted">Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={addModal.btn} disabled={addCycle.isPending}>
              {addCycle.isPending ? (
                <ActivityIndicator color={Theme.colors.text.mint} />
              ) : (
                <ThemedText variant="body" color="mint">Save</ThemedText>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const addModal = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Theme.colors.layout.overlayHeavy,
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.md,
  },
  sheet: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 12,
    padding: Theme.spacing.md,
  },
  title: { marginBottom: Theme.spacing.sm, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  label: { minWidth: 140, fontSize: S },
  input: {
    flex: 1,
    fontSize: S,
    color: Theme.colors.text.primary,
    textAlign: 'right',
    paddingHorizontal: Theme.spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Theme.spacing.lg,
    marginTop: Theme.spacing.md,
  },
  btn: { paddingVertical: Theme.spacing.xs },
});
