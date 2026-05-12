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
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { supabase } from '../../api/supabaseClient';
import { useAllDeliveryCycles, useAllMenuItems } from '../../hooks/useMenuManagement';
import { useEssentialsCatalog } from '../../hooks/useEssentials';
import { useBranchFilter } from '../../hooks/useBranchFilter';
import {
  parseMenuCsv,
  parseEssentialsCsv,
  parsePlansCsv,
  type MenuRow,
  type EssentialRow,
  type PlanRow,
} from '../../utils/csvParsers';
import type { AdminScreenProps } from '../../navigation/types';

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
      const FileSystem = require('expo-file-system');
      const Sharing = require('expo-sharing');
      const csv = isMenu
        ? buildMenuTemplate(cycles as AnyCycle[])
        : isPlans
          ? buildPlansTemplate(cycles as AnyCycle[], menuItems as AnyItem[], essItems as AnyItem[])
          : buildEssentialsTemplate(cycles as AnyCycle[]);
      const name = isMenu ? 'menu_import_template.csv' : isPlans ? 'plans_import_template.csv' : 'essentials_import_template.csv';
      const uri = FileSystem.documentDirectory + name;
      await FileSystem.writeAsStringAsync(uri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
        dialogTitle: 'Save template CSV',
      });
    } catch {
      Alert.alert('Error', 'Could not generate template. Ensure expo-file-system and expo-sharing are installed.');
    }
  };

  // ── Pick & parse CSV ───────────────────────────────────
  const handleUpload = async () => {
    try {
      const DocumentPicker = require('expo-document-picker');
      const FileSystem = require('expo-file-system');

      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'public.comma-separated-values-text', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      setFileName(asset.name ?? 'file.csv');

      const csvText = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const rows = isMenu ? parseMenuCsv(csvText) : isPlans ? parsePlansCsv(csvText) : parseEssentialsCsv(csvText);

      if (!rows.length) {
        Alert.alert('Empty file', 'No valid rows found. Check the template format.');
        return;
      }

      setParsedRows(rows as any);
    } catch {
      Alert.alert('Error', 'Could not read file. Please pick a valid CSV.');
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
    const writeBranchId = branchFilter.branchIdForWrite;
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

  const performInsert = async (records: any[], table: string, queryKeys: string[][]) => {
    try {
      // PostgREST .from() expects a literal table-name union; runtime table is
      // one of the three import targets, all valid. Cast keeps the helper generic.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from(table as any) as any).insert(records as any);
      if (error) throw error;
      queryKeys.forEach((qk) => queryClient.invalidateQueries({ queryKey: qk }));
      Alert.alert(
        'Import complete',
        `${records.length} item${records.length !== 1 ? 's' : ''} imported.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      Alert.alert('Import failed', err?.message ?? 'Unknown error');
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    if (!parsedRows?.length) return;
    setImporting(true);

    const { records, skipped, table, queryKeys } = buildRecords();

    if (skipped.length === 0) {
      await performInsert(records, table, queryKeys);
      return;
    }

    const head = skipped.slice(0, 5).map((s) => `Row ${s.row}: ${s.reason}`).join('\n');
    const tail = skipped.length > 5 ? `\n…and ${skipped.length - 5} more` : '';

    if (records.length === 0) {
      Alert.alert(
        'Nothing to import',
        `All ${skipped.length} row${skipped.length !== 1 ? 's' : ''} had issues:\n\n${head}${tail}\n\nFix your CSV and try again.`,
      );
      setImporting(false);
      return;
    }

    Alert.alert(
      `Skip ${skipped.length} row${skipped.length !== 1 ? 's' : ''}?`,
      `${head}${tail}\n\nImport the ${records.length} valid row${records.length !== 1 ? 's' : ''} and skip the rest?`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setImporting(false) },
        { text: `Import ${records.length}`, onPress: () => performInsert(records, table, queryKeys) },
      ]
    );
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
