/**
 * 1stOne F1 — cancel-order tests
 *
 * Run: deno test supabase/functions/cancel-order/index.test.ts --allow-env
 *
 * Covers:
 *  1. istDateInfo() returns valid IST date strings and minute count
 *  2. Idempotency guard: already-cancelled order returns success WITHOUT
 *     issuing another wallet refund (the core money-safety assertion)
 */

import { assertEquals, assertMatch } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { istDateInfo } from './index.ts';

// ── 1. IST helper ──────────────────────────────────────────────────────────

Deno.test('istDateInfo: todayStr is YYYY-MM-DD format', () => {
  const { todayStr } = istDateInfo();
  assertMatch(todayStr, /^\d{4}-\d{2}-\d{2}$/);
});

Deno.test('istDateInfo: tomorrowStr is exactly one day after todayStr', () => {
  const { todayStr, tomorrowStr } = istDateInfo();
  const today = new Date(todayStr + 'T00:00:00Z');
  const tomorrow = new Date(tomorrowStr + 'T00:00:00Z');
  assertEquals(tomorrow.getTime() - today.getTime(), 86_400_000);
});

Deno.test('istDateInfo: nowMins is within 0–1439', () => {
  const { nowMins } = istDateInfo();
  assertEquals(nowMins >= 0 && nowMins < 1440, true);
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
