/**
 * 1stOne F1 — TypeScript Interfaces
 * Exact 1:1 match to schema.sql column names.
 */

// ============ AUTH & PROFILES ============

export type UserRole = 'customer' | 'staff' | 'admin';

export interface Profile {
  id: string;
  phone_number: string;
  full_name: string | null;
  role: UserRole;
  assigned_hub_id: number | null;
  branch_id: number | null;
  wallet_balance: number;
  loyalty_points: number;
  referral_code: string | null;
  referred_by: string | null;
  // Staff-only fields
  employee_id: string | null;
  designation: string | null;
  joining_date: string | null;
  shift_timing: string | null;
  monthly_salary: number | null;
  benefits: string | null;      // comma-separated: "PF,ESI,Medical"
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  user: {
    id: string;
    phone: string;
  };
  role: UserRole;
  assignedHubId: number | null;
}

// ============ STORE CONFIG ============

export interface StoreConfig {
  id: number;
  tax_rate_percentage: number;
  delivery_fee: number;
  cancellation_window_hours: number;
  storm_mode_active: boolean;
  essentials_module_active: boolean;
  branch_management_active: boolean;
  hub_delivery_active: boolean;
  loyalty_points_per_rupee: number;
  min_wallet_topup: number;
  whatsapp_support_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureFlag {
  id: number;
  flag_key: string;
  flag_value: boolean;
  description: string | null;
  updated_at: string;
}

// ============ DELIVERY ============

export interface DeliveryCycle {
  id: number;
  cycle_name: string;
  cutoff_time: string;       // TIME as "HH:MM:SS"
  kitchen_push_time: string;
  delivery_start: string;
  delivery_end: string;
  is_active: boolean;
  is_essentials: boolean;
  branch_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryHub {
  id: number;
  hub_name: string;
  address_details: string;
  contact_phone: string | null;
  branch_id: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeliveryZone {
  id: number;
  zone_name: string;
  description: string | null;
  delivery_fee_override: number | null;
  is_active: boolean;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}

// ============ MENU & CATALOG ============

export interface MenuItem {
  id: number;
  cycle_id: number;
  name: string;
  price: number;
  ingredients: string | null;
  image_url?: string;         // Will add column later for images
  description?: string;       // Will add column later
  is_active: boolean;
  branch_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EssentialItem {
  id: number;
  cycle_id: number;
  name: string;
  price: number;
  unit: string;
  is_active: boolean;
  branch_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ============ SUBSCRIPTIONS ============

export interface SubscriptionPlan {
  id: number;
  cycle_id: number;
  plan_name: string;
  duration_days: number;
  price: number;
  savings_amount: number;
  is_active: boolean;
  plan_type: 'food' | 'essential';
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPlanItem {
  id: number;
  plan_id: number;
  item_id: number;
  item_type: 'food' | 'essential';
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

// ============ ORDERS ============

export type OrderStatus =
  | 'Confirmed'
  | 'Preparing'
  | 'Ready'
  | 'Packed'
  | 'Dispatched'
  | 'On the Way'
  | 'Delivered'
  | 'Received at Hub'
  | 'Cancelled';

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

// ============ CUSTOMER ============

export interface CustomerAddress {
  id: number;
  user_id: string;
  label: string;
  full_name: string;
  address_line: string;
  landmark: string | null;
  city: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: number;
  user_id: string;
  amount: number;
  transaction_type: 'credit' | 'debit';
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}

// ============ STAFF ============

export interface ExpenseClaim {
  id: number;
  staff_id: string;
  category: 'Grocery' | 'Vegetable' | 'Stationery' | 'Fuel' | 'Others';
  description: string;
  amount: number;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Paid';
  approved_by: string | null;
  paid_at: string | null;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessExpense {
  id: number;
  category: string;
  description: string;
  amount: number;
  expense_date: string;
  vendor: string | null;
  is_paid: boolean;
  paid_at: string | null;
  recorded_by: string | null;
  branch_id: number | null;
  created_at: string;
}

export interface StaffAttendance {
  id: number;
  staff_id: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  date: string;
  branch_id: number | null;
}

export interface StaffLeave {
  id: number;
  staff_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffSalary {
  id: number;
  staff_id: string;
  month: number;
  year: number;
  base_salary: number;
  deductions: number;
  bonus: number;
  net_salary: number;
  is_paid: boolean;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffShift {
  id: number;
  staff_id: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  days_of_week: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminNote {
  id: number;
  target_tab: 'kitchen' | 'packing' | 'delivery' | 'all' | 'hub';
  note_text: string;
  is_active: boolean;
  created_by: string | null;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}

// ============ BANNERS ============

export interface Banner {
  id: number;
  banner_type: 'image' | 'text';
  image_url: string | null;
  text_content: string | null;
  is_live: boolean;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}

// ============ REFERRALS ============

export interface ReferralSettings {
  id: number;
  is_active: boolean;
  // Referee (new customer) — credited on code apply
  referee_signup_credit: number;
  referee_reward_points: number;
  // Referrer — credited when referee places first order
  referrer_first_order_points: number;
  referrer_first_order_credit: number;
  // Referrer — credited when referee completes first month (30 days)
  referrer_month_credit: number;
  // Milestone thresholds
  milestone_star_count: number;       // friends who ordered to earn Star badge
  milestone_ambassador_count: number; // friends who ordered to earn Ambassador badge
  // Legacy fields (kept for compatibility)
  referrer_reward_points: number;
  referrer_wallet_credit: number;
  referee_wallet_credit: number;
  updated_at: string;
}

export interface Referral {
  id: number;
  referrer_id: string;
  referee_id: string;
  status: 'pending' | 'first_order_done' | 'month_complete' | 'expired';
  reward_given: boolean;
  first_order_reward_given: boolean;
  month_reward_given: boolean;
  created_at: string;
}

// ============ SUPPLY / STOCK ============

export interface SupplyRequest {
  id: number;
  request_type: 'Vegetables' | 'Grocery' | 'Stationery';
  items: { name: string; qty: number }[];
  status: 'Pending' | 'Approved' | 'Rejected';
  submitted_by: string | null;
  approved_by: string | null;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SupplyOrderItem {
  id: number;
  name: string;
  qty: number;
  category: 'Vegetables' | 'Grocery' | 'Stationery';
  request_id: number | null;   // null = admin-added
  batch_id: number | null;     // null = active (not yet printed)
  added_by: string | null;
  branch_id: number | null;
  created_at: string;
}

export interface SupplyBatch {
  id: number;
  printed_at: string;
  printed_by: string | null;
  note: string | null;
  items_snapshot: { name: string; qty: number; category: string }[];
  branch_id: number | null;
  created_at: string;
}

// ============ APP FEEDBACK ============

export interface AppFeedback {
  id: number;
  user_id: string;
  order_id: number | null;
  rating: number;
  comments: string | null;
  created_at: string;
}

// ============ PUSH NOTIFICATIONS ============

export interface PushNotificationToken {
  id: number;
  user_id: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============ CLIENT-SIDE TYPES ============

export interface CartItem {
  menu_item_id: number;
  cycle_id: number;
  name: string;
  display_price: number;
  quantity: number;
}

export interface DispatchEvaluation {
  menu_item_id: number;
  cycle_id: number;
  scenario: 'A' | 'B';
  dispatch_label: string;
  cycle_name: string;
}
