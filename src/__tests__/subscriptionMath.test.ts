/**
 * Tests for subscription end-of-life + prorated refund math.
 *
 * Locks in:
 *   BF-33 / F2.1 — daysRemaining is days_consumed-based, not calendar-based.
 *                  Pause / skip / cron-outage shift the tail; customer still
 *                  receives all duration_days deliveries.
 *   BF-21        — proration is on the all-inclusive amount (price + tax +
 *                  delivery fee), scaled by daysRemaining/duration_days.
 */

import {
  subscriptionDaysRemaining,
  proratedSubscriptionRefund,
} from '@/utils/subscriptionMath';

// ── subscriptionDaysRemaining ────────────────────────────

describe('subscriptionDaysRemaining', () => {
  it('returns duration_days when nothing consumed yet', () => {
    expect(subscriptionDaysRemaining({ duration_days: 30 }, { days_consumed: 0 })).toBe(30);
  });

  it('returns duration_days - days_consumed mid-sub', () => {
    expect(subscriptionDaysRemaining({ duration_days: 30 }, { days_consumed: 5 })).toBe(25);
  });

  it('regression BF-33: returns 0 when days_consumed equals duration_days', () => {
    // End-of-life: sub auto-deactivates at this point per
    // generate_daily_manifest.sql; no further deliveries pending.
    expect(subscriptionDaysRemaining({ duration_days: 30 }, { days_consumed: 30 })).toBe(0);
  });

  it('floors at 0 when over-consumed (defensive)', () => {
    // Shouldn't happen — auto-deactivate triggers at duration_days. But if a
    // manual SQL update inflated days_consumed somehow, the UI must not
    // display a negative "remaining" value.
    expect(subscriptionDaysRemaining({ duration_days: 30 }, { days_consumed: 31 })).toBe(0);
  });

  it('handles null/undefined inputs defensively', () => {
    expect(subscriptionDaysRemaining({ duration_days: null }, { days_consumed: null })).toBe(0);
    expect(subscriptionDaysRemaining({ duration_days: undefined }, { days_consumed: undefined })).toBe(0);
    expect(subscriptionDaysRemaining({ duration_days: 30 }, { days_consumed: null })).toBe(30);
    expect(subscriptionDaysRemaining({ duration_days: null }, { days_consumed: 5 })).toBe(0);
  });
});

// ── proratedSubscriptionRefund ───────────────────────────

describe('proratedSubscriptionRefund', () => {
  it('regression BF-21: refund covers tax + delivery slice, not just plan price', () => {
    // Customer paid: 3000 + 150 (5% tax) + 50 (delivery) = 3200 all-inclusive
    // Half consumed (15/30 days) → half refund = 1600
    expect(
      proratedSubscriptionRefund(
        { duration_days: 30, price: 3000 },
        { days_consumed: 15 },
        5,    // taxRate %
        50,   // deliveryFee
      ),
    ).toBe(1600);
  });

  it('full refund when nothing consumed', () => {
    expect(
      proratedSubscriptionRefund({ duration_days: 30, price: 3000 }, { days_consumed: 0 }, 5, 50),
    ).toBe(3200);
  });

  it('zero refund when sub is fully consumed', () => {
    expect(
      proratedSubscriptionRefund({ duration_days: 30, price: 3000 }, { days_consumed: 30 }, 5, 50),
    ).toBe(0);
  });

  it('zero refund when daysRemaining clips to 0 (over-consumed defensive)', () => {
    expect(
      proratedSubscriptionRefund({ duration_days: 30, price: 3000 }, { days_consumed: 50 }, 5, 50),
    ).toBe(0);
  });

  it('zero refund when duration_days is 0 or null (avoid divide-by-zero)', () => {
    expect(
      proratedSubscriptionRefund({ duration_days: 0, price: 3000 }, { days_consumed: 0 }, 5, 50),
    ).toBe(0);
    expect(
      proratedSubscriptionRefund({ duration_days: null, price: 3000 }, { days_consumed: 0 }, 5, 50),
    ).toBe(0);
  });

  it('handles zero tax / zero delivery fee', () => {
    // Plain proration on plan price only
    expect(
      proratedSubscriptionRefund({ duration_days: 10, price: 1000 }, { days_consumed: 3 }, 0, 0),
    ).toBe(700);
  });

  it('rounds to nearest rupee (admin can override before confirm)', () => {
    // 100 / 3 = 33.33... → expect rounded
    expect(
      proratedSubscriptionRefund({ duration_days: 3, price: 100 }, { days_consumed: 0 }, 0, 0),
    ).toBe(100); // 3/3 of 100 = 100
    expect(
      proratedSubscriptionRefund({ duration_days: 3, price: 100 }, { days_consumed: 1 }, 0, 0),
    ).toBe(67); // 2/3 of 100 = 66.67 → 67
  });

  it('handles null plan.price defensively (defaults to 0, refunds delivery slice only)', () => {
    // price=null → defaults to 0. allInclusive = 0 * 1.05 + 50 = 50.
    // 25/30 remaining → (50/30)*25 = 41.67 → rounds to 42.
    expect(
      proratedSubscriptionRefund({ duration_days: 30, price: null }, { days_consumed: 5 }, 5, 50),
    ).toBe(42);
  });
});
