export interface DeliveryCycle {
  id: number;
  cycle_name: string;
  cutoff_time: string;
  kitchen_push_time: string;
  delivery_start: string;
  delivery_end: string;
  is_active: boolean;
  is_essentials: boolean;
  /** Customer-facing label shown on essentials UI. NULL falls back to cycle_name. */
  essentials_label: string | null;
  branch_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryHub {
  id: number;
  hub_name: string;
  hub_code: string | null;
  /** Required free-text address (e.g. "Plot 42, Sector 7"). DB-enforced NOT NULL. */
  address_details: string;
  contact_phone: string | null;
  polygon_geojson: { lat: number; lng: number }[] | null;
  center_lat: number | null;
  center_lng: number | null;
  staff_user_id: string | null;
  staff_name: string | null;
  staff_phone: string | null;
  is_active: boolean;
  extends_coverage: boolean;
  /** Branch driver who delivers the bundle to this hub (display token, mirrors employee_id). */
  driver_code: string | null;
  /** FK link to the staff user acting as driver for this hub. */
  driver_user_id: string | null;
  /** Hub-level delivery fee. NULL → fall back to zone / store default. */
  delivery_fee_override: number | null;
  /** Commission % the hub earns per order (e.g. external contractor). NULL = none. */
  commission_percent: number | null;
  branch_id: number | null;
  created_at: string;
  updated_at?: string;
}

export interface DeliveryZone {
  id: number;
  zone_name: string;
  description: string | null;
  delivery_fee_override: number | null;
  is_active: boolean;
  /** Driver for direct (non-hub) deliveries inside this zone (display token, mirrors employee_id). */
  driver_code: string | null;
  /** FK link to the staff user acting as driver for this zone. */
  driver_user_id: string | null;
  branch_id: number | null;
  hub_id: number | null;
  polygon_geojson: { lat: number; lng: number }[] | null;
  created_at: string;
  updated_at: string;
}
