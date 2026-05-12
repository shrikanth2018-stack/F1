/**
 * 1stOne F1 — CSV parsers for admin Import Items flow
 *
 * Pure functions extracted from ImportItemsScreen so they can be unit-tested.
 * No file I/O, no DB — just text → typed rows.
 */

/**
 * Split a single CSV line into fields, honouring double-quoted fields that
 * contain commas (e.g. `"Idli, Sambar Combo",Breakfast` → ['Idli, Sambar Combo','Breakfast']).
 * Inside quotes, `""` becomes a literal `"` per RFC 4180.
 */
export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      result.push(cell);
      cell = '';
      continue;
    }
    cell += ch;
  }
  result.push(cell);
  return result;
}

/** Strip leading UTF-8 BOM if present. Excel saves CSVs with one. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

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
  // 'food' / 'essentials' when recognized; otherwise the raw lowercased
  // value from the CSV so the import screen can surface it as a per-row
  // error ("type 'meal' not recognized") instead of silently coercing.
  type: 'food' | 'essentials' | string;
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
  return stripBom(text)
    .split(/\r?\n/)                    // tolerate Windows \r\n
    .slice(1)                          // skip header
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, cycle_name, ingredients, priceStr] = splitCsvLine(line);
      return {
        name: name?.trim() ?? '',
        cycle_name: cycle_name?.trim() ?? '',
        ingredients: ingredients?.trim() ?? '',
        price: parseFloat(priceStr ?? '') || 0,
      };
    })
    .filter((r) => r.name && r.cycle_name);
}

export function parseEssentialsCsv(text: string): EssentialRow[] {
  return stripBom(text)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, cycle_name, priceStr, unit] = splitCsvLine(line);
      return {
        name: name?.trim() ?? '',
        cycle_name: cycle_name?.trim() ?? '',
        price: parseFloat(priceStr ?? '') || 0,
        unit: unit?.trim() ?? '',
      };
    })
    .filter((r) => r.name && r.cycle_name);
}

export function parsePlansCsv(text: string): PlanRow[] {
  return stripBom(text)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, cycle_name, type, daysStr, priceStr, coreItemsRaw, savingsStr] = splitCsvLine(line);
      const rawType = (type ?? '').trim().toLowerCase();
      // Accept both forms: food/foods → 'food', essential/essentials → 'essentials'.
      // Anything else: keep the raw value so the screen can flag the row instead
      // of silently coercing to 'food' (which used to swallow "essential" typos).
      const normalizedType =
        rawType === 'food' || rawType === 'foods'
          ? 'food'
          : rawType === 'essential' || rawType === 'essentials'
            ? 'essentials'
            : rawType;
      return {
        name: name?.trim() ?? '',
        cycle_name: cycle_name?.trim() ?? '',
        type: normalizedType,
        duration_days: parseInt(daysStr ?? '', 10) || 30,
        price: parseFloat(priceStr ?? '') || 0,
        core_items: parseCoreItems(coreItemsRaw ?? ''),
        savings_amount: parseFloat(savingsStr ?? '0') || 0,
      };
    })
    .filter((r) => r.name && r.cycle_name);
}
