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
import { useAllDeliveryCycles } from '../../hooks/useMenuManagement';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// ── CSV templates ────────────────────────────────────────
const MENU_TEMPLATE =
  'Menu Name,Cycle (Breakfast/Lunch/Snacks/Dinner),Sub-Items (name:qty;name2:qty2),Price\n' +
  'Breakfast Thali,Breakfast,Idli:2;Sambar:100ml;Chutney:30g,120\n' +
  'South Lunch,Lunch,Rice:200g;Dal:100ml;Sabzi:80g,150\n';

const ESSENTIALS_TEMPLATE =
  'Item Name,Cycle (Breakfast/Lunch/Snacks/Dinner),Price\n' +
  'Full Cream Milk,Breakfast,45\n' +
  'Brown Bread,Breakfast,35\n';

const PLANS_TEMPLATE =
  'Plan Name,Cycle (Breakfast/Lunch/Snacks/Dinner),Type (food/essentials),Number of Days,Price\n' +
  'Breakfast Monthly,Breakfast,food,30,1200\n' +
  'Lunch Weekly,Lunch,food,7,350\n';

// ── CSV parser ───────────────────────────────────────────
type MenuRow = { name: string; cycle_name: string; ingredients: string; price: number };
type EssentialRow = { name: string; cycle_name: string; price: number };
type PlanRow = { name: string; cycle_name: string; type: string; duration_days: number; price: number };

function parseMenuCsv(text: string): MenuRow[] {
  return text
    .split('\n')
    .slice(1)                          // skip header
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

function parseEssentialsCsv(text: string): EssentialRow[] {
  return text
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, cycle_name, priceStr] = line.split(',');
      return {
        name: name?.trim() ?? '',
        cycle_name: cycle_name?.trim() ?? '',
        price: parseFloat(priceStr) || 0,
      };
    })
    .filter((r) => r.name && r.cycle_name);
}

function parsePlansCsv(text: string): PlanRow[] {
  return text
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, cycle_name, type, daysStr, priceStr] = line.split(',');
      return {
        name: name?.trim() ?? '',
        cycle_name: cycle_name?.trim() ?? '',
        type: type?.trim().toLowerCase() === 'essentials' ? 'essentials' : 'food',
        duration_days: parseInt(daysStr, 10) || 30,
        price: parseFloat(priceStr) || 0,
      };
    })
    .filter((r) => r.name && r.cycle_name);
}

// ── Screen ───────────────────────────────────────────────
export function ImportItemsScreen({
  navigation,
  route,
}: {
  navigation: any;
  route: any;
}) {
  const type: 'menu' | 'essentials' | 'plans' = route.params?.type ?? 'menu';
  const isMenu = type === 'menu';
  const isPlans = type === 'plans';

  const queryClient = useQueryClient();
  const { data: cycles = [] } = useAllDeliveryCycles();

  const [parsedRows, setParsedRows] = useState<MenuRow[] | EssentialRow[] | PlanRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');

  // ── Download template ──────────────────────────────────
  const handleDownloadTemplate = async () => {
    try {
      const FileSystem = require('expo-file-system');
      const Sharing = require('expo-sharing');
      const csv = isMenu ? MENU_TEMPLATE : isPlans ? PLANS_TEMPLATE : ESSENTIALS_TEMPLATE;
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
  const handleImport = async () => {
    if (!parsedRows?.length) return;
    setImporting(true);
    try {
      if (isMenu) {
        const rows = parsedRows as MenuRow[];
        // Build cycle_name → id map
        const cycleMap: Record<string, number> = {};
        for (const c of cycles) {
          cycleMap[(c as any).cycle_name?.toLowerCase()] = (c as any).id;
        }

        const records = rows.map((r) => ({
          name: r.name,
          cycle_id: cycleMap[r.cycle_name.toLowerCase()] ?? null,
          ingredients: r.ingredients || null,
          price: r.price,
          is_active: true,
          sort_order: 0,
        })).filter((r) => r.cycle_id !== null);

        if (!records.length) {
          Alert.alert('No matching cycles', 'None of the cycle names matched existing delivery cycles.');
          setImporting(false);
          return;
        }

        const { error } = await supabase.from('menu_items').insert(records);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ['admin_menu_items'] });
        queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      } else if (isPlans) {
        const rows = parsedRows as PlanRow[];
        const cycleMap: Record<string, number> = {};
        for (const c of cycles) {
          cycleMap[(c as any).cycle_name?.toLowerCase()] = (c as any).id;
        }
        const records = rows
          .map((r) => ({
            name: r.name,
            cycle_id: cycleMap[r.cycle_name.toLowerCase()] ?? null,
            type: r.type,
            duration_days: r.duration_days,
            price: r.price,
            plan_items: '[]',
            is_active: true,
          }))
          .filter((r) => r.cycle_id !== null);
        if (!records.length) {
          Alert.alert('No matching cycles', 'None of the cycle names matched existing delivery cycles.');
          setImporting(false);
          return;
        }
        const { error } = await supabase.from('subscription_plans').insert(records);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ['admin_plans'] });
      } else {
        const rows = parsedRows as EssentialRow[];
        const cycleMap: Record<string, number> = {};
        for (const c of cycles) {
          cycleMap[(c as any).cycle_name?.toLowerCase()] = (c as any).id;
        }
        const records = rows
          .map((r) => ({
            name: r.name,
            cycle_id: cycleMap[r.cycle_name.toLowerCase()] ?? null,
            price: r.price,
            is_active: true,
          }))
          .filter((r) => r.cycle_id !== null);
        if (!records.length) {
          Alert.alert('No matching cycles', 'None of the cycle names matched existing delivery cycles.');
          setImporting(false);
          return;
        }
        const { error } = await supabase.from('essentials_catalog').insert(records);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ['admin_essentials'] });
      }

      Alert.alert(
        'Import complete',
        `${parsedRows.length} item${parsedRows.length !== 1 ? 's' : ''} imported.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      Alert.alert('Import failed', err?.message ?? 'Unknown error');
    } finally {
      setImporting(false);
    }
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
                ? 'Columns: Plan Name, Cycle, Type (food/essentials), Number of Days, Price'
                : 'Columns: Item Name, Cycle (Breakfast/Lunch/Snacks/Dinner), Price'}
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
