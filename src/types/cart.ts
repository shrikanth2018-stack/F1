export interface CartItem {
  menu_item_id: number;
  cycle_id: number;
  name: string;
  display_price: number;
  quantity: number;
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
  menu_item_id: number;
  cycle_id: number;
  scenario: 'A' | 'B';
  dispatch_label: string;
  cycle_name: string;
}
