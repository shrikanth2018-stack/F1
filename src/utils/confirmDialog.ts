/**
 * 1stOne F1 — Cross-platform confirm dialog
 *
 * Native: routes through DialogHost (a singleton themed Modal mounted at app
 *         root). This replaces the OS Alert.alert which always renders in
 *         the system theme on Android and cannot be styled.
 * Web:    uses window.confirm / window.alert — RN-Web's Alert.alert is
 *         unreliable, and the browser primitives blend into the page fine.
 *
 * Existing call sites continue to use confirmDialog({...}) and infoDialog(...)
 * with the same signature; only the underlying implementation changed.
 */

import { Platform } from 'react-native';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

// Internal handler registered by DialogHost on mount. Until then, dialogs
// fall back to a permissive resolve(false) so the app doesn't deadlock.
let nativeHandler: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

/** Internal — DialogHost calls this once on mount. Don't import from app code. */
export function _registerDialogHandler(handler: (opts: ConfirmOptions) => Promise<boolean>) {
  nativeHandler = handler;
}

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

  if (nativeHandler) {
    return nativeHandler({ title, message, confirmLabel, cancelLabel, destructive });
  }

  // Fallback before DialogHost mounts (very early app boot). Treat as cancel.
  return Promise.resolve(false);
}

export function infoDialog(title: string, message?: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return Promise.resolve();
  }

  if (nativeHandler) {
    // Single-button info dialog — DialogHost treats undefined cancelLabel as info-only.
    return nativeHandler({ title, message, confirmLabel: 'OK', cancelLabel: undefined as any, destructive: false })
      .then(() => undefined);
  }

  return Promise.resolve();
}
