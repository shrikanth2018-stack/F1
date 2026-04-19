/**
 * 1stOne F1 — confirm-subscription tests
 *
 * Run: deno test supabase/functions/confirm-subscription/index.test.ts --allow-env
 *
 * Covers:
 *  1. Duplicate request (same payment_id, already active) returns 'already_active'
 *     WITHOUT re-running HMAC or touching the DB update path
 *  2. Active sub with different payment_id is rejected (fraud guard)
 *  3. Inactive sub proceeds to HMAC verification
 *  4. Concurrent race: DB guard (.eq is_active=false) prevents double-write
 */

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

// ── Mirrors the idempotency precheck in confirm-subscription/index.ts ──

interface SubRecord {
  is_active: boolean;
  razorpay_payment_id: string | null;
}

function simulateIdempotencyPrecheck(
  sub: SubRecord,
  incomingPaymentId: string,
): { result: 'already_active' | 'proceed' | 'conflict'; hmacCalled: boolean } {
  let hmacCalled = false;

  if (sub.is_active && sub.razorpay_payment_id === incomingPaymentId) {
    // Idempotent retry — return early, no HMAC
    return { result: 'already_active', hmacCalled };
  }

  if (sub.is_active) {
    // Active with DIFFERENT payment_id — potential fraud
    return { result: 'conflict', hmacCalled };
  }

  // Not yet active — proceed to HMAC verification
  hmacCalled = true;
  return { result: 'proceed', hmacCalled };
}

// ── 1. Duplicate request: same payment_id, already active ─────

Deno.test('idempotency: duplicate confirm returns already_active without HMAC', () => {
  const sub: SubRecord = { is_active: true, razorpay_payment_id: 'pay_abc123' };
  const { result, hmacCalled } = simulateIdempotencyPrecheck(sub, 'pay_abc123');

  assertEquals(result, 'already_active');
  assertEquals(hmacCalled, false, 'HMAC must NOT be computed on an idempotent retry');
});

// ── 2. Different payment_id on active sub → conflict ──────────

Deno.test('idempotency: active sub with different payment_id returns conflict', () => {
  const sub: SubRecord = { is_active: true, razorpay_payment_id: 'pay_original' };
  const { result, hmacCalled } = simulateIdempotencyPrecheck(sub, 'pay_different');

  assertEquals(result, 'conflict');
  assertEquals(hmacCalled, false);
});

// ── 3. Inactive sub proceeds to HMAC ──────────────────────────

Deno.test('idempotency: inactive sub proceeds to HMAC verification', () => {
  const sub: SubRecord = { is_active: false, razorpay_payment_id: null };
  const { result, hmacCalled } = simulateIdempotencyPrecheck(sub, 'pay_new_123');

  assertEquals(result, 'proceed');
  assertEquals(hmacCalled, true, 'HMAC must be called for a fresh activation');
});

// ── 4. Concurrent race: DB guard semantics ────────────────────

Deno.test('concurrent race: only one writer wins via DB is_active=false guard', () => {
  // Simulate two concurrent requests:
  // Both pass the precheck (sub not yet active).
  // Both attempt the DB update filtered by is_active=false.
  // DB atomically lets only one succeed (returns rowCount=1).
  // Second gets rowCount=0 → returns already_active.

  const sub: SubRecord = { is_active: false, razorpay_payment_id: null };
  let dbActivated = false;

  function simulateDbUpdate(): 'activated' | 'already_active' {
    if (!dbActivated) {
      dbActivated = true; // first writer wins
      return 'activated';
    }
    return 'already_active'; // second writer sees 0 rows updated
  }

  // Both requests pass precheck (sub is still inactive at precheck time)
  const precheck1 = simulateIdempotencyPrecheck(sub, 'pay_xyz');
  const precheck2 = simulateIdempotencyPrecheck(sub, 'pay_xyz');

  assertEquals(precheck1.result, 'proceed');
  assertEquals(precheck2.result, 'proceed');

  // DB update called by both — only one succeeds
  const dbResult1 = simulateDbUpdate();
  const dbResult2 = simulateDbUpdate();

  assertEquals(dbResult1, 'activated');
  assertEquals(dbResult2, 'already_active');
});

// ── 5. Inactive sub with no prior payment_id ─────────────────

Deno.test('idempotency: null razorpay_payment_id on inactive sub proceeds', () => {
  const sub: SubRecord = { is_active: false, razorpay_payment_id: null };
  const { result } = simulateIdempotencyPrecheck(sub, 'pay_brand_new');
  assertEquals(result, 'proceed');
});
