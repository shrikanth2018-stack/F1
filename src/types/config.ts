/**
 * The singleton store_config row, as the app reads it.
 *
 * Two columns are deliberately absent. `store_config.essentials_module_active`
 * and `.hub_delivery_active` still exist on the table but nothing reads them:
 * essentials is now per-branch (`branches.essentials_enabled`, see
 * useEssentialsEnabled) and hub delivery is a feature_flags key. Declaring
 * them here invited someone to wire a switch to a column with no effect.
 */
export interface StoreConfig {
  id: number;
  tax_rate_percentage: number;
  delivery_fee: number;
  cancellation_window_hours: number;
  storm_mode_active: boolean;
  loyalty_points_per_rupee: number;
  min_wallet_topup: number;
  max_wallet_topup: number;
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
