/**
 * 1stOne F1 — Vendor Export
 *
 * The vendor list as a spreadsheet: who they are, the terms agreed with them,
 * and what they have traded. Same shape as the customer export — filters,
 * toggleable columns, CSV — because they are the same job on the other side
 * of the marketplace, and a second layout to learn would be gratuitous.
 *
 * MONEY COLUMNS ARE OPT-IN. Selecting one turns on a second query for
 * catalogue counts and earnings totals; a contact list should not pay for it.
 *
 * WALLET BALANCE IS NOT "WHAT WE OWE THEM". One person has one wallet, so a
 * vendor who also buys from us has their customer top-ups in the same number
 * — and `create_vendor_payout_claim` reads exactly this figure. It is carried
 * because it is what a payout will actually claim, and the note under the
 * columns says so rather than leaving it to be discovered on a payout run.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { infoDialog } from '../../utils/confirmDialog';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useBranches } from '../../hooks/useBranches';
import { useVendorExport, type VendorExportRow } from '../../hooks/useVendorExport';
import { STATUS_LABEL, type VendorStatus } from '../../hooks/useVendors';
import { exportCsv } from '../../utils/exportCsv';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// ── Column registry ─────────────────────────────────────────
// `isTrading` flags the columns that need the second query, so the screen can
// leave it off until one is actually wanted.
type ColumnKey =
  | 'business_name' | 'owner_name' | 'owner_phone' | 'contact_phone' | 'status'
  | 'areas' | 'commission_percent' | 'selling_model' | 'supply_mode'
  | 'gst_number' | 'fssai_number' | 'branch_name'
  | 'created_at' | 'submitted_at' | 'approved_at' | 'terms_accepted_at'
  | 'items_listed' | 'items_live' | 'items_awaiting_review'
  | 'gross_sold' | 'commission_earned' | 'net_earned' | 'wallet_balance';

interface ColumnDef {
  key: ColumnKey;
  header: string;
  defaultOn: boolean;
  isTrading?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  read: (r: VendorExportRow) => any;
}

const day = (s: string | null) => s?.slice(0, 10) ?? null;

const COLUMNS: ColumnDef[] = [
  { key: 'business_name',      header: 'Business',          defaultOn: true,  read: (r) => r.business_name },
  { key: 'owner_name',         header: 'Owner',             defaultOn: true,  read: (r) => r.owner_name },
  { key: 'owner_phone',        header: 'Login Phone',       defaultOn: true,  read: (r) => r.owner_phone },
  { key: 'contact_phone',      header: 'Contact Phone',     defaultOn: true,  read: (r) => r.contact_phone },
  { key: 'status',             header: 'Status',            defaultOn: true,  read: (r) => STATUS_LABEL[r.status] ?? r.status },
  { key: 'areas',              header: 'Selling Areas',     defaultOn: true,  read: (r) => r.areas },
  { key: 'commission_percent', header: 'Commission %',      defaultOn: true,  read: (r) => r.commission_percent },
  { key: 'selling_model',      header: 'Selling Model',     defaultOn: false, read: (r) => r.selling_model },
  { key: 'supply_mode',        header: 'Supply Mode',       defaultOn: false, read: (r) => r.supply_mode },
  { key: 'gst_number',         header: 'GST',               defaultOn: false, read: (r) => r.gst_number },
  { key: 'fssai_number',       header: 'FSSAI',             defaultOn: false, read: (r) => r.fssai_number },
  { key: 'branch_name',        header: 'Branch',            defaultOn: false, read: (r) => r.branch_name },
  { key: 'created_at',         header: 'Onboarded',         defaultOn: false, read: (r) => day(r.created_at) },
  { key: 'submitted_at',       header: 'Details Sent',      defaultOn: false, read: (r) => day(r.submitted_at) },
  { key: 'approved_at',        header: 'Approved',          defaultOn: false, read: (r) => day(r.approved_at) },
  { key: 'terms_accepted_at',  header: 'Terms Accepted',    defaultOn: false, read: (r) => day(r.terms_accepted_at) },
  { key: 'items_listed',       header: 'Items Listed',      defaultOn: false, isTrading: true, read: (r) => r.items_listed },
  { key: 'items_live',         header: 'Items Live',        defaultOn: false, isTrading: true, read: (r) => r.items_live },
  { key: 'items_awaiting_review', header: 'Awaiting Review', defaultOn: false, isTrading: true, read: (r) => r.items_awaiting_review },
  { key: 'gross_sold',         header: 'Total Sold',        defaultOn: false, isTrading: true, read: (r) => r.gross_sold },
  { key: 'commission_earned',  header: 'Our Commission',    defaultOn: false, isTrading: true, read: (r) => r.commission_earned },
  { key: 'net_earned',         header: 'Their Earnings',    defaultOn: false, isTrading: true, read: (r) => r.net_earned },
  { key: 'wallet_balance',     header: 'Wallet Balance',    defaultOn: false, read: (r) => r.wallet_balance },
];

const DEFAULT_COL_KEYS = new Set<ColumnKey>(COLUMNS.filter((c) => c.defaultOn).map((c) => c.key));

const STATUS_OPTIONS: Array<{ key: VendorStatus | 'all'; label: string }> = [
  { key: 'all',       label: 'All' },
  { key: 'approved',  label: 'Approved' },
  { key: 'submitted', label: 'To verify' },
  { key: 'invited',   label: 'Awaiting them' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'rejected',  label: 'Rejected' },
];

export function AdminVendorExportScreen() {
  const [status, setStatus] = useState<VendorStatus | 'all'>('all');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [selectedCols, setSelectedCols] = useState<Set<ColumnKey>>(new Set(DEFAULT_COL_KEYS));
  const [downloading, setDownloading] = useState(false);

  const { data: branches = [] } = useBranches();

  const needTrading = useMemo(
    () => COLUMNS.some((c) => c.isTrading && selectedCols.has(c.key)),
    [selectedCols],
  );

  const { data: rows = [], isLoading, error } = useVendorExport({ status, branchId, needTrading });

  const toggleCol = (key: ColumnKey) => {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleDownload = async () => {
    if (rows.length === 0) {
      infoDialog('No vendors', 'No vendors match the current filters.');
      return;
    }
    const activeCols = COLUMNS.filter((c) => selectedCols.has(c.key));
    if (activeCols.length === 0) {
      infoDialog('No columns selected', 'Pick at least one column to include.');
      return;
    }
    setDownloading(true);
    try {
      const headers = activeCols.map((c) => c.header);
      const body = rows.map((r) => activeCols.map((c) => c.read(r)));
      const name = `vendors_${status}_${stamp()}.csv`;
      await exportCsv(name, headers, body);
    } catch (e: unknown) {
      infoDialog('Download failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Export Vendors" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>FILTERS</ThemedText>

        <View style={styles.chipWrap}>
          {STATUS_OPTIONS.map((opt) => {
            const active = status === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setStatus(opt.key)}
                activeOpacity={0.7}
              >
                <ThemedText variant="small" color={active ? 'mint' : 'muted'}>{opt.label}</ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Only worth showing once a second branch exists — until then every
            vendor is in the only branch there is. */}
        {branches.length > 1 && (
          <View style={[styles.chipWrap, styles.chipWrapTop]}>
            {[{ id: null, label: 'All branches' },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...(branches as any[]).map((b) => ({ id: b.id as number | null, label: b.branch_name }))
            ].map((opt) => {
              const active = branchId === opt.id;
              return (
                <TouchableOpacity
                  key={`b-${opt.id ?? 'all'}`}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setBranchId(opt.id)}
                  activeOpacity={0.7}
                >
                  <ThemedText variant="small" color={active ? 'mint' : 'muted'}>{opt.label}</ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={styles.divider} />

        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>COLUMNS</ThemedText>
        <View style={styles.chipWrap}>
          {COLUMNS.map((c) => {
            const on = selectedCols.has(c.key);
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.chip, on && styles.chipActive]}
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

        {selectedCols.has('wallet_balance') && (
          <ThemedText variant="small" color="warning" style={styles.note}>
            Wallet Balance is the whole wallet, not just their earnings — a vendor who also
            buys from us has their own top-ups in that figure. It is what a payout claim
            reads, which is why it is here.
          </ThemedText>
        )}

        <View style={styles.divider} />

        <View style={styles.previewRow}>
          {isLoading ? (
            <ActivityIndicator color={Theme.colors.text.mint} size="small" />
          ) : error ? (
            <ThemedText variant="small" style={{ color: Theme.colors.status.error }}>
              Could not load the vendor list
            </ThemedText>
          ) : (
            <ThemedText variant="body" color="primary" style={{ fontSize: B }}>
              {rows.length} vendor{rows.length !== 1 ? 's' : ''} match
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
          <ThemedText variant="body" color={rows.length > 0 ? 'mint' : 'muted'} style={{ fontSize: B }}>
            {rows.length > 0 ? `Download CSV (${rows.length})  ›` : 'No vendors to export'}
          </ThemedText>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

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

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.xs },
  chipWrapTop: { marginTop: Theme.spacing.sm },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: Theme.spacing.sm + 2,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.background.secondary,
  },

  note: { fontSize: S, marginTop: Theme.spacing.sm },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
    marginVertical: Theme.spacing.md,
  },

  previewRow: { paddingVertical: Theme.spacing.sm, alignItems: 'center' },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  footerDisabled: { borderTopColor: Theme.colors.layout.divider },
});
