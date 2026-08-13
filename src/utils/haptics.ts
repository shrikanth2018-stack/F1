/**
 * 1stOne F1 — Haptics (web shim)
 *
 * The browser has no haptic engine, and the Vibration API is a blunt buzz
 * rather than the light tick these calls mean — using it would be a worse
 * answer than silence. Every call is a no-op here.
 *
 * The native implementation lives in `haptics.native.ts`; Metro picks the
 * right one per platform, the same split `razorpay.ts` uses.
 */

/** A choice was registered — a cycle, a length. */
export function tapSelect(): void {}

/** Something was added to what the customer is building. */
export function tapAdd(): void {}
