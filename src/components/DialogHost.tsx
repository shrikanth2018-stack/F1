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
import { _registerDialogHandler, _registerChoiceHandler } from '../utils/confirmDialog';

interface DialogState {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive: boolean;
  // null cancelLabel means single-button info dialog
  resolve: (confirmed: boolean) => void;
}

/**
 * A pick-one dialog. Separate state from `DialogState` rather than a widened
 * union, so nothing about the confirm/info path — which 173 call sites depend
 * on — changes shape to accommodate it.
 */
interface ChoiceState {
  title: string;
  message?: string;
  choices: string[];
  resolve: (index: number | null) => void;
}

export function DialogHost() {
  const [state, setState] = useState<DialogState | null>(null);
  const [choice, setChoice] = useState<ChoiceState | null>(null);

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
    _registerChoiceHandler((opts) => {
      return new Promise<number | null>((resolve) => {
        setChoice({
          title: opts.title,
          message: opts.message,
          choices: opts.choices,
          resolve,
        });
      });
    });
  }, []);

  // Hardware back button on Android = cancel, matches Alert.alert behavior
  useEffect(() => {
    if (!state && !choice) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (choice) handleChoiceCancel(); else handleCancel();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-bind on the open dialog only; the handlers always reflect current state
  }, [state, choice]);

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

  const handleChoiceCancel = () => {
    if (!choice) return;
    const r = choice.resolve;
    setChoice(null);
    r(null);
  };

  const handleChoose = (index: number) => {
    if (!choice) return;
    const r = choice.resolve;
    setChoice(null);
    r(index);
  };

  /**
   * The pick-one dialog. Options are STACKED, not laid side by side like the
   * confirm's two: three buttons in a row on a narrow phone truncates the
   * labels, and the labels are the whole point of this dialog.
   *
   * Rendered before the confirm below, and they are separate states, so the
   * two can never both be open — whichever was asked for last is the one on
   * screen.
   */
  if (choice) {
    return (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={handleChoiceCancel}
        statusBarTranslucent
      >
        <View style={styles.backdrop}>
          <View style={styles.box}>
            <Text style={styles.title}>{choice.title}</Text>
            {!!choice.message && <Text style={styles.message}>{choice.message}</Text>}
            <View style={styles.stack}>
              {choice.choices.map((label, i) => (
                <TouchableOpacity
                  key={label}
                  style={styles.stackBtn}
                  activeOpacity={0.6}
                  onPress={() => handleChoose(i)}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                >
                  <Text style={styles.confirmText}>{label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.stackBtn}
                activeOpacity={0.6}
                onPress={handleChoiceCancel}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

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
    backgroundColor: Theme.colors.layout.scrim,
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
  /** Options one per line — see the note where this renders. */
  stack: {
    marginHorizontal: -22,
    marginTop: 8,
  },
  stackBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
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
  },
  destructiveText: {
    color: Theme.colors.status.error,
  },
});
