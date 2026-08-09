/**
 * A line in the one cart.
 *
 * IDENTITY IS (item_id, item_type), NEVER item_id ALONE. `menu_items` and
 * `essentials_catalog` are separate tables with their own id sequences, so
 * menu item 31 and essential 31 are different things that would silently
 * merge into one line under an id-only key. The two carts used to keep them
 * apart by existing in different stores; now the key has to do it.
 */
export interface CartItem {
  item_id: number;
  item_type: 'food' | 'essential';
  cycle_id: number;
  name: string;
  display_price: number;
  quantity: number;
  /** Essentials only — "500ml", "1kg". Food has no unit. */
  unit?: string;
}

export interface CartPlan {
  plan_id: number;
  plan_name: string;
  price: number;
  duration_days: number;
  cycle_id: number;
  plan_type: 'food' | 'essentials';
  start_date: string;
  // Snapshot of plan_items at add-to-cart time — used only for client-side conflict
  // display; server re-validates authoritatively from DB.
  plan_item_ids: number[];
}

export interface DispatchEvaluation {
  item_id: number;
  item_type: CartItem['item_type'];
  cycle_id: number;
  scenario: 'A' | 'B' | 'C';
  dispatch_label: string;
  cycle_name: string;
}
