/**
 * Tests for src/utils/idempotency.ts — the key that stops a double-tap becoming
 * two orders.
 *
 * WHY THE FALLBACK IS THE INTERESTING HALF. `place-order` enforces one order per
 * Idempotency-Key and only consumes the key on success, so a repeated key is
 * the entire defence against a customer being charged twice. On a modern runtime
 * this is `crypto.randomUUID()` and there is nothing to test. But
 * `crypto.randomUUID` is absent in Expo Go and on older Android builds, and
 * there the key comes from a hand-rolled Math.random construction that no
 * device in the office exercises.
 *
 * A fallback that produced a CONSTANT — or a value the server rejects as
 * malformed — would not fail loudly. It would either refuse every second order
 * or stop protecting against the double-tap, on exactly the older phones least
 * likely to be tested on.
 */

import { newIdempotencyKey } from '../utils/idempotency';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newIdempotencyKey — native crypto path', () => {
  it('returns a v4 UUID', () => {
    expect(newIdempotencyKey()).toMatch(UUID_V4);
  });

  it('returns a different key every call', () => {
    const keys = new Set(Array.from({ length: 200 }, newIdempotencyKey));
    expect(keys.size).toBe(200);
  });
});

describe('newIdempotencyKey — the Math.random fallback', () => {
  const realCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: realCrypto, configurable: true, writable: true,
    });
  });

  /** Reproduce an older runtime: crypto exists but randomUUID does not. */
  const withoutRandomUUID = () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: {}, configurable: true, writable: true,
    });
  };

  it('still produces a well-formed v4 UUID', () => {
    withoutRandomUUID();
    expect(newIdempotencyKey()).toMatch(UUID_V4);
  });

  it('sets the version and variant bits the server expects', () => {
    withoutRandomUUID();
    for (let i = 0; i < 50; i++) {
      const key = newIdempotencyKey();
      expect(key[14]).toBe('4');                      // version 4
      expect('89ab').toContain(key[19]);              // variant 10xx
    }
  });

  it('is not a constant — 500 keys, 500 distinct values', () => {
    withoutRandomUUID();
    const keys = new Set(Array.from({ length: 500 }, newIdempotencyKey));
    expect(keys.size).toBe(500);
  });

  it('works when crypto is missing entirely', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined, configurable: true, writable: true,
    });
    expect(newIdempotencyKey()).toMatch(UUID_V4);
  });
});
