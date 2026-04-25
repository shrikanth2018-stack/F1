/**
 * 1stOne F1 — CSV parsers for admin Import Items flow
 *
 * Pure functions extracted from ImportItemsScreen so they can be unit-tested.
 * No file I/O, no DB — just text → typed rows.
 */

export type MenuRow = {
  name: string;
  cycle_name: string;
  ingredients: string;
  price: number;
};

export type EssentialRow = {
  name: string;
  cycle_name: string;
  price: number;
  unit: string;
};

export type PlanRow = {
  name: string;
  cycle_name: string;
  type: 'food' | 'essentials';
  duration_days: number;
  price: number;
  core_items: Array<{ name: string; quantity: number }>;
  savings_amount: number;
};

export function parseCoreItems(raw: string): Array<{ name: string; quantity: number }> {
  if (!raw) return [];
  return raw
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [name, qtyStr] = chunk.split(':').map((s) => s.trim());
      return { name: name ?? '', quantity: parseInt(qtyStr ?? '1', 10) || 1 };
    })
    .filter((it) => it.name.length > 0);
}

export function parseMenuCsv(text: string): MenuRow[] {
  return text
    .split('\n')
    .slice(1) // skip header
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, cycle_name, ingredients, priceStr] = line.split(',');
      return {
        name: name?.trim() ?? '',
        cycle_name: cycle_name?.trim() ?? '',
        ingredients: ingredients?.trim() ?? '',
        price: parseFloat(priceStr) || 0,
      };
    })
    .filter((r) => r.name && r.cycle_name);
}

export function parseEssentialsCsv(text: string): EssentialRow[] {
  return text
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, cycle_name, priceStr, unit] = line.split(',');
      return {
        name: name?.trim() ?? '',
        cycle_name: cycle_name?.trim() ?? '',
        price: parseFloat(priceStr) || 0,
        unit: unit?.trim() ?? '',
      };
    })
    .filter((r) => r.name && r.cycle_name);
}

export function parsePlansCsv(text: string): PlanRow[] {
  return text
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, cycle_name, type, daysStr, priceStr, coreItemsRaw, savingsStr] = line.split(',');
      return {
        name: name?.trim() ?? '',
        cycle_name: cycle_name?.trim() ?? '',
        type: type?.trim().toLowerCase() === 'essentials' ? ('essentials' as const) : ('food' as const),
        duration_days: parseInt(daysStr, 10) || 30,
        price: parseFloat(priceStr) || 0,
        core_items: parseCoreItems(coreItemsRaw ?? ''),
        savings_amount: parseFloat(savingsStr ?? '0') || 0,
      };
    })
    .filter((r) => r.name && r.cycle_name);
}
