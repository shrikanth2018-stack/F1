/**
 * 1stOne F1 — Import Items Screen
 *
 * Shared import screen for Menu Manager, Essentials Manager, and Subscription Plans.
 * 1. Download a CSV template (pre-filled with headers + example row).
 * 2. Fill it in Excel / Sheets.
 * 3. Upload the filled CSV — parsed rows shown with count.
 * 4. Confirm → bulk insert into the relevant table.
 *
 * route.params.type: 'menu' | 'essentials' | 'plans'
 *
 * Requires: expo-file-system, expo-sharing, expo-document-picker
 */

import React, { useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { getErrorMessage } from '../../utils/formatters';
import { confirmDialog, infoDialog } from '../../utils/confirmDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { supabase } from '../../api/supabaseClient';
import { useAllDeliveryCycles, useAllMenuItems } from '../../hooks/useMenuManagement';
import { useEssentialsCatalog } from '../../hooks/useEssentials';
import { useBranchFilter, requireWriteBranch } from '../../hooks/useBranchFilter';
import {
  parseMenuCsv,
  parseEssentialsCsv,
  parsePlansCsv,
  type MenuRow,
  type EssentialRow,
  type PlanRow,
} from '../../utils/csvParsers';
import {
  parseRecipe, buildRecipe, toMenuUnit, DEFAULT_UNIT, type MenuUnit,
} from '../../utils/menuRecipe';
import { downloadCsvString } from '../../utils/exportCsv';
import type { AdminScreenProps } from '../../navigation/types';
import { Platform } from 'react-native';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// ── CSV template builders ────────────────────────────────
// Templates are generated on demand from CURRENT cycles + item catalogs so
// every download reflects what's in the DB today (renamed cycles, new cycles,
// actual item names for plan examples).

type AnyCycle = { id: number; cycle_name: string; is_essentials?: boolean | null };
type AnyItem  = { id: number; name: string; cycle_id: number | null };

function cycleHeader(cycles: AnyCycle[]): string {
  const names = cycles.map((c) => c.cycle_name).filter(Boolean);
  return names.length > 0 ? `Cycle (${names.join('/')})` : 'Cycle';
}

function buildMenuTemplate(cycles: AnyCycle[]): string {
  const header = `Menu Name,${cycleHeader(cycles)},Sub-Items (name:qty;name2:qty2),Price\n`;
  const first = cycles[0]?.cycle_name ?? 'Breakfast';
  const second = cycles[1]?.cycle_name ?? 'Lunch';
  return header +
    `Example Tiffin,${first},Idli:2;Sambar:100ml;Chutney:30g,120\n` +
    `Example Meal,${second},Rice:200g;Dal:100ml;Sabzi:80g,150\n`;
}

function buildEssentialsTemplate(cycles: AnyCycle[]): string {
  const essCycles = cycles.filter((c) => c.is_essentials);
  const header = `Item Name,${cycleHeader(essCycles.length > 0 ? essCycles : cycles)},Price,Unit\n`;
  const first = essCycles[0]?.cycle_name ?? cycles[0]?.cycle_name ?? 'Breakfast';
  return header +
    `Full Cream Milk,${first},45,1L\n` +
    `Fresh Bread,${first},35,400g\n`;
}

function buildPlansTemplate(cycles: AnyCycle[], menuItems: AnyItem[], essItems: AnyItem[]): string {
  const header =
    `Plan Name,${cycleHeader(cycles)},Type (food/essentials),Number of Days,Price,` +
    `Core Items (name:qty;name2:qty2),Savings Amount\n`;
  const firstCycle = cycles[0];
  const firstMenu = menuItems.find((m) => m.cycle_id === firstCycle?.id) ?? menuItems[0];
  const firstEss  = essItems[0];
  const foodExample = firstMenu
    ? `Example Food 30,${firstCycle?.cycle_name ?? 'Breakfast'},food,30,2000,${firstMenu.name}:1,400\n`
    : '';
  const essExample = firstEss
    ? `Example Essentials 30,${cycles.find((c) => c.id === firstEss.cycle_id)?.cycle_name ?? 'Breakfast'},essentials,30,1950,${firstEss.name}:1,150\n`
    : '';
  return header + foodExample + essExample;
}

// ── Screen ───────────────────────────────────────────────
export function ImportItemsScreen({ navigation, route }: AdminScreenProps<'ImportItems'>) {
  const type: 'menu' | 'essentials' | 'plans' = route.params?.type ?? 'menu';
  const isMenu = type === 'menu';
  const isPlans = type === 'plans';

  const queryClient = useQueryClient();
  const branchFilter = useBranchFilter();
  const { data: cycles = [] } = useAllDeliveryCycles();
  // Menu + essentials only fetched when building the Plans template (needed for Core Items example lookup).
  const { data: menuItems = [] } = useAllMenuItems();
  const { data: essItems = [] } = useEssentialsCatalog();

  const [parsedRows, setParsedRows] = useState<MenuRow[] | EssentialRow[] | PlanRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');

  // ── Download template ──────────────────────────────────
  const handleDownloadTemplate = async () => {
    try {
      const csv = isMenu
        ? buildMenuTemplate(cycles as AnyCycle[])
        : isPlans
          ? buildPlansTemplate(cycles as AnyCycle[], menuItems as AnyItem[], essItems as AnyItem[])
          : buildEssentialsTemplate(cycles as AnyCycle[]);
      const name = isMenu ? 'menu_import_template.csv' : isPlans ? 'plans_import_template.csv' : 'essentials_import_template.csv';
      await downloadCsvString(name, csv);
    } catch {
      infoDialog('Error', 'Could not generate template.');
    }
  };

  // ── Pick & parse CSV ───────────────────────────────────
  const handleUpload = async () => {
    try {
      const DocumentPicker = require('expo-document-picker');

      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'public.comma-separated-values-text', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setFileName(asset.name ?? 'file.csv');

      // Web: the picker hands us a real File on asset.file — read it directly.
      // Native: read via the FileSystem URI (the /legacy entry in SDK 54).
      let csvText: string;
      if (Platform.OS === 'web' && (asset as any).file) {
        csvText = await (asset as any).file.text();
      } else {
        const FileSystem = require('expo-file-system/legacy');
        csvText = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      const rows = isMenu ? parseMenuCsv(csvText) : isPlans ? parsePlansCsv(csvText) : parseEssentialsCsv(csvText);

      if (!rows.length) {
        infoDialog('Empty file', 'No valid rows found. Check the template format.');
        return;
      }

      setParsedRows(rows as any);
    } catch {
      infoDialog('Error', 'Could not read file. Please pick a valid CSV.');
    }
  };

  // ── Bulk insert ────────────────────────────────────────
  // Two phases:
  //  1. Build validated records + collect per-row skip reasons (cycle miss,
  //     unknown plan type, unresolved plan core item).
  //  2. If anything was skipped, confirm with the user before inserting.
  //     If everything was skipped, abort.
  type Skip = { row: number; reason: string };

  const buildRecords = (): { records: any[]; skipped: Skip[]; table: string; queryKeys: string[][] } => {
    const cycleMap: Record<string, number> = {};
    for (const c of cycles) {
      cycleMap[(c as any).cycle_name?.toLowerCase()] = (c as any).id;
    }
    const writeBranchId = requireWriteBranch(branchFilter);
    const skipped: Skip[] = [];

    if (isMenu) {
      const rows = parsedRows as MenuRow[];
      const records: any[] = [];
      rows.forEach((r, i) => {
        const csvRow = i + 2; // header is row 1
        const cycle_id = cycleMap[r.cycle_name.toLowerCase()];
        if (cycle_id == null) {
          skipped.push({ row: csvRow, reason: `cycle "${r.cycle_name}" not recognized` });
          return;
        }
        records.push({
          name: r.name,
          cycle_id,
          ingredients: r.ingredients || null,
          price: r.price,
          is_active: true,
          sort_order: 0,
          branch_id: writeBranchId,
        });
      });
      return { records, skipped, table: 'menu_items', queryKeys: [['admin_menu_items'], ['menuItems']] };
    }

    if (isPlans) {
      const rows = parsedRows as PlanRow[];
      const menuLookup: Record<string, { id: number; name: string }> = {};
      for (const m of menuItems as AnyItem[]) {
        if (m.name) menuLookup[m.name.toLowerCase()] = { id: m.id, name: m.name };
      }
      const essLookup: Record<string, { id: number; name: string }> = {};
      for (const e of essItems as AnyItem[]) {
        if (e.name) essLookup[e.name.toLowerCase()] = { id: e.id, name: e.name };
      }

      const records: any[] = [];
      rows.forEach((r, i) => {
        const csvRow = i + 2;
        const cycle_id = cycleMap[r.cycle_name.toLowerCase()];
        if (cycle_id == null) {
          skipped.push({ row: csvRow, reason: `cycle "${r.cycle_name}" not recognized` });
          return;
        }
        if (r.type !== 'food' && r.type !== 'essentials') {
          skipped.push({ row: csvRow, reason: `type "${r.type}" not recognized — use food or essentials` });
          return;
        }
        const catalog = r.type === 'essentials' ? essLookup : menuLookup;
        const missing: string[] = [];
        const resolvedItems: Array<{ item_id: number; item_name: string; quantity: number }> = [];
        for (const ci of r.core_items) {
          const hit = catalog[ci.name.toLowerCase()];
          if (hit) {
            resolvedItems.push({ item_id: hit.id, item_name: hit.name, quantity: ci.quantity });
          } else {
            missing.push(ci.name);
          }
        }
        if (missing.length > 0) {
          // Whole-row reject: a partial plan would shortchange the subscriber.
          skipped.push({
            row: csvRow,
            reason: `${missing.length} ${r.type} item${missing.length !== 1 ? 's' : ''} not in catalog: ${missing.join(', ')}`,
          });
          return;
        }
        if (resolvedItems.length === 0) {
          skipped.push({ row: csvRow, reason: 'no core items specified' });
          return;
        }
        records.push({
          plan_name: r.name,
          cycle_id,
          plan_type: r.type,
          duration_days: r.duration_days,
          price: r.price,
          plan_items: JSON.stringify(resolvedItems),
          savings_amount: r.savings_amount,
          is_active: true,
          branch_id: writeBranchId,
        });
      });
      return { records, skipped, table: 'subscription_plans', queryKeys: [['admin_plans']] };
    }

    // Essentials catalog
    const rows = parsedRows as EssentialRow[];
    const records: any[] = [];
    rows.forEach((r, i) => {
      const csvRow = i + 2;
      const cycle_id = cycleMap[r.cycle_name.toLowerCase()];
      if (cycle_id == null) {
        skipped.push({ row: csvRow, reason: `cycle "${r.cycle_name}" not recognized` });
        return;
      }
      records.push({
        name: r.name,
        cycle_id,
        price: r.price,
        unit: r.unit || null,
        is_active: true,
        branch_id: writeBranchId,
      });
    });
    return { records, skipped, table: 'essentials_catalog', queryKeys: [['admin_essentials']] };
  };

  /** Most frequent value, ties broken by first appearance so a re-run agrees. */
  const commonest = <T,>(values: T[]): T | undefined => {
    const tally = new Map<T, number>();
    for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
    let best: T | undefined;
    let bestN = 0;
    for (const [v, n] of tally) if (n > bestN) { best = v; bestN = n; }
    return best;
  };

  /**
   * Settle the building blocks a menu import needs, and rewrite its recipes to
   * match them. Menus only — essentials and plans carry no recipes.
   *
   * THREE THINGS THE IMPORTER USED TO GET WRONG.
   *
   * It only ever wrote the MENU rows, so after the last import 49 blocks had
   * to be made by hand, and until they were, Step 2 could not show those
   * recipes as pickable items.
   *
   * It then created them with no unit, so every one landed as 'nos' while the
   * recipe text still said "150 ml". The row and the text disagreed, and the
   * next save of that menu — which resolves the unit from the item — quietly
   * rewrote 150 ml into 150 nos. Here the unit is read back OUT of the recipes
   * the block appears in, majority wins, exactly as menu_item_units.sql did
   * for the existing catalogue. The portion the price buys is inferred the
   * same way.
   *
   * And it wrote the CSV's spelling verbatim, so "sambar" became a second
   * block beside "Sambar". Every component name is now canonicalised to the
   * existing block's spelling — the invariant menu_manager_rebuild.sql §3b
   * established and that the Step 2 editor relies on to match a recipe to
   * pickable items.
   *
   * Returns how many blocks were created. Blocks land at ₹0: they are recipe
   * parts, and a price is only needed when a bulk order buys one on its own.
   */
  const prepareMenuRecords = async (records: any[]): Promise<number> => {
    // What every recipe in this import asks for, tolerant of CSV spelling
    // ("150ml", "1n") because parseRecipe normalises on the way in.
    const wanted = new Map<string, { name: string; qty: string; unit: MenuUnit }[]>();
    for (const r of records) {
      for (const p of parseRecipe(r.ingredients)) {
        const key = p.name.toLowerCase();
        wanted.set(key, [...(wanted.get(key) ?? []), p]);
      }
    }
    if (wanted.size === 0) return 0;

    // An existing block's spelling and unit win outright: it is already
    // referenced by live recipes, and changing its unit is a cascade this
    // screen has no business running.
    const { data: existing } = await supabase
      .from('menu_items')
      .select('name, unit')
      .eq('is_customer_visible', false);

    const canon = new Map<string, { name: string; unit: MenuUnit }>();
    for (const b of (existing ?? []) as { name: string; unit?: string | null }[]) {
      canon.set(String(b.name).toLowerCase(), { name: b.name, unit: toMenuUnit(b.unit) });
    }

    let created = 0;
    for (const [key, uses] of wanted) {
      if (canon.has(key)) continue;
      const name = uses[0].name;
      const unit = commonest(uses.map((u) => u.unit)) ?? DEFAULT_UNIT;
      // The portion is only meaningful in the unit that won, so a stray
      // "Sagu:200 gms" does not set the base quantity of an ml item.
      const qty = Number(commonest(uses.filter((u) => u.unit === unit).map((u) => u.qty)) ?? '1');

      // One RPC per name: it is the only path that sets cycle_id NULL and
      // is_customer_visible false, which the menu_items_shape constraint
      // requires. A handful of calls on an import nobody runs often.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('admin_create_menu_block', {
        p_name: name,
        p_price: 0,
        p_branch_id: branchFilter.branchIdForWrite,
        p_unit: unit,
        p_base_qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      });
      canon.set(key, { name, unit });
      created++;
    }

    // Rewrite each recipe in the block's spelling and unit. buildRecipe is the
    // only writer of this grammar, so what lands in the DB is already in the
    // shape get_kitchen_aggregate parses — no "Buns;2" or "150ml" can survive.
    for (const r of records) {
      const parts = parseRecipe(r.ingredients).map((p) => {
        const c = canon.get(p.name.toLowerCase());
        return c ? { ...p, name: c.name, unit: c.unit } : p;
      });
      r.ingredients = buildRecipe(parts) || null;
    }

    return created;
  };

  const performInsert = async (records: any[], table: string, queryKeys: string[][]) => {
    try {
      // Blocks FIRST, and the recipes rewritten against them, because the menu
      // rows are what get normalised. The failure this order chooses is a few
      // unused ₹0 blocks if the insert then fails — removable in one tap, and
      // far better than the other way round, which leaves a live menu whose
      // recipe names something that does not exist.
      const created = isMenu ? await prepareMenuRecords(records) : 0;

      // PostgREST .from() expects a literal table-name union; runtime table is
      // one of the three import targets, all valid. Cast keeps the helper generic.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from(table as any) as any).insert(records as any);
      if (error) throw error;

      queryKeys.forEach((qk) => queryClient.invalidateQueries({ queryKey: qk }));
      queryClient.invalidateQueries({ queryKey: ['menu_blocks'] });
      queryClient.invalidateQueries({ queryKey: ['menus_for_cycle'] });

      infoDialog(
        'Import complete',
        `${records.length} item${records.length !== 1 ? 's' : ''} imported.` +
          (created > 0
            ? `\n\n${created} new menu item${created !== 1 ? 's' : ''} created from the recipes, each measured as the recipes use it and priced at ₹0 — set a price and the quantity it buys on the Menu Items tab if it will be sold on its own.`
            : ''),
      ).then(() => navigation.goBack());
    } catch (err) {
      infoDialog('Import failed', getErrorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    if (!parsedRows?.length) return;
    if (branchFilter.branchIdForWrite == null) {
      infoDialog('Select a branch', 'Pick a specific branch before importing items.');
      return;
    }
    setImporting(true);

    const { records, skipped, table, queryKeys } = buildRecords();

    if (skipped.length === 0) {
      await performInsert(records, table, queryKeys);
      return;
    }

    const head = skipped.slice(0, 5).map((s) => `Row ${s.row}: ${s.reason}`).join('\n');
    const tail = skipped.length > 5 ? `\n…and ${skipped.length - 5} more` : '';

    if (records.length === 0) {
      infoDialog(
        'Nothing to import',
        `All ${skipped.length} row${skipped.length !== 1 ? 's' : ''} had issues:\n\n${head}${tail}\n\nFix your CSV and try again.`,
      );
      setImporting(false);
      return;
    }

    const proceed = await confirmDialog({
      title: `Skip ${skipped.length} row${skipped.length !== 1 ? 's' : ''}?`,
      message: `${head}${tail}\n\nImport the ${records.length} valid row${records.length !== 1 ? 's' : ''} and skip the rest?`,
      confirmLabel: `Import ${records.length}`,
    });
    if (proceed) await performInsert(records, table, queryKeys);
    else setImporting(false);
  };

  const title = isMenu ? 'Import Menu Items' : isPlans ? 'Import Plans' : 'Import Essentials';
  const rowCount = parsedRows?.length ?? 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>{title}</ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Step 1 */}
        <View style={styles.stepRow}>
          <ThemedText variant="small" color="muted" style={styles.stepNum}>1</ThemedText>
          <View style={styles.stepBody}>
            <ThemedText variant="body" color="primary" style={styles.txt}>Download the template</ThemedText>
            <ThemedText variant="small" color="muted" style={styles.sub}>
              {isMenu
                ? 'Columns: Menu Name, Cycle, Sub-Items (name:qty;…), Price'
                : isPlans
                ? 'Columns: Plan Name, Cycle, Type (food/essentials), Number of Days, Price, Core Items (name:qty;…), Savings Amount'
                : 'Columns: Item Name, Cycle, Price, Unit'}
              {'\n'}Template is built from your current cycles — download fresh each time you make changes.
            </ThemedText>
            <TouchableOpacity style={styles.actionLink} onPress={handleDownloadTemplate}>
              <ThemedText variant="body" color="mint" style={styles.txt}>Download Template  ›</ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Step 2 */}
        <View style={styles.stepRow}>
          <ThemedText variant="small" color="muted" style={styles.stepNum}>2</ThemedText>
          <View style={styles.stepBody}>
            <ThemedText variant="body" color="primary" style={styles.txt}>Fill it in and save as CSV</ThemedText>
            <ThemedText variant="small" color="muted" style={styles.sub}>
              Works with Excel, Google Sheets, or any spreadsheet app.
              Save / export as .csv when done.
            </ThemedText>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Step 3 */}
        <View style={styles.stepRow}>
          <ThemedText variant="small" color="muted" style={styles.stepNum}>3</ThemedText>
          <View style={styles.stepBody}>
            <ThemedText variant="body" color="primary" style={styles.txt}>Upload the filled CSV</ThemedText>
            <TouchableOpacity style={styles.actionLink} onPress={handleUpload}>
              <ThemedText variant="body" color="mint" style={styles.txt}>
                {fileName ? `✓  ${fileName}` : 'Choose CSV file  ›'}
              </ThemedText>
            </TouchableOpacity>

            {rowCount > 0 && (
              <ThemedText variant="small" color="muted" style={[styles.sub, styles.parseInfo]}>
                {rowCount} row{rowCount !== 1 ? 's' : ''} ready to import
              </ThemedText>
            )}
          </View>
        </View>

      </ScrollView>

      {/* Import footer */}
      <TouchableOpacity
        style={[styles.footer, (!rowCount || importing) && styles.footerDisabled]}
        onPress={handleImport}
        disabled={!rowCount || importing}
        activeOpacity={0.7}
      >
        {importing ? (
          <ActivityIndicator color={Theme.colors.text.mint} />
        ) : (
          <ThemedText
            variant="body"
            color={rowCount ? 'mint' : 'muted'}
            style={styles.txt}
          >
            {rowCount ? `Import ${rowCount} item${rowCount !== 1 ? 's' : ''}  ›` : 'Upload a CSV first'}
          </ThemedText>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  scroll: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl * 2,
  },

  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Theme.spacing.md,
  },
  stepNum: {
    fontSize: S,
    width: 28,
    color: Theme.colors.text.mint,
    marginTop: 2,
  },
  stepBody: { flex: 1 },
  actionLink: { marginTop: Theme.spacing.sm },
  parseInfo: { marginTop: Theme.spacing.xs },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
  },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  footerDisabled: {
    borderTopColor: Theme.colors.layout.divider,
  },

  txt: { fontSize: B },
  sub: { fontSize: S, marginTop: 4 },
});
