/**
 * Tests for the Packing-tab state machine. Locks in BF-34b — essentials
 * orders advance from Confirmed → Packed via Packing UI's first-hop.
 * Pre-fix, essentials stuck at Confirmed because the handler only matched
 * Ready / Packed. Order 350 was the smoking-gun stuck row.
 */

import { nextPackingStatus } from '@/utils/packingFlow';

describe('nextPackingStatus — food flow', () => {
  it('Confirmed → null (Kitchen advances it to Ready first)', () => {
    expect(nextPackingStatus('Confirmed', 'food')).toBeNull();
  });
  it('Ready → Packed', () => {
    expect(nextPackingStatus('Ready', 'food')).toBe('Packed');
  });
  it('Packed → Dispatched', () => {
    expect(nextPackingStatus('Packed', 'food')).toBe('Dispatched');
  });
  it('Preparing → null (Packing only takes over from Ready)', () => {
    expect(nextPackingStatus('Preparing', 'food')).toBeNull();
  });
  it('Dispatched → null (out of Packing\'s lane, delivery takes over)', () => {
    expect(nextPackingStatus('Dispatched', 'food')).toBeNull();
  });
});

describe('nextPackingStatus — essentials flow (BF-34b first-hop)', () => {
  it('regression BF-34b: Confirmed essential → Packed (the fix)', () => {
    // Pre-BF-34b this returned null and the order sat stuck at Confirmed.
    // Order 350 (2026-05-06, ₹294 razorpay) was the smoking gun.
    expect(nextPackingStatus('Confirmed', 'essential')).toBe('Packed');
  });
  it('Packed → Dispatched', () => {
    expect(nextPackingStatus('Packed', 'essential')).toBe('Dispatched');
  });
  it('Ready essential → Packed (unusual but safe — Ready acts as a no-op intermediate)', () => {
    expect(nextPackingStatus('Ready', 'essential')).toBe('Packed');
  });
});

describe('nextPackingStatus — defensive cases', () => {
  it('Confirmed with unknown order_type does NOT advance (only essentials get the first-hop)', () => {
    expect(nextPackingStatus('Confirmed', 'gift_card' as any)).toBeNull();
    expect(nextPackingStatus('Confirmed', null)).toBeNull();
    expect(nextPackingStatus('Confirmed', undefined)).toBeNull();
  });
  it('terminal states return null', () => {
    expect(nextPackingStatus('Delivered', 'food')).toBeNull();
    expect(nextPackingStatus('Cancelled', 'food')).toBeNull();
    expect(nextPackingStatus('Pending', 'food')).toBeNull();
  });
});
