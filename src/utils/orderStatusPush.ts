/**
 * 1stOne F1 — Order-status push helper.
 *
 * Single source of truth for the customer push fired when an order's status
 * advances. Used by BOTH paths:
 *   - online    — useUpdateOrderStatus, right after the DB write
 *   - offline   — useOfflineSync, when a queued status update finally syncs
 *
 * Anti-spam (Blueprint Sec 5.3): a push fires ONLY at these milestones.
 * Preparing / Packed / On the Way are intentionally silent.
 *
 * Each entry pairs an event_key (admin's notification_templates lookup) with a
 * hardcoded fallback title/body used when the template row is missing.
 */

import { supabase } from '../api/supabaseClient';

const ORDER_STATUS_PUSH: Record<string, {
  event_key: string;
  title: string;
  body: (id: number) => string;
}> = {
  Ready:             { event_key: 'order.ready',           title: 'Order Ready!',    body: (id) => `Order #${id} is packed and ready for dispatch.` },
  Dispatched:        { event_key: 'order.dispatched',      title: 'On the Way!',     body: (id) => `Your order #${id} is on the way. Should arrive soon!` },
  'Received at Hub': { event_key: 'order.received_at_hub', title: 'At Your Hub',     body: (id) => `Order #${id} has arrived at your pickup hub.` },
  Delivered:         { event_key: 'order.delivered',       title: 'Delivered!',      body: (id) => `Order #${id} delivered. Enjoy your meal!` },
  Cancelled:         { event_key: 'order.cancelled',       title: 'Order Cancelled', body: (id) => `Order #${id} has been cancelled.` },
};

/**
 * Fire the customer-facing push for an order status change. Fire-and-forget —
 * never throws; a push failure must not break the status update. No-ops when
 * the status is not a push milestone or the customer is unknown.
 */
export async function fireOrderStatusPush(
  orderId: number,
  status: string,
  customerUserId: string | null | undefined,
): Promise<void> {
  const msg = ORDER_STATUS_PUSH[status];
  if (!msg || !customerUserId) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await supabase.functions.invoke('send-push', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: {
        user_ids: [customerUserId],
        event_key: msg.event_key,
        vars: { order_id: orderId },
        title: msg.title,
        body: msg.body(orderId),
        data: { screen: 'OrderDetail', params: { orderId } },
        trigger_source: 'order_status',
        reference_id: String(orderId),
      },
    });
  } catch (e) {
    console.error('[fireOrderStatusPush]', e);
  }
}
