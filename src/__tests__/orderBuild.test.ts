/**
 * Tests for the server-authoritative order builder
 * (supabase/functions/_shared/orderBuild.ts) — the single derivation both
 * quote-order and place-order call. Health report #6: this 450-line pricing
 * brain (re-pricing, GST carve-out, fee priority, cycle grouping, conflict
 * check) previously had zero tests.
 *
 * The builder takes an injected supabase client and an injected clock, so it
 * unit-tests cleanly against an in-memory fake DB — the REAL module, not a
 * re-implementation.
 */

import { buildAuthoritativeOrder, curateQuote } from '../../supabase/functions/_shared/orderBuild';

// ── In-memory fake supabase client ──────────────────────────────
// Serves .from(table).select().eq()/.in() chains against fixture rows,
// terminating on .single() / .maybeSingle() / await (thenable).
type Row = Record<string, unknown>;

function makeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows: Row[] = [...(tables[table] ?? [])];
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return q; },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return q; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () =>
          rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { message: 'expected exactly one row' } },
        then: (onFulfilled: any, onRejected: any) =>
          Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected),
      };
      return q;
    },
  };
}

// ── Fixtures ────────────────────────────────────────────────────
// Cycle 1 "Lunch": same-day (cutoff 10:30 → delivery 12:30).
// Cycle 2 "Breakfast": cross-midnight (cutoff 22:30 → delivery 07:30).
const BASE_TABLES = (): Record<string, Row[]> => ({
  store_config: [{
    tax_rate_percentage: 5, delivery_fee: 30, cancellation_window_hours: 2,
    min_wallet_topup: 100, max_wallet_topup: 5000, storm_mode_active: false,
  }],
  feature_flags: [{ flag_key: 'storm_mode_active', flag_value: false }],
  delivery_cycles: [
    { id: 1, cutoff_time: '10:30', delivery_start: '12:30', is_active: true },
    { id: 2, cutoff_time: '22:30', delivery_start: '07:30', is_active: true },
  ],
  menu_items: [
    { id: 11, name: 'Veg Meal', price: 105, is_active: true, cycle_id: 1 },
    { id: 12, name: 'Morning Dosa', price: 52.5, is_active: true, cycle_id: 2 },
    { id: 13, name: 'Retired Dish', price: 80, is_active: false, cycle_id: 1 },
    { id: 14, name: 'Orphan Dish', price: 60, is_active: true, cycle_id: null },
    // A building block since the Menu Manager rebuild: no cycle of its own,
    // hidden from the customer menu, priced for back-office use.
    { id: 15, name: 'Sambar', price: 0, is_active: true, cycle_id: null, is_customer_visible: false },
  ],
  essentials_catalog: [
    { id: 31, name: 'Milk 500ml', price: 26.25, is_active: true, cycle_id: 2 },
  ],
  customer_addresses: [
    { id: 77, user_id: 'u1', zone_id: 5, hub_id: null, branch_id: 1, is_serviceable: true },
  ],
  delivery_zones: [{ id: 5, delivery_fee_override: null }],
  delivery_hubs: [{ id: 9, delivery_fee_override: 10 }],
  subscription_plans: [{
    id: 21, plan_name: '7-Day Lunch', price: 700, duration_days: 7, cycle_id: 1,
    plan_type: 'food', is_active: true,
    plan_items: [{ item_id: 11, item_name: 'Veg Meal', quantity: 1 }], branch_id: 1,
  }],
  user_subscriptions: [],
});

// 2026-07-21 IST anchors (IST = UTC+5:30; today/tomorrow/day-after below).
const T_0958_IST = new Date('2026-07-21T04:28:00Z'); // before lunch cutoff → A
const T_1130_IST = new Date('2026-07-21T06:00:00Z'); // after lunch cutoff  → B
const T_2300_IST = new Date('2026-07-21T17:30:00Z'); // after night cutoff  → C (cross-midnight)
const TODAY = '2026-07-21';
const TOMORROW = '2026-07-22';
const DAY_AFTER = '2026-07-23';

