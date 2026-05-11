/**
 * Tests for the persona-aware delivery status state machine.
 *
 * Covers BF-11's full matrix: every (currentStatus × deliveryMethod × persona)
 * combination resolves to the expected next status or null (terminal / not
 * allowed for this persona).
 *
 * Locks in:
 *   Hub flow:    Dispatched → Received at Hub → On the Way → Delivered
 *     driver:       only the first hop (handoff)
 *     hub_operator: the three last-mile hops
 *     admin:        full flow
 *   Direct flow: Dispatched → On the Way → Delivered
 *     driver:       full flow
 *     hub_operator: never (hub op shouldn't see direct orders; defensive null)
 *     admin:        full flow
 */

import { nextDeliveryStatus, type AdvancePersona } from '@/utils/deliveryStatus';

// ── Hub flow ─────────────────────────────────────────────

describe('nextDeliveryStatus — hub flow', () => {
  describe('driver', () => {
    it('Dispatched → Received at Hub', () => {
      expect(nextDeliveryStatus('Dispatched', 'hub', 'driver')).toBe('Received at Hub');
    });
    it('Received at Hub → null (driver stops after handoff)', () => {
      expect(nextDeliveryStatus('Received at Hub', 'hub', 'driver')).toBeNull();
    });
    it('On the Way → null (hub op territory)', () => {
      expect(nextDeliveryStatus('On the Way', 'hub', 'driver')).toBeNull();
    });
    it('Delivered → null (terminal)', () => {
      expect(nextDeliveryStatus('Delivered', 'hub', 'driver')).toBeNull();
    });
  });

  describe('hub_operator', () => {
    it('Dispatched → null (driver hasn\'t handed off yet)', () => {
      expect(nextDeliveryStatus('Dispatched', 'hub', 'hub_operator')).toBeNull();
    });
    it('Received at Hub → On the Way', () => {
      expect(nextDeliveryStatus('Received at Hub', 'hub', 'hub_operator')).toBe('On the Way');
    });
    it('On the Way → Delivered', () => {
      expect(nextDeliveryStatus('On the Way', 'hub', 'hub_operator')).toBe('Delivered');
    });
    it('Delivered → null (terminal)', () => {
      expect(nextDeliveryStatus('Delivered', 'hub', 'hub_operator')).toBeNull();
    });
  });

  describe('admin', () => {
    it('Dispatched → Received at Hub', () => {
      expect(nextDeliveryStatus('Dispatched', 'hub', 'admin')).toBe('Received at Hub');
    });
    it('Received at Hub → On the Way', () => {
      expect(nextDeliveryStatus('Received at Hub', 'hub', 'admin')).toBe('On the Way');
    });
    it('On the Way → Delivered', () => {
      expect(nextDeliveryStatus('On the Way', 'hub', 'admin')).toBe('Delivered');
    });
    it('Delivered → null (terminal)', () => {
      expect(nextDeliveryStatus('Delivered', 'hub', 'admin')).toBeNull();
    });
  });
});

// ── Direct (zone) flow ───────────────────────────────────

describe('nextDeliveryStatus — direct flow', () => {
  describe('driver', () => {
    it('Dispatched → On the Way', () => {
      expect(nextDeliveryStatus('Dispatched', 'direct', 'driver')).toBe('On the Way');
    });
    it('On the Way → Delivered', () => {
      expect(nextDeliveryStatus('On the Way', 'direct', 'driver')).toBe('Delivered');
    });
    it('Delivered → null (terminal)', () => {
      expect(nextDeliveryStatus('Delivered', 'direct', 'driver')).toBeNull();
    });
  });

  describe('hub_operator', () => {
    it('Dispatched → null (defensive — hub op shouldn\'t see direct orders)', () => {
      expect(nextDeliveryStatus('Dispatched', 'direct', 'hub_operator')).toBeNull();
    });
    it('On the Way → null (defensive)', () => {
      expect(nextDeliveryStatus('On the Way', 'direct', 'hub_operator')).toBeNull();
    });
  });

  describe('admin', () => {
    it('Dispatched → On the Way', () => {
      expect(nextDeliveryStatus('Dispatched', 'direct', 'admin')).toBe('On the Way');
    });
    it('On the Way → Delivered', () => {
      expect(nextDeliveryStatus('On the Way', 'direct', 'admin')).toBe('Delivered');
    });
  });
});

// ── Default persona (admin / backward-compat) ───────────

describe('nextDeliveryStatus — default persona', () => {
  it('omitting persona defaults to admin — hub flow', () => {
    expect(nextDeliveryStatus('Dispatched', 'hub')).toBe('Received at Hub');
    expect(nextDeliveryStatus('Received at Hub', 'hub')).toBe('On the Way');
    expect(nextDeliveryStatus('On the Way', 'hub')).toBe('Delivered');
  });
  it('omitting persona defaults to admin — direct flow', () => {
    expect(nextDeliveryStatus('Dispatched', 'direct')).toBe('On the Way');
    expect(nextDeliveryStatus('On the Way', 'direct')).toBe('Delivered');
  });
});

// ── Pre-dispatch statuses (Kitchen / Packing domain) ────

describe('nextDeliveryStatus — pre-dispatch states are terminal here', () => {
  // The Kitchen/Packing transitions (Confirmed → Ready, Ready → Packed,
  // Packed → Dispatched) live in StaffDashboard, not here. nextDeliveryStatus
  // only takes over once an order reaches 'Dispatched'.
  const earlyStates = ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Packed'];
  const personas: AdvancePersona[] = ['driver', 'hub_operator', 'admin'];
  for (const status of earlyStates) {
    for (const method of ['hub', 'direct']) {
      for (const persona of personas) {
        it(`${status} + ${method} + ${persona} → null`, () => {
          expect(nextDeliveryStatus(status, method, persona)).toBeNull();
        });
      }
    }
  }
});

// ── Null / unknown deliveryMethod ────────────────────────

describe('nextDeliveryStatus — null or unknown deliveryMethod', () => {
  it('null deliveryMethod falls into direct branch (defensive)', () => {
    // Implementation: only deliveryMethod === 'hub' enters the hub branch.
    // Anything else (null, '', 'direct', or any string) → direct branch.
    expect(nextDeliveryStatus('Dispatched', null, 'admin')).toBe('On the Way');
    expect(nextDeliveryStatus('Dispatched', '', 'admin')).toBe('On the Way');
  });
});
