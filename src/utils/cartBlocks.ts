/**
 * 1stOne F1 — the cart, as the bags it will become.
 *
 * Pure, and out here rather than inside CartScreen so it can be tested. It
 * was inline in the screen, which meant the one thing most worth pinning —
 * that deliveries come out in TIME order — had nothing asserting it. The
 * previous sort fell back to `cycleName.localeCompare`, so Dinner (7:30 PM)
 * sat above Lunch (12:30 PM): alphabetical order standing in for
 * chronological. That is the third time this codebase has ordered a time by
 * something other than the time, so it is now a test rather than a comment.
 */

import type { CartItem } from '../types';

export type Scenario = 'A' | 'B' | 'C';

/** A cycle as this module needs it. */
export interface CycleTiming {
  id: number;
  cycle_name: string;
  delivery_start?: string | null;
}

/**
 * One bag: everything from a single delivery cycle, food and essentials
 * together, because that is how it arrives.
 */
export interface DeliveryBlock {
  cycleId: number;
  cycleName: string;
  scenario: Scenario;
  items: CartItem[];
}

const rank: Record<Scenario, number> = { A: 0, B: 1, C: 2 };

/** Minutes past midnight for a cycle's dispatch, or last-in-day if unknown. */
function startMinutes(cycleId: number, cycles: CycleTiming[]): number {
  const raw = cycles.find((c) => c.id === cycleId)?.delivery_start;
  if (!raw) return 24 * 60 + 1;
  const [h, m] = String(raw).split(':').map(Number);
  if (Number.isNaN(h)) return 24 * 60 + 1;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

/**
 * Group the cart into the bags it will become, soonest first.
 *
 * Day first (the A/B/C dispatch scenario), then time of day. A cycle with no
 * known dispatch time sorts LAST within its day rather than first — an
 * unknown time is not evidence of urgency, and putting it on top would
 * displace something we know is imminent.
 */
export function groupIntoBlocks(
  items: CartItem[],
  scenarioOf: (item: CartItem) => Scenario,
  cycles: CycleTiming[],
): DeliveryBlock[] {
  const byCycle = new Map<number, CartItem[]>();
  for (const it of items) {
    byCycle.set(it.cycle_id, [...(byCycle.get(it.cycle_id) ?? []), it]);
  }

  const blocks: DeliveryBlock[] = [...byCycle.entries()].map(([cycleId, list]) => ({
    cycleId,
    cycleName: cycles.find((c) => c.id === cycleId)?.cycle_name ?? 'Items',
    scenario: scenarioOf(list[0]),
    items: list,
  }));

  blocks.sort(
    (a, b) =>
      rank[a.scenario] - rank[b.scenario] ||
      startMinutes(a.cycleId, cycles) - startMinutes(b.cycleId, cycles),
  );
  return blocks;
}

export const itemsToday = (blocks: DeliveryBlock[]): number =>
  blocks.filter((b) => b.scenario === 'A').reduce((n, b) => n + b.items.length, 0);

export const itemsLater = (blocks: DeliveryBlock[]): number =>
  blocks.filter((b) => b.scenario !== 'A').reduce((n, b) => n + b.items.length, 0);

// ── What else could ride in each bag ─────────────────────────

/** A catalogue item offered by the add-extra picker. */
export interface ExtraCandidate {
  item_id: number;
  item_type: 'food' | 'essential';
  name: string;
  price: number;
  cycle_id: number;
  unit?: string | null;
  image_path?: string | null;
  image_updated_at?: string | null;
}

/** The shape both catalogues share, as far as this needs to care. */
export interface CatalogRow {
  id: number;
  name: string;
  price: number | string;
  cycle_id?: number | null;
  unit?: string | null;
  image_path?: string | null;
  image_updated_at?: string | null;
}

/**
 * Everything on each cycle that is NOT already in the cart, keyed by cycle.
 *
 * Ordered as the two catalogues arrive, which is the admin's own `sort_order`
 * from Menu Manager — real curation, already done. There is no popularity
 * column in the schema, and deriving one from orders is not honest yet: ten
 * distinct items have ever been ordered and the top of that list is test
 * data. Swap the input ordering for a genuine best-seller list when one
 * exists; nothing here needs to change.
 *
 * An item with no cycle cannot join a delivery and is dropped — a building
 * block has none, and offering one would put an ingredient in a customer's
 * bag.
 */
export function extrasByCycle(
  menuItems: CatalogRow[],
  essentials: CatalogRow[],
  inCart: CartItem[],
  includeEssentials: boolean,
): Map<number, ExtraCandidate[]> {
  const already = new Set(inCart.map((i) => `${i.item_type}:${i.item_id}`));
  const map = new Map<number, ExtraCandidate[]>();

  const push = (c: ExtraCandidate) => {
    if (already.has(`${c.item_type}:${c.item_id}`)) return;
    map.set(c.cycle_id, [...(map.get(c.cycle_id) ?? []), c]);
  };

  for (const m of menuItems) {
    if (m.cycle_id == null) continue;
    push({
      item_id: m.id, item_type: 'food', name: m.name, price: Number(m.price),
      cycle_id: m.cycle_id, image_path: m.image_path, image_updated_at: m.image_updated_at,
    });
  }
  if (includeEssentials) {
    for (const e of essentials) {
      if (e.cycle_id == null) continue;
      push({
        item_id: e.id, item_type: 'essential', name: e.name, price: Number(e.price),
        cycle_id: e.cycle_id, unit: e.unit,
        image_path: e.image_path, image_updated_at: e.image_updated_at,
      });
    }
  }
  return map;
}
