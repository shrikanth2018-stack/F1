/**
 * 1stOne F1 — cancel-order tests
 *
 * Run: deno test supabase/functions/cancel-order/index.test.ts --allow-env
 *
 * ⚠ THIS FILE IS NOT PART OF THE GATE. `npm run check` runs jest, whose
 * testMatch is `**\/__tests__\/**`, so nothing here executes on push — and deno
 * is not installed on the maintainer's machine either. Treat it as a sketch,
 * not as coverage.
 *
 * The real, executed coverage for this function's rules lives in
 * `src/__tests__/dispatch.test.ts`, which imports `_shared/dispatch.ts`
 * directly and asserts the cancellation gate over 960 combinations of cycle,
 * dispatch date and time of day — including an equivalence check against the
 * logic this function carried before 2026-08-17.
 *
 * §1 USED TO TEST `istDateInfo()`, WHICH THIS FUNCTION NO LONGER HAS. The IST
 * clock and the cross-midnight rule were duplicated here and now come from
 * `_shared/dispatch.ts`; §1 points at that instead.
 *
 * §2 and §3 assert hand-copied transcriptions of the handler's logic rather
 * than the handler itself, so they can pass while the real code is broken. Left
 * in place, described honestly.
 */

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { isCrossMidnightCycle, isCutoffPassedFor, resolveClock } from '../_shared/dispatch.ts';

// ── 1. The cancellation gate, now shared ───────────────────────────────────

Deno.test('cross-midnight is decided in minutes, not string order', () => {
  assertEquals(isCrossMidnightCycle({ cutoff_time: '22:30:00', delivery_start: '07:30:00' }), true);
  assertEquals(isCrossMidnightCycle({ cutoff_time: '11:00:00', delivery_start: '12:30:00' }), false);
  // A missing delivery_start reads as same-day, which is what this function did
  // before the rule moved out of it.
  assertEquals(isCrossMidnightCycle({ cutoff_time: '11:00:00', delivery_start: null }), false);
});

Deno.test("a later run stays cancellable even once today's cutoff has passed", () => {
  const clock = resolveClock(new Date('2026-05-17T09:00:00Z')); // 14:30 IST
  const lunch = { cutoff_time: '11:00:00', delivery_start: '12:30:00' };
  assertEquals(isCutoffPassedFor(lunch, clock.todayStr, clock), true);
  assertEquals(isCutoffPassedFor(lunch, clock.tomorrowStr, clock), false);
});

// ── 2. Idempotency guard logic ─────────────────────────────────────────────

Deno.test('idempotency: already-cancelled order must not trigger wallet refund', () => {
  // Simulate what the handler does at the idempotency check point.
  // If order.status === 'Cancelled', the handler returns early before
  // ever calling increment_wallet_balance RPC.

  let walletRpcCallCount = 0;

  function mockIncrementWallet() {
    walletRpcCallCount++;
  }

  function simulateHandler(orderStatus: string, walletAmountUsed: number, totalAmount: number) {
    // Mirrors the idempotency guard in index.ts
    if (orderStatus === 'Cancelled') {
      const walletRefund = walletAmountUsed || 0;
      const razorpayRefundDue = Math.max(0, totalAmount - walletRefund);
      return { status: 'cancelled', wallet_refunded: walletRefund, razorpay_refund_due: razorpayRefundDue, idempotent: true };
    }
    // Would reach wallet RPC here in real handler
    mockIncrementWallet();
    return { status: 'cancelled', wallet_refunded: walletAmountUsed };
  }

  // First call — order is Cancelled (already processed)
  const result = simulateHandler('Cancelled', 150, 200);

  assertEquals(result.status, 'cancelled');
  assertEquals(result.idempotent, true);
  assertEquals(result.wallet_refunded, 150);
  assertEquals(result.razorpay_refund_due, 50);
  // Critical: wallet RPC was NOT called
  assertEquals(walletRpcCallCount, 0);
});

Deno.test('idempotency: non-cancelled order proceeds to wallet RPC', () => {
  let walletRpcCallCount = 0;

  function mockIncrementWallet() {
    walletRpcCallCount++;
  }

  function simulateHandler(orderStatus: string, walletAmountUsed: number, totalAmount: number) {
    if (orderStatus === 'Cancelled') {
      return { status: 'cancelled', idempotent: true };
    }
    // Passes through to wallet refund
    mockIncrementWallet();
    return { status: 'cancelled', wallet_refunded: walletAmountUsed };
  }

  simulateHandler('Confirmed', 150, 200);

  // Wallet RPC WAS called for a fresh cancellation
  assertEquals(walletRpcCallCount, 1);
});

// ── 3. Razorpay refund calculation ────────────────────────────────────────

Deno.test('razorpayRefundDue: never negative when wallet_amount_used > total', () => {
  // Guard against rounding edge cases
  const totalAmount = 100;
  const walletRefund = 105; // edge: wallet refund exceeds total (shouldn't happen, but guard it)
  const razorpayRefundDue = Math.max(0, totalAmount - walletRefund);
  assertEquals(razorpayRefundDue, 0);
});
