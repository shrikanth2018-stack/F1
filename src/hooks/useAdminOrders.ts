/**
 * 1stOne F1 — useAdminOrders
 *
 * Admin order mutation: atomic cancel + wallet refund (useAdminCancelOrder).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { invalidateOrderQueries } from '../api/invalidateOrderQueries';
import { fireOrderStatusPush } from '../utils/orderStatusPush';
import { QUERY_KEYS } from '../utils/constants';

/**
 * BF-34a (F3.1, 2026-05-11): atomic admin order cancel + wallet refund.
 *
 * Calls admin_cancel_order_atomic RPC which deactivates the order
 * (with APPENDED notes preserving prior delivery instructions) and
 * credits the wallet in a single Postgres transaction. Replaces the
 * previous two-step flow that risked "cancelled but unrefunded" on a
 * mid-flow network failure. Mirrors BF-20's pattern for subscriptions.
 */
export function useAdminCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orderId,
      refundAmount,
      userId,
      reason,
    }: {
      orderId: number;
      /** Amount to credit the customer's wallet. The cancelled row's full
       *  total_amount for a wallet refund; 0 when the admin will refund a
       *  Razorpay payment manually instead. */
      refundAmount: number;
      userId: string;
      reason?: string;
    }) => {
      // RPC name cast: database.types.ts is auto-generated and won't
      // know about this RPC until regenerated. Same pattern as
      // admin_cancel_subscription_atomic in useSubscriptions.ts.
      const { error } = await supabase.rpc('admin_cancel_order_atomic' as never, {
        p_order_id:      orderId,
        p_refund_amount: refundAmount,
        p_reason:        reason ?? 'Cancelled by admin',
      } as never);
      if (error) throw new Error(error.message);

      // Same shared helper as the staff path → admin-cancel push now routes
      // through the order.cancelled template (admin's editable/disable-able copy).
      fireOrderStatusPush(orderId, 'Cancelled', userId);
    },
    onSuccess: () => {
      invalidateOrderQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    },
  });
}
