export interface MenuItem {
  id: number;
  cycle_id: number;
  name: string;
  price: number;
  /**
   * Recipe for a customer-facing menu item, as the "Name:qty;Name:qty"
   * grammar get_kitchen_aggregate parses. Empty on a building-block item.
   */
  ingredients: string | null;
  image_url?: string;
  description?: string;
  is_active: boolean;
  /**
   * FALSE = building-block item (a priced part, admin-only — never listed
   * on the customer menu). TRUE = customer-facing menu item. Rows that
   * pre-date the two-stage builder are TRUE by DB default.
   */
  is_customer_visible: boolean;
  branch_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EssentialItem {
  id: number;
  cycle_id: number;
  name: string;
  description?: string | null;
  price: number;
  unit: string;
  is_active: boolean;
  branch_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
