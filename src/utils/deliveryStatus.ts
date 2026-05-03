/**
 * 1stOne F1 — delivery status transition logic
 *
 * Single source of truth for "given an order's current status + delivery method,
 * what status can the calling persona advance it to (if any)?"
 *
 * Hub flow:    Dispatched → Received at Hub → On the Way → Delivered
 *   - driver:       Dispatched → Received at Hub  (handoff at hub, then stops)
 *   - hub_operator: Received at Hub → On the Way → Delivered  (last mile)
 *   - admin:        full flow (omnipotent override)
 *
 * Direct (zone) flow:  Dispatched → On the Way → Delivered
 *   - driver:       full flow
 *   - hub_operator: null (hub op shouldn't see direct orders; defensive)
 *   - admin:        full flow
 *
 * Default persona is 'admin' for backward-compat — call sites that haven't
 * been updated retain full-flow advancement.
 *
 * Was previously inlined in DeliveryOrderRow.tsx and AdminOrderDetailScreen.tsx;
 * extracted in BF-11 (2026-05-03) when persona-aware gating was introduced.
 */

import type { OrderStatus } from '../types';

export type AdvancePersona = 'driver' | 'hub_operator' | 'admin';

export function nextDeliveryStatus(
  current: string,
  deliveryMethod: string | null,
  persona: AdvancePersona = 'admin',
): OrderStatus | null {
  if (deliveryMethod === 'hub') {
    if (persona === 'driver') {
      if (current === 'Dispatched') return 'Received at Hub';
      // Driver stops after handoff; downstream is hub op's domain.
      return null;
    }
    if (persona === 'hub_operator') {
      if (current === 'Received at Hub') return 'On the Way';
      if (current === 'On the Way') return 'Delivered';
      return null;
    }
    // admin — full hub flow
    if (current === 'Dispatched') return 'Received at Hub';
    if (current === 'Received at Hub') return 'On the Way';
    if (current === 'On the Way') return 'Delivered';
    return null;
  }

  // Direct (zone) flow
  // Hub op shouldn't see direct orders (filtered out by useStaffOrders' hub_id
  // match). Defensive null in case visibility ever drifts.
  if (persona === 'hub_operator') return null;
  if (current === 'Dispatched') return 'On the Way';
  if (current === 'On the Way') return 'Delivered';
  return null;
}
