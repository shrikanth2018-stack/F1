/**
 * 1stOne F1 — DialogHost
 *
 * Singleton themed modal mounted once at the app root. Replaces the native
 * Alert.alert() popup (which renders in the OS light theme on Android and
 * cannot be styled). All confirmDialog() / infoDialog() calls go through
 * this host on native; web continues to use window.confirm / window.alert.
 *
 * Usage:
 *   1. Render <DialogHost /> once near the root (App.tsx).
 *   2. Existing call sites keep working — no API change.
 */

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, BackHandler } from 'react-native';
import { Theme } from '../theme';
import { _registerDialogHandler } from '../utils/confirmDialog';

interface DialogState {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive: boolean;
  // null cancelLabel means single-button info dialog
  resolve: (confirmed: boolean) => void;
}

export function DialogHost() {
  const [state, setState] = useState<DialogState | null>(null);

  useEffect(() => {
    _registerDialogHandler((opts) => {
      return new Promise<boolean>((resolve) => {
        setState({
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? 'OK',
          cancelLabel: opts.cancelLabel,    // undefined = info dialog
          destructive: opts.destructive ?? false,
          resolve,
        });
      });
    });
  }, []);

  // Hardware back button on Android = cancel, matches Alert.alert behavior
  useEffect(() => {
    if (!state) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCancel();
      return true;
    });
    return () => sub.remove();
  }, [state]);

  const handleConfirm = () => {
    if (!state) return;
    const r = state.resolve;
    setState(null);
    r(true);
  };

  const handleCancel = () => {
    if (!state) return;
    const r = state.resolve;
    setState(null);
    r(false);
  };

  if (!state) return null;

  const isInfo = state.cancelLabel === undefined;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.title}>{state.title}</Text>
          {!!state.message && <Text style={styles.message}>{state.message}</Text>}

          <View style={[styles.btnRow, isInfo && styles.btnRowSingle]}>
            {!isInfo && (
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                activeOpacity={0.6}
                onPress={handleCancel}
              >
                <Text style={styles.cancelText}>{state.cancelLabel ?? 'Cancel'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.btn, styles.confirmBtn, isInfo && styles.confirmBtnFull]}
              activeOpacity={0.6}
              onPress={handleConfirm}
            >
              <Text style={[styles.confirmText, state.destructive && styles.destructiveText]}>
                {state.confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  box: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: 14,
    paddingTop: 22,
    paddingHorizontal: 22,
    paddingBottom: 6,
    borderWidth: 0.5,
    borderColor: Theme.colors.layout.divider,
  },
  title: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 4,
    color: Theme.colors.text.primary,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    color: Theme.colors.text.subtitle,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 22,
  },
  btnRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
    marginHorizontal: -22,
    marginTop: 8,
  },
  btnRowSingle: {
    justifyContent: 'center',
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Theme.colors.layout.divider,
  },
  cancelText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 1,
    color: Theme.colors.text.muted,
    fontWeight: '400',
  },
  confirmBtn: {},
  confirmBtnFull: { flex: 1 },
  confirmText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body + 1,
    color: Theme.colors.text.mint,
    fontWeight: '600',
  },
  destructiveText: {
    color: Theme.colors.status.error,
  },
});
