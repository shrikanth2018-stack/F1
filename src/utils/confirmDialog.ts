/**
 * 1stOne F1 — Cross-platform confirm dialog
 *
 * RN's Alert.alert() with multi-button + destructive style is broken on
 * React Native Web — the dialog often doesn't render and button onPress
 * callbacks don't fire. This helper uses window.confirm() on web and
 * Alert.alert() on native, with the same API.
 *
 * Use this for any destructive confirm (logout, cancel, delete) where
 * web compatibility matters. Plain informational Alert.alert() calls
 * (single OK button) work fine on web — leave those alone.
 */

import { Alert, Platform } from 'react-native';

interface ConfirmOptions {
  /** Title of the dialog. */
  title: string;
  /** Body / question. */
  message?: string;
  /** Label for the confirm button (e.g. "Sign Out", "Cancel Order"). */
  confirmLabel?: string;
  /** Label for the dismiss button. */
  cancelLabel?: string;
  /** Whether the confirm button is destructive (iOS shows it in red). */
  destructive?: boolean;
}

/**
 * Show a confirmation dialog. Resolves to true if user confirms, false otherwise.
 *
 * Native: uses Alert.alert with two buttons.
 * Web:    uses window.confirm — title + message are joined with a newline.
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const {
    title,
    message,
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    destructive = false,
  } = opts;

  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(text));
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
