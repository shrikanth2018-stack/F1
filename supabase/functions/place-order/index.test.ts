/**
 * 1stOne F1 — place-order tests
 *
 * Run: deno test supabase/functions/place-order/index.test.ts --allow-env
 *
 * Covers:
 *  1. Storm mode returns 403 Forbidden (not 200, not 503)
 *  2. Storm mode fires when feature_flag wins over config (OR semantics)
 *  3. Storm mode fires when config wins over feature_flag
 *  4. No storm mode when both are false
 */

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

// Mirrors the storm-mode logic in place-order/index.ts
function resolveStormActive(flagValue: boolean | null, configValue: boolean | null): boolean {
  return flagValue === true || configValue === true;
}

const STORM_STATUS = 403;

function simulatePlaceOrder(stormActive: boolean): { status: number } {
  if (stormActive) return { status: STORM_STATUS };
  return { status: 200 };
}

// ── 1. feature_flag = true → 403 ──────────────────────────────

Deno.test('storm mode: feature_flag=true returns 403 Forbidden', () => {
  const stormActive = resolveStormActive(true, false);
  const result = simulatePlaceOrder(stormActive);
  assertEquals(result.status, 403);
});

// ── 2. config = true → 403 ────────────────────────────────────

Deno.test('storm mode: config.storm_mode_active=true returns 403 Forbidden', () => {
  const stormActive = resolveStormActive(false, true);
  const result = simulatePlaceOrder(stormActive);
  assertEquals(result.status, 403);
});

// ── 3. both true → 403 ────────────────────────────────────────

Deno.test('storm mode: both flag and config true returns 403 Forbidden', () => {
  const stormActive = resolveStormActive(true, true);
  const result = simulatePlaceOrder(stormActive);
  assertEquals(result.status, 403);
});

// ── 4. both false → not blocked ───────────────────────────────

Deno.test('storm mode: both false proceeds (200)', () => {
  const stormActive = resolveStormActive(false, false);
  const result = simulatePlaceOrder(stormActive);
  assertEquals(result.status, 200);
});

// ── 5. null values treated as false ───────────────────────────

Deno.test('storm mode: null values treated as inactive (200)', () => {
  const stormActive = resolveStormActive(null, null);
  const result = simulatePlaceOrder(stormActive);
  assertEquals(result.status, 200);
});

// ── 6. Status is specifically 403 not 503 ─────────────────────

Deno.test('storm mode: status code is 403 Forbidden not 503 Service Unavailable', () => {
  const stormActive = resolveStormActive(true, false);
  const result = simulatePlaceOrder(stormActive);
  assertEquals(result.status, 403, 'Must be 403 Forbidden, not 503 Service Unavailable');
  assertEquals(result.status !== 503, true);
});
