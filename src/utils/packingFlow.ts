/**
 * 1stOne F1 — Packing-tab state machine.
 *
 * Mirror of `nextDeliveryStatus` (which covers Dispatched onwards) but for
 * the staff Packing tab. Pure function so the per-row pill, the
 * "Mark all as Packed" bulk button, and any future Tier 2 tests can share
 * the same source of truth.
 *
 * Food flow:        Confirmed → Ready (Kitchen tab) → Packed → Dispatched
 *                   ↑ Packing only handles Ready → Packed → Dispatched.
 * Essentials flow:  Confirmed → Packed → Dispatched (no Kitchen step)
 *                   ↑ BF-34b: Packing is the first-hop for essentials.
 */

import type { OrderStatus } from '../types';

export type OrderTypeForPacking = 'food' | 'essential' | string | null | undefined;

export function nextPackingStatus(
  current: string,
  orderType: OrderTypeForPacking,
): OrderStatus | null {
  // BF-34b: essentials skip Kitchen, so Packing is their first-hop.
  if (current === 'Confirmed' && orderType === 'essential') return 'Packed';

  if (current === 'Ready')  return 'Packed';
  if (current === 'Packed') return 'Dispatched';

  return null;
}
