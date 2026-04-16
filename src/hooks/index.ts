/**
 * 1stOne F1 — Hooks barrel export
 */

export { AuthProvider, useAuth } from './useAuth';
export { useBranchFilter } from './useBranchFilter';
export { useBranches } from './useBranches';
export {
  useDeliveryHubs,
  useActiveHubs,
  useAddHub,
  useUpdateHub,
  useToggleHub,
  useHubImpactAddresses,
  useAssignHubAddresses,
} from './useDeliveryHubs';
export { useServerTime } from './useServerTime';
export { useDeliveryCycles } from './useDeliveryCycles';
export { useMenuItems } from './useMenuItems';
export { useBanners } from './useBanners';
export { useSmartCart } from './useSmartCart';
export { useOfflineSync } from './useOfflineSync';
export { useStoreConfig } from './useStoreConfig';
export { useFeatureFlags, useFeatureFlag } from './useFeatureFlag';
export { useRealtimeOrders } from './useRealtimeOrders';
export { usePushNotifications } from './usePushNotifications';
export { useAddresses, useAddAddress } from './useAddresses';
export { useMyOrders, useOrderDetail } from './useOrders';
export {
  useSubscriptionPlans,
  usePlanItems,
  useMySubscriptions,
  useCancelledDays,
  useSubscribe,
  useSkipDay,
  useUndoSkip,
  usePauseSubscription,
} from './useSubscriptions';

// Staff hooks
export {
  useStaffOrders,
  useUpdateOrderStatus,
} from './useStaffOrders';
export {
  useTodayAttendance,
  useAttendanceHistory,
  useClockIn,
  useClockOut,
  useStaffLeaves,
  useRequestLeave,
} from './useAttendance';
export { useMyExpenses, useSubmitExpense } from './useExpenses';

// Admin hooks
export { useAdminStats } from './useAdminStats';
export { useAdminOrders, useAdminUpdateOrder, useAdminCancelOrder } from './useAdminOrders';
export {
  useAllMenuItems,
  useAddMenuItem,
  useUpdateMenuItem,
  useToggleMenuItem,
  useAllDeliveryCycles,
  useUpdateDeliveryCycle,
} from './useMenuManagement';
export {
  useAllStaff,
  useAllExpenseClaims,
  useReviewExpense,
  useAllLeaveRequests,
  useReviewLeave,
  useAllStaffAttendance,
  useUpdateStoreConfig,
  useUpdateFeatureFlag,
} from './useStaffManagement';

// Phase 6 — Advanced Features
export {
  useMyReferralCode,
  useReferralSettings,
  useMyReferrals,
  useGenerateReferralCode,
  useApplyReferralCode,
} from './useReferrals';
export {
  useWalletBalance,
  useWalletTransactions,
  useWalletTopup,
  useRefreshWallet,
} from './useWallet';
export { useEssentialsCatalog } from './useEssentials';

// Report hooks
export {
  useRevenueReport,
  useOrderReport,
  useSubscriptionReport,
  useStaffAttendanceReport,
  useExpenseReport,
} from './useReports';
