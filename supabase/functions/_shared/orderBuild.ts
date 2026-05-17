/**
 * 1stOne F1 — Server-authoritative order builder.
 *
 * The SINGLE derivation used by both `quote-order` (preview) and `place-order`
 * (commit) — so the price the customer is quoted and the price they are
 * charged can never diverge in logic.
 *
 * Given a flat cart it: re-prices every item from the DB, derives each cycle's
 * dispatch date from server time + cutoff (see dispatch.ts), groups by cycle,
 * computes per-group tax + the single delivery fee, and runs storm /
 * serviceability / subscription-conflict checks.
 *
 * Pure read — NO writes, NO payment. The clock is passed in (read once by the
 * caller). The client supplies item ids + quantities only; cycle and price are
 * always taken from the DB here.
 */

import {
  resolveClock,
  getDispatchScenario,
  scenarioToDate,
  toPaise,
  type DispatchScenario,
} from './dispatch.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export interface CartItemInput {
  item_id: number;
  item_type: 'food' | 'essential';
  quantity: number;
}

export interface SubscriptionPlanInput {
  plan_id: number;
  start_date: string;
}

export interface OrderItemRow {
  item_id: number;
  item_type: 'food' | 'essential' | 'subscription';
  item_name: string;
  quantity: number;
  price_at_time: number;
}

export interface QuoteGroup {
  cycle_id: number | null;
  dispatch_date: string;          // YYYY-MM-DD, IST
  scenario: DispatchScenario | null; // null = subscription-purchase group
  items: OrderItemRow[];
  subtotal: number;
  tax_amount: number;
  delivery_fee: number;
  total_amount: number;
  group_total_paise: number;
}

export interface BuiltOrder {
  groups: QuoteGroup[];
  order_type: 'food' | 'essential';
  subtotal_total: number;
  tax_total: number;
  delivery_fee: number;
  grand_total: number;
  /** Drift-comparison tuple — integer paise only. */
  total_paise: number;
  dispatches: { cycle_id: number | null; dispatch_date: string; group_total_paise: number }[];
  has_scenario_c: boolean;
  storm_mode: boolean;
  serviceable: boolean;
  /** True when no address was supplied — delivery fee is "calculated at checkout". */
  fee_pending: boolean;
  delivery_method: 'direct' | 'hub' | null;
  hub_id: number | null;
  branch_id: number | null;
  /** Plans loaded for this order — place-order uses these to create user_subscriptions. */
  loaded_plans: any[];
  plan_start_by_id: Record<number, string>;
}

export type BuildResult =
  | { ok: true; order: BuiltOrder }
  | { ok: false; status: number; error: string };

