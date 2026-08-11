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
  /**
   * Plan photo, same shape as the two catalogues — see `catalogPhoto.ts`.
   * Optional because it is admin-set and added gradually, and a custom plan
   * (built by a customer) never has one.
   */
  image_path?: string | null;
  image_updated_at?: string | null;
}

/**
 * One line of a plan's contents. For a food plan `item_id` is a building-block
 * item (`menu_items` with `is_customer_visible = false`), never a menu — see
 * `src/utils/planItems.ts`.
 *
 * `unit` / `base_quantity` are a snapshot of the block's portion at the time
 * the plan was built, so a plan already sold keeps reading the way it was
 * sold. Optional: plans written before the snapshot existed have neither, and
 * `formatPlanLine` falls back to a bare count for those.
 */
export interface SubscriptionPlanItem {
  item_id: number;
  item_name: string;
  /** How many of the block's own portion, per day. Always a whole number. */
  quantity: number;
  unit?: string | null;
  base_quantity?: number | null;
}

export interface UserSubscription {
  id: number;
  user_id: string;
  plan_id: number;
  start_date: string;
  days_consumed: number;
  is_paused: boolean;
  is_active: boolean;
  /** 'split' was in this union and is written by nothing. See PaymentMethod. */
  payment_method: 'wallet' | 'razorpay';
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
