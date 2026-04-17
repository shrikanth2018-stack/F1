/**
 * 1stOne F1 — useWalletNudge
 *
 * Checks on mount whether the customer has an active subscription
 * renewing within the next 3 days AND insufficient wallet balance
 * to cover it.
 *
 * Returns { showNudge, shortfall, navigateToWallet } so any screen
 * can render an inline banner — currently wired to HomeScreen.
 *
 * "Renewal" = start_date + duration_days (the day the next cycle
 * would be billed if they re-subscribe, or when wallet-paid sub ends).
 */

import { useMemo } from 'react';
import { useMySubscriptions } from './useSubscriptions';
import { useWalletBalance } from './useWallet';

const NUDGE_DAYS_AHEAD = 3;

export function useWalletNudge() {
  const { data: subs } = useMySubscriptions();
  const { data: wallet } = useWalletBalance();

  const result = useMemo(() => {
    if (!subs || !wallet) return { showNudge: false, shortfall: 0 };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + NUDGE_DAYS_AHEAD);

    // Find any wallet-payment sub that ends within NUDGE_DAYS_AHEAD
    const urgentSub = (subs as any[]).find((s) => {
      if (!s.is_active || s.is_paused) return false;
      if (s.payment_method !== 'wallet') return false;

      const plan = s.subscription_plans;
      if (!plan) return false;

      const endDate = new Date(s.start_date);
      endDate.setDate(endDate.getDate() + (plan.duration_days ?? 0));
      endDate.setHours(0, 0, 0, 0);

      return endDate >= today && endDate <= cutoff;
    });

    if (!urgentSub) return { showNudge: false, shortfall: 0 };

    const planPrice = urgentSub.subscription_plans?.price ?? 0;
    const shortfall = planPrice - wallet.balance;

    if (shortfall <= 0) return { showNudge: false, shortfall: 0 };

    return {
      showNudge: true,
      shortfall,
      planName: urgentSub.subscription_plans?.plan_name ?? 'your subscription',
    };
  }, [subs, wallet]);

  return result;
}
