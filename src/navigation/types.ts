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
  AdminSubscriptions: undefined;
  StoreConfig: undefined;
  FeatureFlags: undefined;
  BranchesManage: undefined;
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
  Addresses: undefined;
  AddAddress: undefined;
  PlanDetail: { planId: number };
  SubscriptionDetail: { subscriptionId: number };
  Wallet: undefined;
  Referral: undefined;
  Essentials: undefined;
  Feedback: { orderId: number };
  Plans: { initialTab?: 'food' | 'essentials' } | undefined;
  LoyaltyPoints: undefined;
  HubDashboard: undefined;
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
  StaffLeave: undefined;
};

export type StaffScreenProps<T extends keyof StaffStackParamList> =
  NativeStackScreenProps<StaffStackParamList, T>;

export type StaffNavProp = NativeStackNavigationProp<StaffStackParamList>;
