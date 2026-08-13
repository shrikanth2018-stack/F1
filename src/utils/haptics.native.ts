/**
 * 1stOne F1 — Haptics
 *
 * THE ONLY EFFECT IN THIS APP THAT MOVES NOTHING. Everything else the design
 * allows itself — a 200 ms fade, a 0.97 press, a surface a shade lighter — is
 * still something on screen. A haptic tick is felt and not seen, so it can add
 * the sense of a well-made control without spending any of the restraint the
 * rest of the interface is built on. That is why it is here and a blur is not.
 *
 * TWO VERBS, NOT EXPO'S SEVEN. `Haptics` exposes impact at three weights,
 * notification at three outcomes, and selection. Naming them at the call site
 * would put a decision about hardware into a screen; naming them by what the
 * customer just DID keeps that decision here, once. Two is what this app
 * actually has occasion for.
 *
 * NEVER FOR FAILURE OR ARRIVAL. No tick on a blocked button, an error, or a
 * completed purchase. A refusal already says why in words, and buzzing someone
 * for being told no is punishment, not feedback. The payment sheet is its own
 * event and does not need announcing.
 *
 * NEVER AWAITED, NEVER THROWS. A device with the engine disabled in settings,
 * or an emulator without one, rejects the promise — and a missing tick must
 * never surface as an error in a checkout flow.
 */

import * as Haptics from 'expo-haptics';

/**
 * A choice was registered — a delivery time, a plan length.
 *
 * `selectionAsync` rather than an impact: it is the lightest thing the API
 * offers, and on iOS it is the same generator the system uses for a picker
 * detent, which is exactly what choosing from a list of cards is.
 */
export function tapSelect(): void {
  Haptics.selectionAsync().catch(() => {});
}

/**
 * Something was added to what the customer is building.
 *
 * A notch heavier than a selection, because it changed the thing rather than
 * moved through it — and `Light`, not `Medium`, because five dishes added in
 * a row at Medium is a rattle.
 */
export function tapAdd(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