export interface BuildArgs {
  supabase: SupabaseClient;
  userId: string;
  items?: CartItemInput[];
  subscriptionPlans?: SubscriptionPlanInput[];
  /** Omit for an address-less cart pre-pass — fee is then left pending. */
  deliveryAddressId?: number | null;
  /** The one clock read for this request. */
  now: Date;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function buildAuthoritativeOrder(args: BuildArgs): Promise<BuildResult> {
  const { supabase, userId, items = [], subscriptionPlans = [], deliveryAddressId, now } = args;
  const clock = resolveClock(now);

  if (items.length === 0 && subscriptionPlans.length === 0) {
    return { ok: false, status: 400, error: 'No items or plans provided' };
  }

  // ── Store config + storm mode ──────────────────────────────
  const { data: config } = await supabase
    .from('store_config').select('*').limit(1).maybeSingle();
  const taxRate: number = config?.tax_rate_percentage ?? 5;

  const { data: stormFlag } = await supabase
    .from('feature_flags').select('flag_value').eq('flag_key', 'storm_mode_active').maybeSingle();
  const stormMode = stormFlag?.flag_value === true || config?.storm_mode_active === true;

  // ── Address → delivery method, hub, branch, fee ────────────
  let deliveryFee: number = config?.delivery_fee ?? 0;
  let feePending = false;
  let deliveryMethod: 'direct' | 'hub' | null = null;
  let hubId: number | null = null;
  let branchId: number | null = null;
  let serviceable = true;

  if (deliveryAddressId != null) {
    const { data: addr } = await supabase
      .from('customer_addresses')
      .select('zone_id, hub_id, branch_id, is_serviceable')
      .eq('id', deliveryAddressId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!addr) return { ok: false, status: 400, error: 'Invalid delivery address' };

    serviceable = addr.is_serviceable !== false;

    // Fee priority: hub override → zone override → store default.
    if (addr.zone_id != null) {
      const { data: zone } = await supabase
        .from('delivery_zones').select('delivery_fee_override').eq('id', addr.zone_id).maybeSingle();
      if (zone?.delivery_fee_override != null) deliveryFee = zone.delivery_fee_override;
    }
    if (addr.hub_id != null) {
      const { data: hub } = await supabase
        .from('delivery_hubs').select('delivery_fee_override').eq('id', addr.hub_id).maybeSingle();
      if (hub?.delivery_fee_override != null) deliveryFee = hub.delivery_fee_override;
    }
    deliveryMethod = addr.hub_id != null ? 'hub' : 'direct';
    hubId = addr.hub_id ?? null;
    branchId = addr.branch_id ?? null;
  } else {
    // Address-less cart pre-pass — subtotal + tax only.
    feePending = true;
    deliveryFee = 0;
  }

  // ── Price + cycle every item from the DB, group by cycle ───
  type Accum = { cycle_id: number; items: OrderItemRow[]; subtotal: number };
  const byCycle = new Map<number, Accum>();

  const foodInputs = items.filter((i) => i.item_type === 'food');
  const essInputs = items.filter((i) => i.item_type === 'essential');

  if (foodInputs.length > 0) {
    const ids = foodInputs.map((i) => i.item_id);
    const { data: rows, error } = await supabase
      .from('menu_items').select('id, name, price, is_active, cycle_id').in('id', ids);
    if (error) return { ok: false, status: 500, error: error.message };
    const map = new Map<number, any>((rows ?? []).map((r: any) => [r.id, r]));
    for (const inp of foodInputs) {
      const m = map.get(inp.item_id);
      if (!m || !m.is_active) {
        return { ok: false, status: 400, error: `An item in your cart is no longer available.` };
      }
      if (m.cycle_id == null) {
        return { ok: false, status: 400, error: `"${m.name}" is not assigned to a delivery cycle.` };
      }
      const g = byCycle.get(m.cycle_id) ?? { cycle_id: m.cycle_id, items: [], subtotal: 0 };
      g.items.push({
        item_id: m.id, item_type: 'food', item_name: m.name,
        quantity: inp.quantity, price_at_time: m.price,
      });
      g.subtotal += m.price * inp.quantity;
      byCycle.set(m.cycle_id, g);
    }
  }

  if (essInputs.length > 0) {
    const ids = essInputs.map((i) => i.item_id);
    const { data: rows, error } = await supabase
      .from('essentials_catalog').select('id, name, price, is_active, cycle_id').in('id', ids);
    if (error) return { ok: false, status: 500, error: error.message };
    const map = new Map<number, any>((rows ?? []).map((r: any) => [r.id, r]));
    for (const inp of essInputs) {
      const e = map.get(inp.item_id);
      if (!e || !e.is_active) {
        return { ok: false, status: 400, error: `An item in your cart is no longer available.` };
      }
      if (e.cycle_id == null) {
        return { ok: false, status: 400, error: `"${e.name}" is not assigned to a delivery cycle.` };
      }
      const g = byCycle.get(e.cycle_id) ?? { cycle_id: e.cycle_id, items: [], subtotal: 0 };
      g.items.push({
        item_id: e.id, item_type: 'essential', item_name: e.name,
        quantity: inp.quantity, price_at_time: e.price,
      });
      g.subtotal += e.price * inp.quantity;
      byCycle.set(e.cycle_id, g);
    }
  }

  // ── Derive each cycle's dispatch date (server time + cutoff) ─
  const cycleIds = [...byCycle.keys()];
  const cycleTiming = new Map<number, { cutoff_time: string; delivery_start: string }>();
  if (cycleIds.length > 0) {
    const { data: cycles, error } = await supabase
      .from('delivery_cycles')
      .select('id, cutoff_time, delivery_start, is_active')
      .in('id', cycleIds);
    if (error) return { ok: false, status: 500, error: error.message };
    for (const c of cycles ?? []) {
      if (c.is_active === false || !c.cutoff_time || !c.delivery_start) continue;
      cycleTiming.set(c.id, { cutoff_time: c.cutoff_time, delivery_start: c.delivery_start });
    }
  }

  // ── Build item/cycle groups with money ─────────────────────
  const groups: QuoteGroup[] = [];
  let hasScenarioC = false;

  for (const [cycleId, accum] of byCycle) {
    const timing = cycleTiming.get(cycleId);
    if (!timing) {
      return { ok: false, status: 400, error: `A delivery cycle in your cart is no longer available.` };
    }
    const scenario = getDispatchScenario(timing, clock.nowMinutes);
    if (scenario === 'C') hasScenarioC = true;
    const tax = round2(accum.subtotal * (taxRate / 100));
    groups.push({
      cycle_id: cycleId,
      dispatch_date: scenarioToDate(scenario, clock),
      scenario,
      items: accum.items,
      subtotal: round2(accum.subtotal),
      tax_amount: tax,
      delivery_fee: 0, // assigned to the earliest group below
      total_amount: 0, // finalised below
      group_total_paise: 0,
    });
  }

  // ── Subscription plans: validate + conflict check + own group ─
  const loadedPlans: any[] = [];
  const planStartById: Record<number, string> = {};

  if (subscriptionPlans.length > 0) {
    const planIds = subscriptionPlans.map((sp) => sp.plan_id);
    const { data: planRows, error: planErr } = await supabase
      .from('subscription_plans')
      .select('id, plan_name, price, duration_days, cycle_id, plan_type, is_active, plan_items, branch_id')
      .in('id', planIds);
    if (planErr) return { ok: false, status: 500, error: planErr.message };

    for (const sp of subscriptionPlans) {
      const plan = planRows?.find((p: any) => p.id === sp.plan_id);
      if (!plan || !plan.is_active) {
        return { ok: false, status: 400, error: `A subscription plan in your cart is unavailable.` };
      }
      if (!sp.start_date) {
        return { ok: false, status: 400, error: `Start date missing for plan ${sp.plan_id}.` };
      }
      loadedPlans.push(plan);
      planStartById[plan.id] = sp.start_date;
    }

    // Core-item + date-range conflict check (queued plans pass).
    const { data: activeSubs } = await supabase
      .from('user_subscriptions')
      .select('id, start_date, subscription_plans ( plan_type, plan_items, duration_days )')
      .eq('user_id', userId)
      .eq('is_active', true);

    const parseItemIds = (raw: unknown): Set<number> => {
      let arr: any[] = [];
      if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = []; } }
      else if (Array.isArray(raw)) arr = raw;
      const ids = new Set<number>();
      for (const it of arr) if (typeof it?.item_id === 'number') ids.add(it.item_id);
      return ids;
    };