const build = (
  overrides: Record<string, Row[]> = {},
  args: Partial<Parameters<typeof buildAuthoritativeOrder>[0]> = {},
) => {
  const tables = { ...BASE_TABLES(), ...overrides };
  return buildAuthoritativeOrder({
    supabase: makeClient(tables),
    userId: 'u1',
    items: [{ item_id: 11, item_type: 'food', quantity: 2 }],
    deliveryAddressId: 77,
    now: T_0958_IST,
    ...args,
  });
};

describe('re-pricing & GST carve-out (T1)', () => {
  it('prices from the DB and carves tax OUT of the inclusive price', async () => {
    const r = await build();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = r.order.groups[0];
    // 105 × 2 = 210 gross; tax = 210×5/(100+5) = 10 — informational only.
    expect(g.subtotal).toBe(210);
    expect(g.tax_amount).toBe(10);
    // Total = gross + fee. Tax NOT added on top.
    expect(g.total_amount).toBe(240);
    expect(r.order.grand_total).toBe(240);
    expect(r.order.total_paise).toBe(24000);
    expect(g.items[0]).toMatchObject({ item_id: 11, item_name: 'Veg Meal', price_at_time: 105 });
  });

  it('groups items by cycle and puts the single fee on the earliest dispatch', async () => {
    const r = await build({}, {
      items: [
        { item_id: 11, item_type: 'food', quantity: 1 },       // cycle 1 → A → today
        { item_id: 31, item_type: 'essential', quantity: 2 },  // cycle 2 → B → tomorrow
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.groups).toHaveLength(2);
    const g1 = r.order.groups.find((g) => g.cycle_id === 1)!;
    const g2 = r.order.groups.find((g) => g.cycle_id === 2)!;
    expect(g1.dispatch_date).toBe(TODAY);
    expect(g2.dispatch_date).toBe(TOMORROW);
    expect(g1.delivery_fee).toBe(30); // earliest carries the fee
    expect(g2.delivery_fee).toBe(0);
    expect(r.order.grand_total).toBe(105 + 30 + 52.5);
  });
});

describe('dispatch scenarios (server clock, IST)', () => {
  it('A before cutoff → today; B after cutoff → tomorrow', async () => {
    const before = await build({}, { now: T_0958_IST });
    const after = await build({}, { now: T_1130_IST });
    if (!before.ok || !after.ok) throw new Error('expected ok');
    expect(before.order.groups[0].scenario).toBe('A');
    expect(before.order.groups[0].dispatch_date).toBe(TODAY);
    expect(after.order.groups[0].scenario).toBe('B');
    expect(after.order.groups[0].dispatch_date).toBe(TOMORROW);
  });

  it('cross-midnight cycle after cutoff → C (day after) and flags consent', async () => {
    const r = await build({}, {
      items: [{ item_id: 12, item_type: 'food', quantity: 1 }],
      now: T_2300_IST,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.groups[0].scenario).toBe('C');
    expect(r.order.groups[0].dispatch_date).toBe(DAY_AFTER);
    expect(r.order.has_scenario_c).toBe(true);
  });
});

describe('delivery fee priority: hub → zone → default', () => {
  it('uses the store default when no overrides exist', async () => {
    const r = await build();
    if (!r.ok) throw new Error('expected ok');
    expect(r.order.groups[0].delivery_fee).toBe(30);
  });

  it('zone override beats the default', async () => {
    const r = await build({ delivery_zones: [{ id: 5, delivery_fee_override: 20 }] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.order.groups[0].delivery_fee).toBe(20);
  });

  it('hub override beats the zone override', async () => {
    const r = await build({
      customer_addresses: [{ id: 77, user_id: 'u1', zone_id: 5, hub_id: 9, branch_id: 1, is_serviceable: true }],
      delivery_zones: [{ id: 5, delivery_fee_override: 20 }],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.order.groups[0].delivery_fee).toBe(10);
    expect(r.order.delivery_method).toBe('hub');
    expect(r.order.hub_id).toBe(9);
  });

  it('address-less pre-pass leaves the fee pending at 0', async () => {
    const r = await build({}, { deliveryAddressId: null });
    if (!r.ok) throw new Error('expected ok');
    expect(r.order.fee_pending).toBe(true);
    expect(r.order.groups[0].delivery_fee).toBe(0);
  });
});

describe('rejections', () => {
  it('empty cart → 400', async () => {
    const r = await build({}, { items: [], subscriptionPlans: [] });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('missing store_config → 503 (never falls back to in-code numbers)', async () => {
    const r = await build({ store_config: [] });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it('unknown address → 400', async () => {
    const r = await build({}, { deliveryAddressId: 999 });
    expect(r).toMatchObject({ ok: false, status: 400, error: 'Invalid delivery address' });
  });

  it("another user's address → 400 (ownership enforced)", async () => {
    const r = await build({
      customer_addresses: [{ id: 77, user_id: 'someone-else', zone_id: 5, hub_id: null, branch_id: 1, is_serviceable: true }],
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('inactive item, unknown item, and cycle-less item → 400', async () => {
    const inactive = await build({}, { items: [{ item_id: 13, item_type: 'food', quantity: 1 }] });
    const unknown = await build({}, { items: [{ item_id: 999, item_type: 'food', quantity: 1 }] });
    const orphan = await build({}, { items: [{ item_id: 14, item_type: 'food', quantity: 1 }] });
    expect(inactive).toMatchObject({ ok: false, status: 400 });
    expect(unknown).toMatchObject({ ok: false, status: 400 });
    expect(orphan).toMatchObject({ ok: false, status: 400, error: '"Orphan Dish" is not assigned to a delivery cycle.' });
  });

  it('inactive delivery cycle → 400', async () => {
    const r = await build({
      delivery_cycles: [{ id: 1, cutoff_time: '10:30', delivery_start: '12:30', is_active: false }],
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});

describe('flags: storm mode & serviceability', () => {
  it('feature_flags storm OR store_config storm → storm_mode true', async () => {
    const viaFlag = await build({ feature_flags: [{ flag_key: 'storm_mode_active', flag_value: true }] });
    const viaConfig = await build({
      store_config: [{ ...BASE_TABLES().store_config[0], storm_mode_active: true }],
    });
    if (!viaFlag.ok || !viaConfig.ok) throw new Error('expected ok');
    expect(viaFlag.order.storm_mode).toBe(true);
    expect(viaConfig.order.storm_mode).toBe(true);
  });

  it('unserviceable address builds but is flagged (caller returns 400)', async () => {
    const r = await build({
      customer_addresses: [{ id: 77, user_id: 'u1', zone_id: null, hub_id: null, branch_id: null, is_serviceable: false }],
    });
    if (!r.ok) throw new Error('expected ok');
    expect(r.order.serviceable).toBe(false);
  });
});

describe('subscription plans', () => {
  const planArgs = {
    items: [],
    subscriptionPlans: [{ plan_id: 21, start_date: TOMORROW }],
  };

  it('subscription-only purchase → one null-cycle revenue group dispatched today', async () => {
    const r = await build({}, planArgs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.groups).toHaveLength(1);
    const g = r.order.groups[0];
    expect(g.cycle_id).toBeNull();
    expect(g.scenario).toBeNull();
    expect(g.dispatch_date).toBe(TODAY);
    expect(g.items[0]).toMatchObject({ item_type: 'subscription', item_id: 21, price_at_time: 700 });
    // Fee lands on this (only) group; plan price is DB-derived.
    expect(r.order.grand_total).toBe(730);
    expect(r.order.loaded_plans).toHaveLength(1);
    expect(r.order.plan_start_by_id[21]).toBe(TOMORROW);
  });

  it('overlapping same-item active subscription → 409', async () => {
    const r = await build({
      user_subscriptions: [{
        id: 1, user_id: 'u1', is_active: true, start_date: '2026-07-20',
        subscription_plans: {
          plan_type: 'food', duration_days: 7,
          plan_items: [{ item_id: 11, item_name: 'Veg Meal', quantity: 1 }],
        },
      }],
    }, planArgs);
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it('queued plan (dates disjoint) and different plan_type are both allowed', async () => {
    const existing = (planType: string, start: string) => ([{
      id: 1, user_id: 'u1', is_active: true, start_date: start,
      subscription_plans: {
        plan_type: planType, duration_days: 7,
        plan_items: [{ item_id: 11, item_name: 'Veg Meal', quantity: 1 }],
      },
    }]);
    // Existing food plan 2026-07-10..16 ended before the new start → queued OK.
    const queued = await build({ user_subscriptions: existing('food', '2026-07-10') }, planArgs);
    // Overlapping dates but essentials type → no conflict.
    const otherType = await build({ user_subscriptions: existing('essentials', '2026-07-20') }, planArgs);
    expect(queued.ok).toBe(true);
    expect(otherType.ok).toBe(true);
  });

  it('inactive plan → 400', async () => {
    const r = await build({
      subscription_plans: [{ ...BASE_TABLES().subscription_plans[0], is_active: false }],
    }, planArgs);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});

describe('drift tuple & curated quote', () => {
  it('dispatches are sorted (cycle_id asc, nulls last) with integer paise', async () => {
    const r = await build({}, {
      items: [
        { item_id: 31, item_type: 'essential', quantity: 1 }, // cycle 2
        { item_id: 11, item_type: 'food', quantity: 1 },      // cycle 1
      ],
      subscriptionPlans: [{ plan_id: 21, start_date: TOMORROW }], // null cycle
    });
    if (!r.ok) throw new Error('expected ok');
    const ids = r.order.dispatches.map((d) => d.cycle_id);
    expect(ids).toEqual([1, 2, null]);
    for (const d of r.order.dispatches) {
      expect(Number.isInteger(d.group_total_paise)).toBe(true);
    }
    // total_paise equals the sum of the group paise (no float drift).
    const sum = r.order.dispatches.reduce((s, d) => s + d.group_total_paise, 0);
    expect(r.order.total_paise).toBe(sum);
  });

  it('curateQuote exposes the drift tuple but drops place-order internals', async () => {
    const r = await build();
    if (!r.ok) throw new Error('expected ok');
    const quote = curateQuote(r.order) as Record<string, unknown>;
    expect(quote.total_paise).toBe(r.order.total_paise);
    expect(quote.dispatches).toEqual(r.order.dispatches);
    expect(quote).not.toHaveProperty('loaded_plans');
    expect(quote).not.toHaveProperty('hub_id');
    expect(quote).not.toHaveProperty('branch_id');
  });
});

describe('building blocks — cycle-less, back-office only', () => {
  it('refuses a block on the customer path', async () => {
    // Blocks are kept off the customer menu by the QUERY that builds it,
    // which is a filter and not a rule. Without this check a hand-made
    // request could add Sambar to a cart and buy it for ₹0.
    const r = await build({}, { items: [{ item_id: 15, item_type: 'food', quantity: 3 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no longer available/i);
  });

  it('accepts a block when the admin names the cycle', async () => {
    // "50 chapatis with lunch" — the cycle belongs to the order, not to the
    // chapati, which is why admin-place-order supplies it.
    const r = await build({}, {
      items: [{ item_id: 15, item_type: 'food', quantity: 3 }],
      overrideCycleId: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order.groups).toHaveLength(1);
      expect(r.order.groups[0].cycle_id).toBe(1);
      expect(r.order.groups[0].items[0].item_name).toBe('Sambar');
    }
  });

  it('collapses lines from different cycles into the admin cycle', async () => {
    // Veg Meal is cycle 1, Morning Dosa cycle 2. On the customer path that is
    // two orders on two dates; for a bulk order it is one delivery.
    const r = await build({}, {
      items: [
        { item_id: 11, item_type: 'food', quantity: 1 },
        { item_id: 12, item_type: 'food', quantity: 1 },
      ],
      overrideCycleId: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order.groups).toHaveLength(1);
      expect(r.order.groups[0].cycle_id).toBe(2);
    }
  });

  it('still splits by the item\'s own cycle for a customer', async () => {
    // The override must not leak into the customer path.
    const r = await build({}, {
      items: [
        { item_id: 11, item_type: 'food', quantity: 1 },
        { item_id: 12, item_type: 'food', quantity: 1 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order.groups).toHaveLength(2);
  });
});
