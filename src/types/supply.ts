export interface SupplyRequest {
  id: number;
  request_type: 'Vegetables' | 'Grocery' | 'Stationery';
  items: { name: string; qty: number }[];
  status: 'Pending' | 'Approved' | 'Rejected';
  submitted_by: string | null;
  approved_by: string | null;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SupplyOrderItem {
  id: number;
  name: string;
  qty: number;
  category: 'Vegetables' | 'Grocery' | 'Stationery';
  request_id: number | null;
  batch_id: number | null;
  added_by: string | null;
  branch_id: number | null;
  created_at: string;
}

export interface SupplyBatch {
  id: number;
  printed_at: string;
  printed_by: string | null;
  note: string | null;
  items_snapshot: { name: string; qty: number; category: string }[];
  branch_id: number | null;
  created_at: string;
}
