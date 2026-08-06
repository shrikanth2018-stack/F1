/**
 * 1stOne F1 — useVendorExport
 *
 * The vendor list for the admin export screen: who they are, what was agreed
 * with them, and — when a money column is switched on — what they have
 * actually traded.
 *
 * RLS scopes the read on its own. `vendors_admin_all` is branch-aware, so a
 * branch admin exports their own vendors and nobody else's, and the money
 * tables hang off that list rather than being queried openly.
 *
 * TWO PHASES, the same shape as useCustomerExport:
 *   1. Always — the vendor row, its owner, its granted areas, wallet balance.
 *   2. Opt-in — catalogue counts and earnings totals, only when a trading
 *      column is toggled on. A contact list should not pay for a sales query.
 *
 * EARNINGS ARE PAGED. vendor_earnings gains a row per delivered vendor line,
 * so it is the one table here that grows without bound — and PostgREST
 * silently caps an unbounded select at ~1000 rows (health report #8), which
 * would understate a total rather than fail. Understating money quietly is
 * the worst way for this to break.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import type { VendorStatus, SellingModel, SupplyMode } from './useVendors';

export interface VendorExportFilters {
  status: VendorStatus | 'all';
  branchId: number | null;
  /** Skip phase 2 when no trading column is selected. */
  needTrading: boolean;
}

export interface VendorExportRow {
  id: number;
  business_name: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  contact_phone: string | null;
  status: VendorStatus;
  gst_number: string | null;
  fssai_number: string | null;
  commission_percent: number | null;
  selling_model: SellingModel | null;
  supply_mode: SupplyMode | null;
  /** Granted zones and hubs, comma-joined. Empty means they reach nobody. */
  areas: string;
  branch_name: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  terms_accepted_at: string | null;
  /**
   * The owner's wallet. NOT the same as uncleared earnings — one person has
   * one wallet, so anything they topped up as a customer is in here too.
   * Carried because it is what a payout claim actually reads, and the export
   * would be misleading without it.
   */
  wallet_balance: number | null;
  // ── Phase 2: null unless filters.needTrading ──
  items_listed: number | null;
  items_live: number | null;
  items_awaiting_review: number | null;
  gross_sold: number | null;
  commission_earned: number | null;
  net_earned: number | null;
}

const PAGE = 1000;

export function useVendorExport(filters: VendorExportFilters) {
  return useQuery({
    queryKey: ['vendor_export', filters],
    queryFn: async (): Promise<VendorExportRow[]> => {
      // ── Phase 1: vendors + owner + areas + branch name ──
      let q = supabase
        .from('vendors')
        .select(
          '*, profiles!vendors_owner_profile_fkey(full_name, phone_number, wallet_balance)',
        )
        .order('business_name', { ascending: true });
      if (filters.status !== 'all') q = q.eq('status', filters.status);
      if (filters.branchId != null) q = q.eq('branch_id', filters.branchId);

      const [vendorsRes, zonesRes, branchesRes] = await Promise.all([
        q,
        supabase
          .from('vendor_zones')
          .select('vendor_id, delivery_zones(zone_name), delivery_hubs(hub_name)'),
        supabase.from('branches').select('id, branch_name'),
      ]);
      if (vendorsRes.error) throw new Error(vendorsRes.error.message);
      if (zonesRes.error) throw new Error(zonesRes.error.message);
      if (branchesRes.error) throw new Error(branchesRes.error.message);

      const branchNameById = new Map<number, string>(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (branchesRes.data ?? []).map((b: any) => [b.id, b.branch_name]),
      );

      const areasByVendor = new Map<number, string[]>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const z of (zonesRes.data ?? []) as any[]) {
        const name = z.delivery_hubs?.hub_name ?? z.delivery_zones?.zone_name;
        if (!name) continue;
        areasByVendor.set(z.vendor_id, [...(areasByVendor.get(z.vendor_id) ?? []), name]);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rows: VendorExportRow[] = ((vendorsRes.data ?? []) as any[]).map((v) => ({
        id: v.id,
        business_name: v.business_name ?? null,
        owner_name: v.profiles?.full_name ?? null,
        owner_phone: v.profiles?.phone_number ?? null,
        contact_phone: v.contact_phone ?? null,
        status: v.status,
        gst_number: v.gst_number ?? null,
        fssai_number: v.fssai_number ?? null,
        commission_percent: v.commission_percent ?? null,
        selling_model: v.selling_model ?? null,
        supply_mode: v.supply_mode ?? null,
        areas: (areasByVendor.get(v.id) ?? []).sort().join(', '),
        branch_name: v.branch_id != null ? branchNameById.get(v.branch_id) ?? null : null,
        created_at: v.created_at,
        submitted_at: v.submitted_at ?? null,
        approved_at: v.approved_at ?? null,
        terms_accepted_at: v.terms_accepted_at ?? null,
        wallet_balance: v.profiles?.wallet_balance ?? null,
        items_listed: null,
        items_live: null,
        items_awaiting_review: null,
        gross_sold: null,
        commission_earned: null,
        net_earned: null,
      }));

      // ── Phase 2: catalogue counts + earnings totals ──
      if (filters.needTrading && rows.length > 0) {
        const vendorIds = rows.map((r) => r.id);

        const { data: items, error: itemsErr } = await supabase
          .from('essentials_catalog')
          .select('vendor_id, is_active, listing_status')
          .in('vendor_id', vendorIds);
        if (itemsErr) throw new Error(itemsErr.message);

        // Paged: this is the table that grows with every delivered line.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const earnings: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data: page, error } = await supabase
            .from('vendor_earnings')
            .select('vendor_id, gross_amount, commission_amount, net_amount')
            .in('vendor_id', vendorIds)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw new Error(error.message);
          earnings.push(...(page ?? []));
          if ((page ?? []).length < PAGE) break;
        }

        const itemTally = new Map<number, { listed: number; live: number; pending: number }>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const it of (items ?? []) as any[]) {
          const t = itemTally.get(it.vendor_id) ?? { listed: 0, live: 0, pending: 0 };
          t.listed += 1;
          // "Live" is both gates: approved by us AND switched on by them.
          // Either alone is invisible to a customer, so counting either alone
          // would overstate what is actually on sale.
          if (it.is_active && (it.listing_status ?? 'approved') === 'approved') t.live += 1;
          if (it.listing_status === 'pending') t.pending += 1;
          itemTally.set(it.vendor_id, t);
        }

        const moneyTally = new Map<number, { gross: number; commission: number; net: number }>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const e of earnings as any[]) {
          const t = moneyTally.get(e.vendor_id) ?? { gross: 0, commission: 0, net: 0 };
          t.gross += Number(e.gross_amount) || 0;
          t.commission += Number(e.commission_amount) || 0;
          t.net += Number(e.net_amount) || 0;
          moneyTally.set(e.vendor_id, t);
        }

        const round2 = (n: number) => Math.round(n * 100) / 100;
        rows = rows.map((r) => {
          const i = itemTally.get(r.id);
          const m = moneyTally.get(r.id);
          return {
            ...r,
            items_listed: i?.listed ?? 0,
            items_live: i?.live ?? 0,
            items_awaiting_review: i?.pending ?? 0,
            gross_sold: round2(m?.gross ?? 0),
            commission_earned: round2(m?.commission ?? 0),
            net_earned: round2(m?.net ?? 0),
          };
        });
      }

      return rows;
    },
    staleTime: 30_000,
  });
}
