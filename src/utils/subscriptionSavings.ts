/**
 * 1stOne F1 — "you could be paying less for this on a plan".
 *
 * Pure. Given a cart line and the live plans, works out whether a
 * subscription already delivers that item and what it would save.
 *
 * COMPUTED FROM LIVE DATA, NEVER WRITTEN DOWN. Plan price, duration and
 * contents all come from the row, and the comparison price from today's
 * catalogue — so the day subscription pricing is restructured this reflects
 * the new numbers without anyone remembering to come back here.
 *
 * NOT A PRICE THE SERVER HAS TO AGREE WITH. This is marketing arithmetic
 * shown next to an item; nothing is charged from it. Buying the plan still
 * goes through quote-order and place-order like everything else, so the
 * hard rule that the server decides money is untouched.
 *
 * THE COMPARISON IS THE WHOLE PLAN'S DAILY VALUE, not the one item that
 * matched. A plan holding idli AND milk delivers both every day; comparing
 * its per-day cost against the idli alone would understate the saving and
 * quietly mislead in the customer's disfavour. Both current plans hold a
 * single item, so today the two readings coincide — this is written for the
 * plans that come after the restructure, not the two that exist now.
 */

/** A plan as the cart sees it. `plan_items` is TEXT holding JSON. */
export interface PlanForSavings {
  id: number;
  plan_name: string;
  price: number | string;
  duration_days: number;
  plan_type?: string | null;
  plan_items?: string | unknown[] | null;
  is_active?: boolean | null;
}

export interface PlanItemLine {
  item_id: number;
  quantity: number;
}

export interface Savings {
  planId: number;
  planName: string;
  durationDays: number;
  /** What the plan costs per day. */
  perDay: number;
  /** What the same daily contents cost at today's catalogue prices. */
  catalogPerDay: number;
  /** Over the whole plan. Positive by construction — see the guard below. */
  totalSaving: number;
  /** Rounded percentage off, for copy that leads with the number. */
  percent: number;
}

/**
 * `plan_items` is a TEXT column holding a JSON array, and older rows have
 * arrived as an already-parsed array. Tolerate both and never throw — a
 * malformed plan must cost the customer a nudge, not the cart screen.
 */
export function parsePlanItems(raw: PlanForSavings['plan_items']): PlanItemLine[] {
  let arr: unknown[] = [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  }
  const out: PlanItemLine[] = [];
  for (const entry of arr) {
    const e = entry as { item_id?: unknown; quantity?: unknown };
    if (typeof e?.item_id === 'number') {
      out.push({ item_id: e.item_id, quantity: Number(e.quantity) || 1 });
    }
  }
  return out;
}

/**
 * The codebase uses both spellings on purpose: a plan is 'food' or
 * 'essentials' (plural), an order line is 'food' or 'essential' (singular).
 * Matching them by string equality silently found nothing for essentials.
 */
function planCovers(planType: string | null | undefined, itemType: 'food' | 'essential'): boolean {
  const t = (planType ?? 'food').toLowerCase();
  return itemType === 'food' ? t === 'food' : t === 'essentials' || t === 'essential';
}

/**
 * Show nothing below this. Zero by default — the plans are about to be
 * repriced to a standard percentage, so suppressing a weak offer is solving a
 * problem that is on its way out. Left as one named number so a thin saving
 * can be hidden with a one-line change if it ever grates before then.
 */
const MIN_SAVING_RUPEES = 0;

/**
 * The best plan for this cart line, or null.
 *
 * `priceOf` returns today's catalogue price for a plan line, or null when the
 * item is unknown — a plan referencing something delisted cannot be priced,
 * and a partial total would be worse than no claim at all, so the whole plan
 * is skipped.
 */
export function savingsForItem(
  itemId: number,
  itemType: 'food' | 'essential',
  plans: PlanForSavings[],
  priceOf: (itemId: number) => number | null,
  minSaving: number = MIN_SAVING_RUPEES,
): Savings | null {
  let best: Savings | null = null;

  for (const plan of plans) {
    if (plan.is_active === false) continue;
    if (!planCovers(plan.plan_type, itemType)) continue;

    const lines = parsePlanItems(plan.plan_items);
    if (!lines.some((l) => l.item_id === itemId)) continue;

    const duration = Number(plan.duration_days) || 0;
    const planPrice = Number(plan.price) || 0;
    if (duration <= 0 || planPrice <= 0) continue;

    let catalogPerDay = 0;
    let priceable = true;
    for (const line of lines) {
      const p = priceOf(line.item_id);
      if (p == null) { priceable = false; break; }
      catalogPerDay += p * line.quantity;
    }
    if (!priceable || catalogPerDay <= 0) continue;

    const totalSaving = catalogPerDay * duration - planPrice;
    if (totalSaving <= minSaving) continue;

    const candidate: Savings = {
      planId: plan.id,
      planName: plan.plan_name,
      durationDays: duration,
      perDay: Math.round((planPrice / duration) * 100) / 100,
      catalogPerDay: Math.round(catalogPerDay * 100) / 100,
      totalSaving: Math.round(totalSaving),
      percent: Math.round((totalSaving / (catalogPerDay * duration)) * 100),
    };
    // More than one plan can cover an item once the range grows. Lead with
    // the biggest saving rather than whichever happened to be listed first.
    if (!best || candidate.totalSaving > best.totalSaving) best = candidate;
  }

  return best;
}

/**
 * A plan's length as a person would say it. Derived, never fixed: Breakfast
 * 30 is "a month" and Milk 15 is not, and writing "a month" into the copy
 * would be wrong for half the plans that exist today.
 */
export function humaniseDuration(days: number): string {
  if (days === 30 || days === 31) return 'a month';
  if (days === 7) return 'a week';
  if (days === 14) return '2 weeks';
  if (days === 15) return '15 days';
  return `${days} days`;
}

/** A cart line paired with the plan that would have delivered it cheaper. */
export interface CartSaving extends Savings {
  itemName: string;
}

/**
 * The single best subscription offer for a whole cart, or null.
 *
 * ONE OFFER, NOT A LIST. This used to sit under every matching item, which
 * repeated the same argument down the page and buried the strongest version
 * of it. Below the total there is room for one line, so it has to be the
 * biggest saving — a customer weighing a plan is weighing the best case, and
 * three competing nudges make each of them smaller.
 */
export function bestCartSaving(
  items: Array<{ item_id: number; item_type: 'food' | 'essential'; name: string }>,
  plans: PlanForSavings[],
  priceOf: (itemId: number) => number | null,
  minSaving: number = MIN_SAVING_RUPEES,
): CartSaving | null {
  let best: CartSaving | null = null;
  for (const item of items) {
    const s = savingsForItem(item.item_id, item.item_type, plans, priceOf, minSaving);
    if (!s) continue;
    if (!best || s.totalSaving > best.totalSaving) best = { ...s, itemName: item.name };
  }
  return best;
}