    const MS_PER_DAY = 86_400_000;
    for (const newPlan of loadedPlans) {
      const newType = newPlan.plan_type ?? 'food';
      const newIds = parseItemIds(newPlan.plan_items);
      if (newIds.size === 0) continue;
      const newStartMs = new Date(planStartById[newPlan.id]).getTime();
      const newEndMs = newStartMs + (newPlan.duration_days - 1) * MS_PER_DAY;

      for (const existing of activeSubs ?? []) {
        const ep: any = (existing as any).subscription_plans;
        if (!ep) continue;
        if ((ep.plan_type ?? 'food') !== newType) continue;
        const exStartMs = new Date((existing as any).start_date).getTime();
        const exEndMs = exStartMs + ((ep.duration_days ?? 0) - 1) * MS_PER_DAY;
        if (newEndMs < exStartMs || exEndMs < newStartMs) continue; // queued — allowed
        const existingIds = parseItemIds(ep.plan_items);
        for (const id of newIds) {
          if (existingIds.has(id)) {
            return {
              ok: false, status: 409,
              error: `"${newPlan.plan_name}" overlaps an active subscription delivering the same item during these dates.`,
            };
          }
        }
      }
    }

    // One subscription-purchase group — revenue record, dispatched today.
    const subItems: OrderItemRow[] = [];
    let subSubtotal = 0;
    for (const plan of loadedPlans) {
      subSubtotal += plan.price;
      subItems.push({
        item_id: plan.id, item_type: 'subscription', item_name: plan.plan_name,
        quantity: 1, price_at_time: plan.price,
      });
    }
    const subTax = round2(subSubtotal * (taxRate / 100));
    groups.push({
      cycle_id: null,
      dispatch_date: clock.todayStr,
      scenario: null,
      items: subItems,
      subtotal: round2(subSubtotal),
      tax_amount: subTax,
      delivery_fee: 0,
      total_amount: 0,
      group_total_paise: 0,
    });
  }

  if (groups.length === 0) {
    return { ok: false, status: 400, error: 'No valid items to order' };
  }

  // ── Money: delivery fee once, on the earliest-dispatch group ─
  let earliestIdx = 0;
  for (let i = 1; i < groups.length; i++) {
    if (groups[i].dispatch_date < groups[earliestIdx].dispatch_date) earliestIdx = i;
  }
  let subtotalTotal = 0;
  let taxTotal = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    g.delivery_fee = i === earliestIdx ? deliveryFee : 0;
    g.total_amount = round2(g.subtotal + g.tax_amount + g.delivery_fee);
    g.group_total_paise = toPaise(g.total_amount);
    subtotalTotal += g.subtotal;
    taxTotal += g.tax_amount;
  }
  const grandTotal = round2(groups.reduce((s, g) => s + g.total_amount, 0));

  const hasFood =
    groups.some((g) => g.items.some((it) => it.item_type === 'food')) ||
    loadedPlans.some((p) => (p.plan_type ?? 'food') === 'food');
  const orderType: 'food' | 'essential' = hasFood ? 'food' : 'essential';

  return {
    ok: true,
    order: {
      groups,
      order_type: orderType,
      subtotal_total: round2(subtotalTotal),
      tax_total: round2(taxTotal),
      delivery_fee: feePending ? 0 : deliveryFee,
      grand_total: grandTotal,
      total_paise: toPaise(grandTotal),
      dispatches: groups
        .map((g) => ({
          cycle_id: g.cycle_id,
          dispatch_date: g.dispatch_date,
          group_total_paise: g.group_total_paise,
        }))
        .sort((a, b) => {
          // (cycle_id, dispatch_date) — nulls last
          if (a.cycle_id == null && b.cycle_id != null) return 1;
          if (a.cycle_id != null && b.cycle_id == null) return -1;
          if (a.cycle_id !== b.cycle_id) return (a.cycle_id ?? 0) - (b.cycle_id ?? 0);
          return a.dispatch_date < b.dispatch_date ? -1 : a.dispatch_date > b.dispatch_date ? 1 : 0;
        }),
      has_scenario_c: hasScenarioC,
      storm_mode: stormMode,
      serviceable,
      fee_pending: feePending,
      delivery_method: deliveryMethod,
      hub_id: hubId,
      branch_id: branchId,
      loaded_plans: loadedPlans,
      plan_start_by_id: planStartById,
    },
  };
}

/**
 * Curate a BuiltOrder into the client-facing quote. Used by `quote-order` and
 * by `place-order`'s drift (409) response — one shape, defined once. Drops the
 * place-order-only internals (loaded_plans, address-derived routing).
 */
export function curateQuote(o: BuiltOrder) {
  return {
    groups: o.groups.map((g) => ({
      cycle_id: g.cycle_id,
      dispatch_date: g.dispatch_date,
      scenario: g.scenario,
      items: g.items,
      subtotal: g.subtotal,
      tax_amount: g.tax_amount,
      delivery_fee: g.delivery_fee,
      total_amount: g.total_amount,
    })),
    order_type: o.order_type,
    subtotal_total: o.subtotal_total,
    tax_total: o.tax_total,
    delivery_fee: o.delivery_fee,
    grand_total: o.grand_total,
    // Drift tuple — echoed verbatim by the client to place-order.
    total_paise: o.total_paise,
    dispatches: o.dispatches,
    // Flags for the checkout UI.
    has_scenario_c: o.has_scenario_c,
    storm_mode: o.storm_mode,
    serviceable: o.serviceable,
    fee_pending: o.fee_pending,
  };
}
