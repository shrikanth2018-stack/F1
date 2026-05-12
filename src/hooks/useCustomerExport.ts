/**
 * 1stOne F1 — useCustomerExport
 *
 * Fetches the filtered customer list for the admin export screen.
 * RLS-scoped automatically (profiles policy enforces has_branch_access).
 * Super-admin-only entry point (gated at navigation row).
 *
 * Two phases:
 *   1. Always: profiles + default customer_address (+ hub/zone/branch names)
 *   2. Opt-in: aggregates (total orders, active subs, last order date) —
 *      only when any aggregate column is toggled on. Saves a second
 *      round-trip for the contact-list common case.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';

export interface CustomerExportFilters {
  branchId: number | null;       // null = all branches (super-admin only)
  hubId: number | null;          // null = all hubs
  zoneId: number | null;         // null = all zones
  status: 'active' | 'dormant' | 'all';
  needAggregates: boolean;       // skip phase 2 if false
}

export interface CustomerExportRow {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  wallet_balance: number | null;
  loyalty_points: number | null;
  created_at: string;
  branch_id: number | null;
  branch_name: string | null;
  // From default customer_address (may be null if customer never set one)
  address_full_name: string | null;
  address_phone_number: string | null;
  address_line: string | null;
  city: string | null;
  pincode: string | null;
  hub_id: number | null;
  hub_name: string | null;
  zone_id: number | null;
  zone_name: string | null;
  // Aggregates (filled only when filters.needAggregates is true)
  total_orders: number | null;
  active_subscriptions: number | null;
  last_order_date: string | null;
}

const ACTIVE_WINDOW_DAYS = 30;

export function useCustomerExport(filters: CustomerExportFilters) {
  return useQuery({
    queryKey: ['customer_export', filters],
    queryFn: async (): Promise<CustomerExportRow[]> => {
      // ── Phase 1: profiles + default address + hub/zone names ──
      // Filtering by role='customer' excludes staff/admin/driver profiles.
      // Default address fetched as an embedded array; we pick the
      // is_default=true entry client-side. PostgREST embed names match FK names.
      // Note: profiles.branch_id has no FK to branches in the live schema,
      // so we fetch branches separately and join by id below.
      let query = supabase
        .from('profiles')
        .select(`
          id,
          full_name,
          phone_number,
          wallet_balance,
          loyalty_points,
          created_at,
          branch_id,
          role,
          customer_addresses (
            id,
            is_default,
            is_active,
            full_name,
            phone_number,
            address_line,
            city,
            pincode,
            hub_id,
            zone_id,
            delivery_hubs (hub_name),
            delivery_zones (zone_name)
          )
        `)
        .eq('role', 'customer');

      if (filters.branchId != null) {
        query = query.eq('branch_id', filters.branchId);
      }

      // Branches list is tiny (1-2 rows today) — fetch separately and merge.
      const [profilesRes, branchesRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any),
        supabase.from('branches').select('id, branch_name'),
      ]);
      if (profilesRes.error) throw new Error(profilesRes.error.message);
      if (branchesRes.error) throw new Error(branchesRes.error.message);
      const data = profilesRes.data;
      const branchNameById: Record<number, string> = {};
      for (const b of (branchesRes.data ?? []) as Array<{ id: number; branch_name: string }>) {
        branchNameById[b.id] = b.branch_name;
      }

      // Resolve each profile's default (or first active) address client-side.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rowsBase = (data ?? []).map((p: any): CustomerExportRow => {
        const addrs: any[] = Array.isArray(p.customer_addresses) ? p.customer_addresses : [];
        const active = addrs.filter((a) => a.is_active !== false);
        const addr = active.find((a) => a.is_default) ?? active[0] ?? null;
        return {
          id: p.id,
          full_name: p.full_name ?? null,
          phone_number: p.phone_number ?? null,
          wallet_balance: p.wallet_balance ?? null,
          loyalty_points: p.loyalty_points ?? null,
          created_at: p.created_at,
          branch_id: p.branch_id ?? null,
          branch_name: p.branch_id != null ? branchNameById[p.branch_id] ?? null : null,
          address_full_name: addr?.full_name ?? null,
          address_phone_number: addr?.phone_number ?? null,
          address_line: addr?.address_line ?? null,
          city: addr?.city ?? null,
          pincode: addr?.pincode ?? null,
          hub_id: addr?.hub_id ?? null,
          hub_name: addr?.delivery_hubs?.hub_name ?? null,
          zone_id: addr?.zone_id ?? null,
          zone_name: addr?.delivery_zones?.zone_name ?? null,
          total_orders: null,
          active_subscriptions: null,
          last_order_date: null,
        };
      });

      // Hub / zone filters apply to the default address's hub/zone.
      let rows: CustomerExportRow[] = rowsBase;
      if (filters.hubId != null) {
        rows = rows.filter((r) => r.hub_id === filters.hubId);
      }
      if (filters.zoneId != null) {
        rows = rows.filter((r) => r.zone_id === filters.zoneId);
      }

      // ── Phase 2: aggregates (only if needed) ──
      if (filters.needAggregates && rows.length > 0) {
        const userIds = rows.map((r) => r.id);

        const [ordersRes, subsRes] = await Promise.all([
          supabase
            .from('orders')
            .select('user_id, dispatch_date')
            .in('user_id', userIds),
          supabase
            .from('user_subscriptions')
            .select('user_id, is_active')
            .in('user_id', userIds)
            .eq('is_active', true),
        ]);
        if (ordersRes.error) throw new Error(ordersRes.error.message);
        if (subsRes.error) throw new Error(subsRes.error.message);

        const orderTally: Record<string, { count: number; last: string | null }> = {};
        for (const o of (ordersRes.data ?? []) as Array<{ user_id: string; dispatch_date: string }>) {
          const t = orderTally[o.user_id] ?? { count: 0, last: null };
          t.count += 1;
          if (o.dispatch_date && (t.last == null || o.dispatch_date > t.last)) {
            t.last = o.dispatch_date;
          }
          orderTally[o.user_id] = t;
        }
        const subCount: Record<string, number> = {};
        for (const s of (subsRes.data ?? []) as Array<{ user_id: string }>) {
          subCount[s.user_id] = (subCount[s.user_id] ?? 0) + 1;
        }

        rows = rows.map((r) => ({
          ...r,
          total_orders: orderTally[r.id]?.count ?? 0,
          active_subscriptions: subCount[r.id] ?? 0,
          last_order_date: orderTally[r.id]?.last ?? null,
        }));
      }

      // ── Status filter applied last (depends on aggregates when those exist) ──
      if (filters.status !== 'all') {
        // Without aggregates we can't precisely compute active/dormant.
        // If status filter is set but aggregates weren't requested, we
        // still need order recency — fetch a lean subset just for that.
        if (!filters.needAggregates) {
          const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86400_000).toISOString();
          const userIds = rows.map((r) => r.id);
          if (userIds.length > 0) {
            const [recentRes, subsRes] = await Promise.all([
              supabase
                .from('orders')
                .select('user_id')
                .in('user_id', userIds)
                .gte('created_at', since),
              supabase
                .from('user_subscriptions')
                .select('user_id')
                .in('user_id', userIds)
                .eq('is_active', true),
            ]);
            if (recentRes.error) throw new Error(recentRes.error.message);
            if (subsRes.error) throw new Error(subsRes.error.message);
            const activeIds = new Set<string>([
              ...((recentRes.data ?? []) as Array<{ user_id: string }>).map((o) => o.user_id),
              ...((subsRes.data ?? []) as Array<{ user_id: string }>).map((s) => s.user_id),
            ]);
            rows = rows.filter((r) =>
              filters.status === 'active' ? activeIds.has(r.id) : !activeIds.has(r.id)
            );
          }
        } else {
          // Aggregates present: use last_order_date + active_subscriptions directly.
          const cutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86400_000)
            .toISOString()
            .slice(0, 10);
          rows = rows.filter((r) => {
            const recentOrder = r.last_order_date != null && r.last_order_date >= cutoff;
            const hasActiveSub = (r.active_subscriptions ?? 0) > 0;
            const isActive = recentOrder || hasActiveSub;
            return filters.status === 'active' ? isActive : !isActive;
          });
        }
      }

      return rows;
    },
    staleTime: 30_000,
  });
}
