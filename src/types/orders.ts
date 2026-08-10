/**
 * The status set the `orders_status_allowed` CHECK constraint permits.
 *
 * 'Paid' was dropped from that constraint on 2026-05-19 — both the webhook
 * and confirm-order write 'Confirmed' — so the database will now REJECT it.
 * Keeping it here described a state no row can hold.
 */
export type OrderStatus =
  | 'Pending'
  | 'Confirmed'
  | 'Preparing'
  | 'Ready'
  | 'Packed'
  | 'Dispatched'
  | 'On the Way'
  | 'Delivered'
  | 'Received at Hub'
  | 'Cancelled'
  | 'Failed';

export type OrderType = 'food' | 'essential';
/**
 * 'account' = a back-office order confirmed now and collected later
 * (admin-place-order).
 *
 * 'split' was legacy and never written by any code path. It survives only in
 * the DB CHECK constraint (see admin_bulk_orders.sql), which is a schema
 * change to remove and not worth one on its own.
 */
export type PaymentMethod = 'wallet' | 'razorpay' | 'account';

export interface Order {
  id: number;
  // MF-10: a customer "order" can span multiple delivery cycles — each
  // cycle is its own Order row, all sharing one order_group_id.
  order_group_id: string;
  user_id: string;
  subscription_id: number | null;
  total_amount: number;
  tax_amount: number;
  delivery_fee: number;
  status: OrderStatus;
  order_type: OrderType;
  dispatch_date: string;
  cycle_id: number;
  delivery_method: 'direct' | 'hub';
  hub_id: number | null;
  payment_method: PaymentMethod;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  paid_at: string | null;
  wallet_amount_used: number;
  delivery_address_id: number | null;
  branch_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  item_id: number | null;
  item_type: 'food' | 'essential' | 'subscription';
  item_name: string;
  quantity: number;
  price_at_time: number;
}
