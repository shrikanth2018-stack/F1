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

export interface ChoiceOptions {
  title: string;
  message?: string;
  /** Rendered top to bottom, above a Cancel. Two or three reads well; more wants a screen. */
  choices: string[];
}

// Internal handler registered by DialogHost on mount. Until then, dialogs
// fall back to a permissive resolve(false) so the app doesn't deadlock.
let nativeHandler: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;
let choiceHandler: ((opts: ChoiceOptions) => Promise<number | null>) | null = null;

/** Internal — DialogHost calls this once on mount. Don't import from app code. */
export function _registerDialogHandler(handler: (opts: ConfirmOptions) => Promise<boolean>) {
  nativeHandler = handler;
}

/** Internal — DialogHost calls this once on mount. Don't import from app code. */
export function _registerChoiceHandler(handler: (opts: ChoiceOptions) => Promise<number | null>) {
  choiceHandler = handler;
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

/**
 * A choice between two or three named things — not a yes/no.
 *
 * WHY IT EXISTS. `Alert.alert` takes an arbitrary button array, and one call
 * site used three of them: "which kind of plan are you creating — Food or
 * Essentials?". `confirmDialog` cannot say that, so migrating the app off the
 * OS dialog would have left exactly one screen still showing an Android popup
 * next to a 1stOne one. Completing the vocabulary was cheaper than an
 * exception that would have to be explained forever.
 *
 * Resolves the INDEX of the chosen option, or null if cancelled — an index
 * rather than the label, so the caller's branch does not depend on wording
 * somebody may later reword.
 *
 * UNLIKE the other two, this uses DialogHost ON WEB TOO. `window.confirm` is
 * binary and cannot express three options; DialogHost is an ordinary React
 * Native `Modal`, which react-native-web renders perfectly well. The reason
 * the others avoid it on web — RN-Web's `Alert.alert` being unreliable — does
 * not apply to a component we render ourselves.
 */
export function choiceDialog(
  title: string,
  message: string | undefined,
  choices: string[],
): Promise<number | null> {
  if (choiceHandler) return choiceHandler({ title, message, choices });
  // Before DialogHost mounts — treat as cancelled, same as confirmDialog does.
  return Promise.resolve(null);
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
