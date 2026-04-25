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

export interface ReferralSettings {
  id: number;
  is_active: boolean;
  referee_signup_credit: number;
  referee_reward_points: number;
  referrer_first_order_points: number;
  referrer_first_order_credit: number;
  referrer_month_credit: number;
  milestone_star_count: number;
  milestone_ambassador_count: number;
  // Legacy DB columns
  referrer_reward_points?: number;
  referrer_wallet_credit?: number;
  referee_wallet_credit?: number;
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

export interface AppFeedback {
  id: number;
  user_id: string;
  order_id: number | null;
  rating: number;
  comments: string | null;
  created_at: string;
}
