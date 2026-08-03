/**
 * 1stOne F1 — The recipe grammar
 *
 * A menu's contents live in `menu_items.ingredients` as text:
 *
 *     Idli:2 nos;Sambar:150 ml;Chutney:100 gms
 *
 * That string is what `get_kitchen_aggregate` parses to build the prep board,
 * so this file and that function have to agree exactly. Everything that reads
 * or writes a recipe goes through here — the editor, and nothing else.
 *
 * UNITS ARE A CLOSED SET, and that is load-bearing rather than tidiness. The
 * kitchen groups prep by (name, unit), so `4` and `4 nos` are DIFFERENT units:
 * the same ingredient would appear as two prep lines and one of them would be
 * under-cooked. A free-text quantity is how that happens, which is why the
 * editor offers a picker and `buildRecipe` refuses anything else.
 *
 * The old composer built recipes with `parseInt(qty, 10)`, which turned
 * `150 ml` into `150` — it could not round-trip its own data. That is the bug
 * this file exists to make impossible.
 */

/**
 * The closed set. THE TOKEN IS THE DISPLAY — the kitchen board prints the unit
 * straight out of the recipe text the server aggregates, so there is no screen
 * that could translate it. Storing "gms" rather than "g" is what makes the
 * prep board read "1200 gms" without a mapping layer anyone could forget.
 */
export const MENU_UNITS = ['nos', 'gms', 'ml', 'cup', 'plate', 'bowl'] as const;

export type MenuUnit = (typeof MENU_UNITS)[number];

export const DEFAULT_UNIT: MenuUnit = 'nos';

/**
 * Older data said 'g' and 'no'. `menu_unit_wording.sql` rewrote the database,
 * but a recipe cached on a phone from before that release still holds them, so
 * reading tolerates both — writing only ever produces the new tokens.
 */
const LEGACY: Record<string, MenuUnit> = { g: 'gms', gm: 'gms', no: 'nos', nr: 'nos' };

export function isMenuUnit(u: string): u is MenuUnit {
  return (MENU_UNITS as readonly string[]).includes(u);
}

/** Normalise anything readable into a real unit. */
export function toMenuUnit(u?: string | null): MenuUnit {
  const k = (u ?? '').trim().toLowerCase();
  return isMenuUnit(k) ? k : LEGACY[k] ?? DEFAULT_UNIT;
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

      return { name, qty, unit: toMenuUnit(rawUnit) };
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
    .map((p) => `${p.name}:${Number(p.qty)} ${toMenuUnit(p.unit)}`)
    .join(';');
}

/**
 * A one-line summary of a recipe, for the row under a menu's name.
 * Names only — quantities belong in the editor, not in a list.
 */
export function summariseRecipe(text?: string | null): string {
  return parseRecipe(text).map((p) => p.name).join(' · ');
}
