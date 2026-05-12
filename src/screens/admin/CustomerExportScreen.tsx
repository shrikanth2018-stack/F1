/**
 * 1stOne F1 — Customer Export
 *
 * Super-admin only. Filter customer list by branch / hub / zone / status,
 * toggle column set, download as CSV (RFC 4180, opens in Excel / Sheets).
 *
 * RLS naturally scopes the read (profiles_self_read enforces
 * has_branch_access). Aggregates fetched only when an aggregate column
 * is toggled on, saving a round-trip for the common contact-list case.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { useBranches } from '../../hooks/useBranches';
import { useDeliveryHubs } from '../../hooks/useDeliveryHubs';
import { useDeliveryZones } from '../../hooks/useDeliveryZones';
import { useCustomerExport, type CustomerExportRow } from '../../hooks/useCustomerExport';
import { buildCsv } from '../../utils/csvBuilder';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// ── Column registry ─────────────────────────────────────────
// Aggregates are flagged so the screen knows when to flip the
// needAggregates flag on the query (avoids the second round-trip
// unless the user actually wants those columns).
type ColumnKey =
  | 'full_name' | 'phone_number' | 'address_phone_number' | 'address_line'
  | 'hub_name' | 'zone_name'
  | 'city' | 'pincode' | 'branch_name' | 'created_at'
  | 'wallet_balance' | 'loyalty_points'
  | 'total_orders' | 'active_subscriptions' | 'last_order_date';

interface ColumnDef {
  key: ColumnKey;
  header: string;
  defaultOn: boolean;
  isAggregate?: boolean;
  /** Pull the cell value from a row. Returns string | number | null. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  read: (r: CustomerExportRow) => any;
}

const COLUMNS: ColumnDef[] = [
  { key: 'full_name',            header: 'Full Name',         defaultOn: true,  read: (r) => r.full_name },
  { key: 'phone_number',         header: 'Login Phone',       defaultOn: true,  read: (r) => r.phone_number },
  { key: 'address_phone_number', header: 'Address Phone',     defaultOn: true,  read: (r) => r.address_phone_number },
  { key: 'address_line',         header: 'Address',           defaultOn: true,  read: (r) => r.address_line },
  { key: 'hub_name',             header: 'Hub',               defaultOn: true,  read: (r) => r.hub_name },
  { key: 'zone_name',            header: 'Zone',              defaultOn: true,  read: (r) => r.zone_name },
  { key: 'city',                 header: 'City',              defaultOn: false, read: (r) => r.city },
  { key: 'pincode',              header: 'Pincode',           defaultOn: false, read: (r) => r.pincode },
  { key: 'branch_name',          header: 'Branch',            defaultOn: false, read: (r) => r.branch_name },
  { key: 'created_at',           header: 'Signup Date',       defaultOn: false, read: (r) => r.created_at?.slice(0, 10) ?? null },
  { key: 'wallet_balance',       header: 'Wallet Balance',    defaultOn: false, read: (r) => r.wallet_balance },
  { key: 'loyalty_points',       header: 'Loyalty Points',    defaultOn: false, read: (r) => r.loyalty_points },
  { key: 'total_orders',         header: 'Total Orders',      defaultOn: false, isAggregate: true, read: (r) => r.total_orders },
  { key: 'active_subscriptions', header: 'Active Subs',       defaultOn: false, isAggregate: true, read: (r) => r.active_subscriptions },
  { key: 'last_order_date',      header: 'Last Order',        defaultOn: false, isAggregate: true, read: (r) => r.last_order_date },
];

const DEFAULT_COL_KEYS = new Set<ColumnKey>(COLUMNS.filter((c) => c.defaultOn).map((c) => c.key));

const STATUS_OPTIONS: Array<{ key: 'active' | 'dormant' | 'all'; label: string }> = [
  { key: 'active',  label: 'Active' },
  { key: 'dormant', label: 'Dormant' },
  { key: 'all',     label: 'All' },
];

// ── Screen ──────────────────────────────────────────────────
export function CustomerExportScreen({ navigation }: AdminScreenProps<'CustomerExport'>) {
  const [branchId, setBranchId] = useState<number | null>(null);
  const [hubId, setHubId] = useState<number | null>(null);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [status, setStatus] = useState<'active' | 'dormant' | 'all'>('active');
  const [selectedCols, setSelectedCols] = useState<Set<ColumnKey>>(new Set(DEFAULT_COL_KEYS));
  const [downloading, setDownloading] = useState(false);

  const { data: branches = [] } = useBranches();
  const { data: hubsAll = [] } = useDeliveryHubs();
  const { data: zonesAll = [] } = useDeliveryZones();

  const hubs = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (hubsAll as any[]).filter((h) => branchId == null || h.branch_id === branchId),
    [hubsAll, branchId]
  );
  const zones = useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (zonesAll as any[]).filter((z) => branchId == null || z.branch_id === branchId),
    [zonesAll, branchId]
  );

  const needAggregates = useMemo(
    () => COLUMNS.some((c) => c.isAggregate && selectedCols.has(c.key)),
    [selectedCols]
  );

  const { data: rows = [], isLoading, error } = useCustomerExport({
    branchId, hubId, zoneId, status, needAggregates,
  });

  const toggleCol = (key: ColumnKey) => {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const onBranchChange = (next: number | null) => {
    setBranchId(next);
    // Hub/zone may not belong to the new branch — clear them.
    setHubId(null);
    setZoneId(null);
  };

  const handleDownload = async () => {
    if (rows.length === 0) {
      Alert.alert('No customers', 'No customers match the current filters.');
      return;
    }
    const activeCols = COLUMNS.filter((c) => selectedCols.has(c.key));
    if (activeCols.length === 0) {
      Alert.alert('No columns selected', 'Pick at least one column to include.');
      return;
    }
    setDownloading(true);
    try {
      const FileSystem = require('expo-file-system');
      const Sharing = require('expo-sharing');

      const headers = activeCols.map((c) => c.header);
      const body = rows.map((r) => activeCols.map((c) => c.read(r)));
      const csv = buildCsv(headers, body);

      // Filename: customers_{branch}_{hub}_{zone}_{status}_{YYYYMMDD-HHMM}.csv
      const slugBranch = branchId
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? slug((branches as any[]).find((b) => b.id === branchId)?.branch_name ?? `branch${branchId}`)
        : 'all';
      const slugHub = hubId
        ? slug((hubs as any[]).find((h) => h.id === hubId)?.hub_name ?? `hub${hubId}`)
        : 'all';
      const slugZone = zoneId
        ? slug((zones as any[]).find((z) => z.id === zoneId)?.zone_name ?? `zone${zoneId}`)
        : 'all';
      const ts = stamp();
      const name = `customers_${slugBranch}_${slugHub}_${slugZone}_${status}_${ts}.csv`;
      const uri = FileSystem.documentDirectory + name;

      await FileSystem.writeAsStringAsync(uri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
        dialogTitle: 'Save customer export',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('Download failed', msg);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Export Customers</ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Filters ──────────────────────────────────── */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>FILTERS</ThemedText>

        <Picker
          label="Branch"
          value={branchId}
          options={[{ id: null, label: 'All branches' }, ...(branches as any[]).map((b) => ({ id: b.id, label: b.branch_name }))]}
          onChange={onBranchChange}
        />
        <Picker
          label="Hub"
          value={hubId}
          options={[{ id: null, label: 'All hubs' }, ...(hubs as any[]).map((h) => ({ id: h.id, label: h.hub_name }))]}
          onChange={setHubId}
        />
        <Picker
          label="Zone"
          value={zoneId}
          options={[{ id: null, label: 'All zones' }, ...(zones as any[]).map((z) => ({ id: z.id, label: z.zone_name }))]}
          onChange={setZoneId}
        />

        <View style={styles.statusRow}>
          {STATUS_OPTIONS.map((opt) => {
            const active = status === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.statusChip, active && styles.statusChipActive]}
                onPress={() => setStatus(opt.key)}
                activeOpacity={0.7}
              >
                <ThemedText variant="small" color={active ? 'mint' : 'muted'}>{opt.label}</ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.divider} />

        {/* ── Columns ─────────────────────────────────── */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>COLUMNS</ThemedText>

        <View style={styles.colsWrap}>
          {COLUMNS.map((c) => {
            const on = selectedCols.has(c.key);
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.colChip, on && styles.colChipActive]}
                onPress={() => toggleCol(c.key)}
                activeOpacity={0.7}
              >
                <ThemedText variant="small" color={on ? 'mint' : 'muted'}>
                  {on ? '✓ ' : ''}{c.header}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.divider} />

        {/* ── Preview count ─────────────────────────────── */}
        <View style={styles.previewRow}>
          {isLoading ? (
            <ActivityIndicator color={Theme.colors.text.mint} size="small" />
          ) : error ? (
            <ThemedText variant="small" style={{ color: Theme.colors.status.error }}>
              Could not load customer list
            </ThemedText>
          ) : (
            <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
              {rows.length} customer{rows.length !== 1 ? 's' : ''} match
            </ThemedText>
          )}
        </View>

      </ScrollView>

      <TouchableOpacity
        style={[styles.footer, (rows.length === 0 || downloading || isLoading) && styles.footerDisabled]}
        onPress={handleDownload}
        disabled={rows.length === 0 || downloading || isLoading}
        activeOpacity={0.7}
      >
        {downloading ? (
          <ActivityIndicator color={Theme.colors.text.mint} />
        ) : (
          <ThemedText
            variant="body"
            color={rows.length > 0 ? 'mint' : 'muted'}
            style={{ fontSize: B }}
          >
            {rows.length > 0 ? `Download CSV (${rows.length})  ›` : 'No customers to export'}
          </ThemedText>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────

interface PickerProps {
  label: string;
  value: number | null;
  options: Array<{ id: number | null; label: string }>;
  onChange: (id: number | null) => void;
}

function Picker({ label, value, options, onChange }: PickerProps) {
  // Inline horizontal chips — keeps things compact, no native modal dependency.
  return (
    <View style={styles.pickerRow}>
      <ThemedText variant="small" color="muted" style={styles.pickerLabel}>{label}</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerOptions}>
        {options.map((opt) => {
          const active = opt.id === value;
          return (
            <TouchableOpacity
              key={`${label}-${opt.id ?? 'null'}`}
              style={[styles.pickerChip, active && styles.pickerChipActive]}
              onPress={() => onChange(opt.id)}
              activeOpacity={0.7}
            >
              <ThemedText variant="small" color={active ? 'mint' : 'muted'}>{opt.label}</ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// ── Styles ──────────────────────────────────────────────────
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

  sectionLabel: {
    fontSize: Theme.typography.sizes.small,
    letterSpacing: 0.5,
    marginBottom: Theme.spacing.sm,
  },

  pickerRow: {
    marginBottom: Theme.spacing.sm,
  },
  pickerLabel: {
    fontSize: S,
    marginBottom: 4,
  },
  pickerOptions: {
    gap: Theme.spacing.xs,
  },
  pickerChip: {
    paddingVertical: 6,
    paddingHorizontal: Theme.spacing.sm + 2,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
  },
  pickerChipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.background.secondary,
  },

  statusRow: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.sm,
  },
  statusChip: {
    paddingVertical: 6,
    paddingHorizontal: Theme.spacing.md,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
  },
  statusChipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.background.secondary,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
    marginVertical: Theme.spacing.md,
  },

  colsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Theme.spacing.xs,
  },
  colChip: {
    paddingVertical: 6,
    paddingHorizontal: Theme.spacing.sm + 2,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
  },
  colChipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.background.secondary,
  },

  previewRow: {
    paddingVertical: Theme.spacing.sm,
    alignItems: 'center',
  },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  footerDisabled: {
    borderTopColor: Theme.colors.layout.divider,
  },
});
