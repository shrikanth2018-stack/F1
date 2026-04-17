/**
 * Tests for the wallet nudge business logic extracted from useWalletNudge.
 *
 * Rules (from src/hooks/useWalletNudge.ts):
 *   - Only triggers for active, non-paused, wallet-payment subscriptions
 *   - The subscription must end within NUDGE_DAYS_AHEAD (3) days from today
 *   - endDate = start_date + duration_days
 *   - shortfall = planPrice - walletBalance
 *   - showNudge only when shortfall > 0
 */

const NUDGE_DAYS_AHEAD = 3;

interface MockSub {
  is_active: boolean;
  is_paused?: boolean;
  payment_method: string;
  start_date: string; // YYYY-MM-DD
  subscription_plans?: {
    duration_days: number;
    price: number;
    plan_name: string;
  } | null;
}

interface WalletData {
  balance: number;
}

/** YYYY-MM-DD string for a date offset by `days` from today */
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/** Mirror of useWalletNudge's useMemo body */
function computeNudge(subs: MockSub[], wallet: WalletData) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + NUDGE_DAYS_AHEAD);

  const urgentSub = subs.find((s) => {
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
}

describe('wallet nudge — showNudge = true cases', () => {
  it('shows nudge when wallet-payment sub ends today and wallet is short', () => {
    const sub: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-29), // 30-day plan started 29 days ago → ends today
      subscription_plans: { duration_days: 30, price: 500, plan_name: 'Monthly Food' },
    };
    const result = computeNudge([sub], { balance: 100 });
    expect(result.showNudge).toBe(true);
    expect(result.shortfall).toBe(400);
    expect((result as any).planName).toBe('Monthly Food');
  });

  it('shows nudge when sub ends 1 day from now', () => {
    const sub: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-6), // 7-day plan, ends tomorrow
      subscription_plans: { duration_days: 7, price: 200, plan_name: 'Weekly' },
    };
    const result = computeNudge([sub], { balance: 50 });
    expect(result.showNudge).toBe(true);
    expect(result.shortfall).toBe(150);
  });

  it('shows nudge when sub ends exactly at NUDGE_DAYS_AHEAD boundary', () => {
    const sub: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-27), // 30-day plan, ends in 3 days
      subscription_plans: { duration_days: 30, price: 300, plan_name: 'Monthly' },
    };
    const result = computeNudge([sub], { balance: 0 });
    expect(result.showNudge).toBe(true);
  });
});

describe('wallet nudge — showNudge = false cases', () => {
  it('no nudge when wallet balance fully covers the plan price', () => {
    const sub: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-29),
      subscription_plans: { duration_days: 30, price: 300, plan_name: 'Monthly' },
    };
    const result = computeNudge([sub], { balance: 300 });
    expect(result.showNudge).toBe(false);
    expect(result.shortfall).toBe(0);
  });

  it('no nudge when wallet balance exceeds plan price', () => {
    const sub: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-29),
      subscription_plans: { duration_days: 30, price: 300, plan_name: 'Monthly' },
    };
    const result = computeNudge([sub], { balance: 500 });
    expect(result.showNudge).toBe(false);
  });

  it('no nudge when sub ends 4+ days away (outside nudge window)', () => {
    const sub: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-26), // 30-day plan, ends in 4 days
      subscription_plans: { duration_days: 30, price: 300, plan_name: 'Monthly' },
    };
    const result = computeNudge([sub], { balance: 0 });
    expect(result.showNudge).toBe(false);
  });

  it('no nudge for razorpay-payment subscriptions', () => {
    const sub: MockSub = {
      is_active: true,
      payment_method: 'razorpay',
      start_date: dateOffset(-29),
      subscription_plans: { duration_days: 30, price: 300, plan_name: 'Monthly' },
    };
    const result = computeNudge([sub], { balance: 0 });
    expect(result.showNudge).toBe(false);
  });

  it('no nudge for inactive subscriptions', () => {
    const sub: MockSub = {
      is_active: false,
      payment_method: 'wallet',
      start_date: dateOffset(-29),
      subscription_plans: { duration_days: 30, price: 300, plan_name: 'Monthly' },
    };
    const result = computeNudge([sub], { balance: 0 });
    expect(result.showNudge).toBe(false);
  });

  it('no nudge for paused subscriptions', () => {
    const sub: MockSub = {
      is_active: true,
      is_paused: true,
      payment_method: 'wallet',
      start_date: dateOffset(-29),
      subscription_plans: { duration_days: 30, price: 300, plan_name: 'Monthly' },
    };
    const result = computeNudge([sub], { balance: 0 });
    expect(result.showNudge).toBe(false);
  });

  it('no nudge when subscription has no plan details', () => {
    const sub: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-29),
      subscription_plans: null,
    };
    const result = computeNudge([sub], { balance: 0 });
    expect(result.showNudge).toBe(false);
  });

  it('no nudge for empty subscription list', () => {
    const result = computeNudge([], { balance: 0 });
    expect(result.showNudge).toBe(false);
  });

  it('no nudge when sub already ended (end date in the past)', () => {
    const sub: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-35), // 30-day plan, ended 5 days ago
      subscription_plans: { duration_days: 30, price: 300, plan_name: 'Monthly' },
    };
    const result = computeNudge([sub], { balance: 0 });
    expect(result.showNudge).toBe(false);
  });
});

describe('wallet nudge — correct shortfall calculation', () => {
  it('shortfall = planPrice - balance', () => {
    const sub: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-29),
      subscription_plans: { duration_days: 30, price: 750, plan_name: 'Premium' },
    };
    const result = computeNudge([sub], { balance: 200 });
    expect(result.shortfall).toBe(550);
  });

  it('picks the first urgent sub when multiple exist', () => {
    const sub1: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-29),
      subscription_plans: { duration_days: 30, price: 400, plan_name: 'Plan A' },
    };
    const sub2: MockSub = {
      is_active: true,
      payment_method: 'wallet',
      start_date: dateOffset(-6),
      subscription_plans: { duration_days: 7, price: 200, plan_name: 'Plan B' },
    };
    const result = computeNudge([sub1, sub2], { balance: 100 });
    expect(result.showNudge).toBe(true);
    // First urgently-ending sub wins
    expect((result as any).planName).toBe('Plan A');
  });
});
