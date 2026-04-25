export interface MenuItem {
  id: number;
  cycle_id: number;
  name: string;
  price: number;
  ingredients: string | null;
  image_url?: string;
  description?: string;
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
  description?: string | null;
  price: number;
  unit: string;
  is_active: boolean;
  branch_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
