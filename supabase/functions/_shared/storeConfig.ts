/**
 * 1stOne F1 — Shared store_config loader.
 *
 * store_config is a singleton row holding the global business numbers — tax
 * rate, delivery fee, cancellation window, wallet top-up bounds. Every edge
 * function that needs these reads them through loadStoreConfig.
 *
 * Hard-fail policy: if the row is missing, duplicated, or a required field is
 * null, this throws StoreConfigError. The order/money path must never silently
 * fall back to an in-code number — a missing config row is a real
 * misconfiguration that must surface, not be papered over. Callers convert the
 * throw into a clean 503 for the client.
 *
 * The required columns are DB-enforced NOT NULL (see
 * sql/add_max_wallet_topup_config_notnull_and_hub_note.sql); the null check
 * here is the belt-and-suspenders guard for a row that is missing entirely.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export interface StoreConfig {
  tax_rate_percentage: number;
  delivery_fee: number;
  cancellation_window_hours: number;
  min_wallet_topup: number;
  max_wallet_topup: number;
  storm_mode_active: boolean;
}

export class StoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreConfigError';
  }
}

const REQUIRED_NUMERIC: (keyof StoreConfig)[] = [
  'tax_rate_percentage',
  'delivery_fee',
  'cancellation_window_hours',
  'min_wallet_topup',
  'max_wallet_topup',
];

/**
 * Load and validate the singleton store_config row.
 * Throws StoreConfigError if the row is absent or any required field is null.
 */
export async function loadStoreConfig(supabase: SupabaseClient): Promise<StoreConfig> {
  const { data, error } = await supabase
    .from('store_config')
    .select(
      'tax_rate_percentage, delivery_fee, cancellation_window_hours, ' +
      'min_wallet_topup, max_wallet_topup, storm_mode_active',
    )
    .single();

  if (error || !data) {
    throw new StoreConfigError(`store_config unavailable: ${error?.message ?? 'no row'}`);
  }
  for (const f of REQUIRED_NUMERIC) {
    if (data[f] == null) {
      throw new StoreConfigError(`store_config.${f} is not set`);
    }
  }

  // Postgres numeric can arrive as a string — normalise to number once, here.
  return {
    tax_rate_percentage: Number(data.tax_rate_percentage),
    delivery_fee: Number(data.delivery_fee),
    cancellation_window_hours: Number(data.cancellation_window_hours),
    min_wallet_topup: Number(data.min_wallet_topup),
    max_wallet_topup: Number(data.max_wallet_topup),
    storm_mode_active: data.storm_mode_active === true,
  };
}
