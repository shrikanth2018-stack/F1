export interface StoreConfig {
  id: number;
  tax_rate_percentage: number;
  delivery_fee: number;
  cancellation_window_hours: number;
  storm_mode_active: boolean;
  essentials_module_active: boolean;
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
