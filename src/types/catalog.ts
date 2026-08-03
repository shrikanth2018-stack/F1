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
  /**
   * Storage path of the item's one photo — `menu-photos/{id}.jpg`. NULL until
   * an admin uploads one; the row then renders its Ionicon in the same tile
   * so a part-photographed menu still lines up. Build a URL with
   * `photoUrl` (src/utils/catalogPhoto.ts), never by string concatenation —
   * the path is not a URL and the delivered image is resized on the fly.
   *
   * (This field and `description` below replace a declared-but-never-existing
   * `image_url?: string`. Neither column was ever on the table, so the
   * description branch in ItemRows.tsx had never once rendered.)
   */
  image_path?: string | null;
  /** Stamped on every photo upload; used to bust the CDN cache. */
  image_updated_at?: string | null;
  /** Short customer-facing line under the name on the Home screen. */
  description?: string | null;
  /**
   * How this item is measured — 'no' | 'g' | 'ml' | 'cup' | 'plate' | 'bowl'.
   * A property of the ITEM, not of each recipe that uses it: Sambar is
   * measured in ml everywhere, and letting each menu choose is how Sagu ended
   * up as ml in two recipes and g in a third. Meaningless on a dish.
   */
  unit?: string | null;
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
  /**
   * Storage path of the item's one photo — `essentials-photos/{id}.jpg`.
   * NULL until an admin uploads one. Vendor-owned rows stay NULL until the
   * vendor listing review gate ships: we do not publish a picture on a
   * vendor's behalf. Build a URL with `photoUrl` (src/utils/catalogPhoto.ts).
   */
  image_path?: string | null;
  /** Stamped on every photo upload; used to bust the CDN cache. */
  image_updated_at?: string | null;
  /** NULL = 1stOne's own item. Set = sold by a third-party vendor. */
  vendor_id?: number | null;
  /** Trading name, attached client-side from the vendor_public view. */
  vendor_name?: string | null;
  /** Vendor-set cap for the day; NULL = uncapped. */
  daily_cap?: number | null;
  is_active: boolean;
  branch_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
