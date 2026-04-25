export type OrderStatus =
  | 'Pending'
  | 'Confirmed'
  | 'Paid'
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
export type PaymentMethod = 'wallet' | 'razorpay' | 'split';

export interface Order {
  id: number;
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
  item_type: 'food' | 'essential';
  item_name: string;
  quantity: number;
  price_at_time: number;
}
