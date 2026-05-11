/**
 * 1stOne F1 — Subscription math helpers.
 *
 * Pure functions for end-of-life detection and proration. Used by
 * SubscriptionDetailScreen (customer "N meals left") and
 * AdminSubscriptionsScreen (refund preview on cancel).
 *
 * Post BF-33 / F2.1 option (a): the subscription end-of-life is driven
 * by `days_consumed`, not the calendar window from `start_date`. Pause /
 * skip / cron-outage extend the effective end date so all paid meals
 * eventually get delivered.
 */

export interface PlanForMath {
  duration_days: number | null | undefined;
  price?: number | null | undefined;
}

export interface SubForMath {
  days_consumed: number | null | undefined;
}

/**
 * BF-33 lock: how many paid meals the customer has yet to receive.
 * Floors at 0 if `days_consumed >= duration_days` (post-completion).
 */
export function subscriptionDaysRemaining(
  plan: PlanForMath,
  sub: SubForMath,
): number {
  const total = plan.duration_days ?? 0;
  const consumed = sub.days_consumed ?? 0;
  return Math.max(0, total - consumed);
}

/**
 * BF-21 lock: prorated wallet refund on admin cancel. Refund is on the
 * all-inclusive amount the customer originally paid (plan price + tax +
 * delivery slice), scaled by the unconsumed portion.
 *
 *   allInclusive = price * (1 + taxRate%) + deliveryFee
 *   refund       = round((allInclusive / duration_days) × daysRemaining)
 *
 * Returns a rupee-rounded integer; matches AdminSubscriptionsScreen's
 * display. Safe against duration_days = 0 / null (returns 0).
 */
export function proratedSubscriptionRefund(
  plan: PlanForMath,
  sub: SubForMath,
  taxRatePercent: number,
  deliveryFee: number,
): number {
  const total = plan.duration_days ?? 0;
  if (total <= 0) return 0;

  const price = plan.price ?? 0;
  const daysRemaining = subscriptionDaysRemaining(plan, sub);
  if (daysRemaining === 0) return 0;

  const allInclusive = price * (1 + taxRatePercent / 100) + deliveryFee;
  return Math.round((allInclusive / total) * daysRemaining);
}
