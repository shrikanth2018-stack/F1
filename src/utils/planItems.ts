/**
 * 1stOne F1 — A subscription plan's contents.
 *
 * A plan is composed of building-block ITEMS, exactly as a menu is. Both are
 * stage-2 things you can build out of stage-1 parts; a plan is not built out
 * of menus, because that would nest one composition inside another and hide
 * from the kitchen what a subscriber actually receives each day.
 *
 * A LINE IS A COUNT OF THE BLOCK'S OWN PORTION — "Sambar 150 ml × 1" — the
 * same grammar `MenuEditorModal` uses, and for the same reason: the portion
 * belongs to the block, so a plan that restated it would be a second copy of a
 * fact nothing keeps in step.
 *
 * THE PORTION IS STORED ON THE LINE ANYWAY, and that is not a contradiction.
 * `unit` / `base_quantity` are written as a SNAPSHOT of what was sold, the
 * same principle as `order_items.price_at_time`: change Sambar's portion next
 * month and a plan already bought still reads the way the customer bought it.
 * Both are optional, so plans written before this shipped still render.
 *
 * QUANTITY IS AN INTEGER, and has to be: `generate_daily_manifest` casts it
 * with `(item->>'quantity')::INTEGER`. That is why `fromRecipe` below rounds
 * rather than carrying a fraction through.
 */

import { parseRecipe, portionCount, toMenuUnit } from './menuRecipe';

/**
 * One line of a plan. `item_id` points at a `menu_items` row with
 * `is_customer_visible = false` for food plans, and at an
 * `essentials_catalog` row for essentials plans.
 */
export interface PlanLine {
  item_id: number;
  item_name: string;
  /** How many of the block's own portion, per day. */
  quantity: number;
  /** Snapshot of the block's unit at the time the plan was built. */
  unit?: string | null;
  /** Snapshot of how much of `unit` one portion is. */
  base_quantity?: number | null;
}

/** The part of a block this module needs. Kept structural so tests need no DB. */
export interface BlockLike {
  id: number;
  name: string;
  price: number;
  unit?: string | null;
  base_quantity?: number | null;
}

/**
 * How much one of the block is. Falls back to 1 rather than 0, so a missing
 * portion degrades a line to its raw count instead of erasing it.
 *
 * Takes the portion-bearing shape rather than a whole `BlockLike`, so callers
 * holding a partial row (the CSV importer's lookup) can use it too.
 */
export function portionOf(block?: { base_quantity?: number | null } | null): number {
  return Number(block?.base_quantity ?? 1) || 1;
}

/**
 * What one day of this plan costs at block prices.
 *
 * A block's price buys ONE portion — Sambar is ₹10 for 150 ml — so a line of
 * ×2 is ₹20, never ₹10 × 300. Lines whose block has gone missing contribute
 * nothing rather than throwing: the admin can still see and fix the rest.
 */
export function dailyTotal(lines: PlanLine[], blocks: BlockLike[]): number {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const total = lines.reduce((sum, l) => {
    const b = byId.get(l.item_id);
    if (!b) return sum;
    return sum + (Number(b.price) || 0) * (Number(l.quantity) || 0);
  }, 0);
  return Math.round(total * 100) / 100;
}

/**
 * What the plan costs for its whole run.
 *
 * This multiplication is the entire point of the function. Without it the
 * builder set a food plan's price to ONE day's total and then charged that
 * once for the whole duration — plan #25 was ₹115 for 30 days of a ₹115
 * breakfast. See the regression test named after it.
 */
export function planPriceFor(daily: number, days: number): number {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.round((Number(daily) || 0) * d * 100) / 100;
}

/** A line whose count had to be rounded to fit an integer quantity. */
export interface Adjusted {
  name: string;
  /** What the menu's recipe asked for, e.g. "200 ml". */
  from: string;
  /** What the plan line became, e.g. "150 ml". */
  to: string;
}

export interface FromRecipeResult {
  lines: PlanLine[];
  /** Rows the rounding changed — the screen names these rather than staying quiet. */
  adjusted: Adjusted[];
  /** Recipe parts with no matching block. Empty against today's menu. */
  unmatched: string[];
}

/**
 * Turn a menu's recipe into plan lines — the "Start from a menu" shortcut.
 *
 * A recipe line is an absolute amount ("Sambar:200 ml"); a plan line is a
 * count of portions. Converting between them is `portionCount`, which is
 * exact for 72 of the menu's 77 lines. The other five are not whole multiples
 * — Lunch Box takes 200 ml of a 150 ml Sambar — and since the count must be a
 * whole number those get rounded, to a minimum of one.
 *
 * The rounding is REPORTED, not swallowed. A prefill that quietly served 150
 * ml where the menu says 200 ml would be a plan that differs from the dish it
 * was copied from, with nothing on screen to say so.
 */
export function fromRecipe(ingredients: string | null | undefined, blocks: BlockLike[]): FromRecipeResult {
  const byName = new Map(blocks.map((b) => [b.name.toLowerCase(), b]));
  const lines: PlanLine[] = [];
  const adjusted: Adjusted[] = [];
  const unmatched: string[] = [];

  for (const part of parseRecipe(ingredients)) {
    const block = byName.get(part.name.toLowerCase());
    if (!block) {
      unmatched.push(part.name);
      continue;
    }
    const portion = portionOf(block);
    const unit = toMenuUnit(block.unit ?? part.unit);
    const exact = portionCount(Number(part.qty) || 0, portion);
    const rounded = Math.max(1, Math.round(exact));

    if (rounded !== exact) {
      adjusted.push({
        name: block.name,
        from: `${Number(part.qty) || 0} ${unit}`,
        to: `${rounded * portion} ${unit}`,
      });
    }

    lines.push({
      item_id: block.id,
      item_name: block.name,
      quantity: rounded,
      unit,
      base_quantity: portion,
    });
  }

  return { lines, adjusted, unmatched };
}

/**
 * How a plan line reads to a human — "Sambar 150 ml" for a count of one,
 * "Sambar 2 × 150 ml" above that.
 *
 * Falls back to the old "Sambar ×1" when no portion was stored, so plans
 * written before the snapshot existed still render sensibly rather than
 * claiming a portion of 1.
 */
export function formatPlanLine(line: PlanLine): string {
  const qty = Number(line.quantity) || 0;
  const portion = Number(line.base_quantity);
  const unit = (line.unit ?? '').trim();

  if (!unit || !Number.isFinite(portion) || portion <= 0) {
    return `${line.item_name} ×${qty}`;
  }
  if (qty === 1) {
    return `${line.item_name} ${portion} ${unit}`;
  }
  return `${line.item_name} ${qty} × ${portion} ${unit}`;
}
