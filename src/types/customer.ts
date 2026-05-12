export interface CustomerAddress {
  id: number;
  user_id: string;
  label: string;
  full_name: string;
  phone_number: string | null;
  address_line: string;
  landmark: string | null;
  city: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  zone_id: number | null;
  hub_id: number | null;
  branch_id: number | null;
  hub_impact_notified_at: string | null;
  is_serviceable: boolean;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: number;
  user_id: string;
  amount: number;
  transaction_type: 'credit' | 'debit';
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}
