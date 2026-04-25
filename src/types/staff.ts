export interface ExpenseClaim {
  id: number;
  staff_id: string;
  category: 'Grocery' | 'Vegetable' | 'Stationery' | 'Fuel' | 'Others';
  description: string;
  amount: number;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Paid';
  approved_by: string | null;
  paid_at: string | null;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessExpense {
  id: number;
  category: string;
  description: string;
  amount: number;
  expense_date: string;
  vendor: string | null;
  is_paid: boolean;
  paid_at: string | null;
  recorded_by: string | null;
  branch_id: number | null;
  created_at: string;
}

export interface StaffAttendance {
  id: number;
  staff_id: string;
  clock_in_time: string | null;
  clock_out_time: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  date: string;
  branch_id: number | null;
}

export interface StaffLeave {
  id: number;
  staff_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffSalary {
  id: number;
  staff_id: string;
  month: number;
  year: number;
  base_salary: number;
  deductions: number;
  bonus: number;
  net_salary: number;
  is_paid: boolean;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffShift {
  id: number;
  staff_id: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  days_of_week: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminNote {
  id: number;
  target_tab: 'kitchen' | 'packing' | 'delivery' | 'all' | 'hub';
  note_text: string;
  is_active: boolean;
  created_by: string | null;
  branch_id: number | null;
  created_at: string;
  updated_at: string;
}
