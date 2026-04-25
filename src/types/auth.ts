export type UserRole = 'customer' | 'staff' | 'admin';

export interface Profile {
  id: string;
  phone_number: string;
  full_name: string | null;
  role: UserRole;
  assigned_hub_id: number | null;
  branch_id: number | null;
  wallet_balance: number;
  loyalty_points: number;
  referral_code: string | null;
  referred_by: string | null;
  // Staff-only fields
  employee_id: string | null;
  designation: string | null;
  joining_date: string | null;
  shift_timing: string | null;
  monthly_salary: number | null;
  benefits: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  user: {
    id: string;
    phone: string;
  };
  role: UserRole;
  assignedHubId: number | null;
  branchId: number | null;
}

export interface Branch {
  id: number;
  branch_name: string;
  is_active: boolean;
  created_at: string;
}
