export interface SubscriptionPlan {
  id: number;
  cycle_id: number;
  plan_name: string;
  duration_days: number;
  price: number;
  savings_amount: number;
  is_active: boolean;
  plan_type: 'food' | 'essentials';
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPlanItem {
  item_id: number;
  item_name: string;
  quantity: number;
}

export interface UserSubscription {
  id: number;
  user_id: string;
  plan_id: number;
  start_date: string;
  days_consumed: number;
  is_paused: boolean;
  is_active: boolean;
  payment_method: 'wallet' | 'razorpay' | 'split';
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  wallet_amount_used: number;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CancelledSubscriptionDay {
  id: number;
  subscription_id: number;
  cancelled_date: string;
  cycle_id: number;
  reason: string | null;
  created_at: string;
}
