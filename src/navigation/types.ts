import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DeliveryHub } from '@/types';

// ── Admin stack ──────────────────────────────────────────────

export type AdminStackParamList = {
  AdminHome: undefined;
  // Reports
  OrderReport: undefined;
  RevenueReport: undefined;
  SubscriptionReport: undefined;
  StaffReport: undefined;
  HubReport: undefined;
  // Menu & catalog
  MenuManage: undefined;
  /** Stage 1 of the menu builder — a priced building-block item. */
  CreateItem: { cycleId?: number; cycleName?: string };
  /** Stage 2 — a customer-facing menu item composed from stage-1 items. */
  CreateMenu: { cycleId?: number; cycleName?: string };
  CreatePlan: { cycleId?: number; cycleName?: string; planType?: 'food' | 'essentials' };
  PlansManage: undefined;
  EssentialsCatalogManage: undefined;
  CreateEssential: { cycleId?: number; cycleName?: string };
  ImportItems: { type: 'menu' | 'essentials' | 'plans' };
  // Delivery
  DeliveryManage: undefined;
  HubDetail: { hub?: DeliveryHub };
  // Staff
  ResourceManager: undefined;
  EmployeeDetail: { staffId: string };
  OnboardEmployee: undefined;
  // Notifications
  PushNotifications: undefined;
  CustomerPush: undefined;
  NotificationManager: undefined;
  // Marketing
  LoginBg: undefined;
  ReferralSettings: undefined;
  CustomerFeedback: undefined;
  // Finance
  ExpenseManager: undefined;
  StockManager: undefined;
  // Operations
  AdminOrders: undefined;
  AdminOrderDetail: { orderId: number };
  /** Back-office / bulk order entry on behalf of a customer. */
  AdminCreateOrder: undefined;
  /** Register a customer + address from the back office, or fix an address. */
  AdminCreateCustomer: { phone?: string; addressId?: number } | undefined;
  /** Order history for a phone number. */
  AdminCustomerLookup: undefined;
  // Vendors
  AdminVendorManager: undefined;
  AdminVendorOnboard: undefined;
  AdminVendorDetail: { vendorId: number };
  /** Approval queue for vendor listings. Also the push deep-link target. */
  AdminVendorListings: undefined;
  AdminSubscriptions: undefined;
  StoreConfig: undefined;
  FeatureFlags: undefined;
  JobHealth: undefined;
  BranchesManage: undefined;
  CustomerExport: undefined;
};

export type AdminScreenProps<T extends keyof AdminStackParamList> =
  NativeStackScreenProps<AdminStackParamList, T>;

export type AdminNavProp = NativeStackNavigationProp<AdminStackParamList>;

// ── Customer stack ───────────────────────────────────────────

export type CustomerStackParamList = {
  Home: undefined;
  Orders: undefined;
  Subscriptions: undefined;
  Cart: { subscriptionPlanId?: number } | undefined;
  Checkout: { cartType: 'food' | 'essentials'; subscriptionPlanId?: number };
  OrderDetail: { orderId: number };
  EditProfile: undefined;
  AddAddress: { addressId?: number } | undefined;
  PlanDetail: { planId: number };
  Wallet: undefined;
  Referral: undefined;
  Feedback: { orderId: number };
  Plans: { initialTab?: 'food' | 'essentials' } | undefined;
  LoyaltyPoints: undefined;
  HubDashboard: undefined;
  /** Vendor's own store — the same profile-menu arrangement a hub operator has. */
  VendorDashboard: undefined;
  VendorRegistration: undefined;
  HubOrderHistoryDetail: { orderId: number };
  DriverDashboard: undefined;
};

export type CustomerScreenProps<T extends keyof CustomerStackParamList> =
  NativeStackScreenProps<CustomerStackParamList, T>;

export type CustomerNavProp = NativeStackNavigationProp<CustomerStackParamList>;

// ── Staff stack ──────────────────────────────────────────────

export type StaffStackParamList = {
  StaffDashboard: undefined;
  Attendance: undefined;
  StaffExpenses: undefined;
  StaffProfile: undefined;
};

export type StaffScreenProps<T extends keyof StaffStackParamList> =
  NativeStackScreenProps<StaffStackParamList, T>;

export type StaffNavProp = NativeStackNavigationProp<StaffStackParamList>;
