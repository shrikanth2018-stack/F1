/**
 * 1stOne F1 — The recipe grammar
 *
 * A menu's contents live in `menu_items.ingredients` as text:
 *
 *     Idli:2 no;Sambar:150 ml;Chutney:100 g
 *
 * That string is what `get_kitchen_aggregate` parses to build the prep board,
 * so this file and that function have to agree exactly. Everything that reads
 * or writes a recipe goes through here — the editor, and nothing else.
 *
 * UNITS ARE A CLOSED SET, and that is load-bearing rather than tidiness. The
 * kitchen groups prep by (name, unit), so `4` and `4 no` are DIFFERENT units:
 * the same ingredient would appear as two prep lines and one of them would be
 * under-cooked. A free-text quantity is how that happens, which is why the
 * editor offers a picker and `buildRecipe` refuses anything else.
 *
 * The old composer built recipes with `parseInt(qty, 10)`, which turned
 * `150 ml` into `150` — it could not round-trip its own data. That is the bug
 * this file exists to make impossible.
 */

/** Stored token → label shown in the picker. Compact on the row, readable in the UI. */
export const MENU_UNITS = [
  { key: 'no', label: 'Numbers' },
  { key: 'g', label: 'Grams' },
  { key: 'ml', label: 'ML' },
  { key: 'cup', label: 'Cup' },
  { key: 'plate', label: 'Plate' },
  { key: 'bowl', label: 'Bowl' },
] as const;

export type MenuUnit = (typeof MENU_UNITS)[number]['key'];

const UNIT_KEYS = MENU_UNITS.map((u) => u.key) as readonly string[];

export function isMenuUnit(u: string): u is MenuUnit {
  return UNIT_KEYS.includes(u);
}

export function unitLabel(u: string): string {
  return MENU_UNITS.find((x) => x.key === u)?.label ?? u;
}

/** One line of a recipe: which block, how much of it. */
export interface RecipePart {
  name: string;
  /** Kept as text so a part-typed "1." does not become NaN mid-edit. */
  qty: string;
  unit: MenuUnit;
}

/**
 * Read a stored recipe.
 *
 * Tolerant on the way in, strict on the way out: anything unparseable becomes
 * a part with the default unit rather than being dropped, because silently
 * losing an ingredient from a dish is worse than showing it oddly and letting
 * someone fix it.
 */
export function parseRecipe(text?: string | null): RecipePart[] {
  if (!text || !text.trim()) return [];

  return text
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const idx = chunk.indexOf(':');
      const name = (idx >= 0 ? chunk.slice(0, idx) : chunk).trim();
      const rest = (idx >= 0 ? chunk.slice(idx + 1) : '').trim();

      const m = rest.match(/^([0-9]*\.?[0-9]+)\s*(.*)$/);
      const qty = m ? m[1] : '1';
      const rawUnit = (m ? m[2] : '').trim().toLowerCase();

      return {
        name,
        qty,
        unit: (isMenuUnit(rawUnit) ? rawUnit : 'no') as MenuUnit,
      };
    })
    .filter((p) => p.name.length > 0);
}

/**
 * Write a recipe back.
 *
 * Always `name:<number> <unit>`, because that is the only shape the kitchen
 * parser and `parseRecipe` both round-trip. Parts with no quantity are
 * dropped rather than written as `name:` — the aggregate would read that as a
 * quantity of 1 and quietly over-order.
 */
export function buildRecipe(parts: RecipePart[]): string {
  return parts
    .map((p) => ({ ...p, name: p.name.trim(), qty: p.qty.trim() }))
    .filter((p) => p.name && p.qty && Number.isFinite(Number(p.qty)) && Number(p.qty) > 0)
    .map((p) => `${p.name}:${Number(p.qty)} ${isMenuUnit(p.unit) ? p.unit : 'no'}`)
    .join(';');
}

/** "2 no", for a summary line. */
export function formatQuantity(qty: string | number, unit: string): string {
  return `${qty} ${unitLabel(unit).toLowerCase()}`;
}

/**
 * A one-line summary of a recipe, for the row under a menu's name.
 * Names only — quantities belong in the editor, not in a list.
 */
export function summariseRecipe(text?: string | null): string {
  return parseRecipe(text).map((p) => p.name).join(' · ');
}
