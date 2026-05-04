/**
 * 1stOne F1 — useStockManager — BF-17 Solution D
 *
 * Hooks for the Admin Stock Manager (post-simplification):
 *   - Supply catalog        (autocomplete source for Add Item)
 *   - Active order list     (unified view: staff-mirrored + admin-added)
 *   - Add / update / remove on supply_order_items
 *   - Print batch           (snapshot current list → supply_batches, clears active)
 *   - Batch history         (past prints, reprint)
 *
 * The previous explicit Pending → Approve workflow was retired in BF-17.
 * Staff submissions auto-mirror into supply_order_items via a server-side
 * BEFORE INSERT trigger; admin's edit-in-place is the implicit approval.
 *
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { SupplyOrderItem, SupplyBatch } from '../types';

// ── Staff supply requests ────────────────────────────────
//
// Note (BF-17, 2026-05-04): the explicit Pending → Approve workflow
// was retired. Staff submissions are auto-mirrored into supply_order_items
// by a server-side BEFORE INSERT trigger
// (supabase/sql/staff_order_requests_mirror_trigger.sql) which also flips
// status to 'Approved' on insert. The staff_order_requests table is
// preserved as audit-only — every submission leaves a durable trail.
// usePendingSupplyRequests / useReviewSupplyRequest hooks were removed
// because the unified view (admin Stock Manager Current Order) makes
// them unnecessary. Admin's edit-in-place IS the approval.

// ── Supply catalog (autocomplete source) ─────────────────

export function useSupplyCatalog(category: 'Vegetables' | 'Grocery' | 'Stationery' | null) {
  return useQuery({
    queryKey: ['supply_catalog', category],
    queryFn: async () => {
      if (!category) return [];
      const { data, error } = await supabase
        .from('supply_catalog')
        .select('id, name')
        .eq('category', category)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!category,
    staleTime: 5 * 60_000,
    // Always refetch when the form mounts. Guards against the cache returning
    // a stale empty result (which can happen if a query fired during auth
    // initialization or right after re-login).
    refetchOnMount: 'always',
  });
}

// ── Active order list ────────────────────────────────────

export function useActiveOrderList() {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['supply_order_items', 'active', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('supply_order_items')
        .select('*')
        .is('batch_id', null)
        .order('category')
        .order('created_at');

      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as SupplyOrderItem[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

export function useAdminAddOrderItem() {
  const { session } = useAuth();
  const bf = useBranchFilter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      qty: number;
      category: 'Vegetables' | 'Grocery' | 'Stationery';
    }) => {
      // BF-17: admin's Add Item goes through the shared merge RPC. If a
      // row with the same category + name (case-insensitive, trimmed) +
      // branch already exists in the active list (batch_id IS NULL), its
      // qty gets incremented; otherwise a new row is inserted. Same RPC
      // is called by the staff_order_requests_mirror trigger so both
      // paths share one merge implementation.
      // RPC name cast: database.types.ts is auto-generated and hasn't
      // been regenerated since the new RPC was added — same class as
      // useCompleteOnboarding's complete_onboarding_atomic. Runtime
      // works; cast bypasses the strict type-check until types are
      // regenerated.
      const { error } = await supabase.rpc('add_or_merge_supply_order_item' as never, {
        p_name: payload.name,
        p_qty: payload.qty,
        p_category: payload.category,
        p_request_id: null,
        p_added_by: session?.user.id ?? null,
        p_branch_id: bf.branchIdForWrite,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supply_order_items'] }),
  });
}

export function useUpdateOrderItemQty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, qty }: { id: number; qty: number }) => {
      const { error } = await supabase
        .from('supply_order_items')
        .update({ qty })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supply_order_items'] }),
  });
}

export function useRemoveOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase
        .from('supply_order_items')
        .delete()
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supply_order_items'] }),
  });
}

// ── Print batch ──────────────────────────────────────────

export function usePrintBatch() {
  const { session } = useAuth();
  const bf = useBranchFilter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (activeItems: SupplyOrderItem[]) => {
      if (activeItems.length === 0) throw new Error('Order list is empty.');

      const snapshot = activeItems.map((i) => ({
        name: i.name,
        qty: i.qty,
        category: i.category,
      }));

      // 1. Create batch record
      const { data: batch, error: batchErr } = await supabase
        .from('supply_batches')
        .insert({
          printed_at: new Date().toISOString(),
          printed_by: session?.user.id ?? null,
          items_snapshot: snapshot,
          note: null,
          branch_id: bf.branchIdForWrite,
        })
        .select('id')
        .single();
      if (batchErr) throw new Error(batchErr.message);

      // 2. Stamp batch_id on all active items
      const ids = activeItems.map((i) => i.id);
      const { error: stampErr } = await supabase
        .from('supply_order_items')
        .update({ batch_id: batch.id })
        .in('id', ids);
      if (stampErr) throw new Error(stampErr.message);

      return batch.id as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply_order_items'] });
      queryClient.invalidateQueries({ queryKey: ['supply_batches'] });
    },
  });
}

// ── Batch history ────────────────────────────────────────

export function useSupplyBatches() {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['supply_batches', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('supply_batches')
        .select('*')
        .order('printed_at', { ascending: false });

      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as SupplyBatch[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

// ── HTML generator (for expo-print) ─────────────────────

export function buildOrderListHTML(
  items: { name: string; qty: number; category: string }[],
  printedAt?: string,
): string {
  const date = printedAt
    ? new Date(printedAt).toLocaleString('en-IN')
    : new Date().toLocaleString('en-IN');

  const categories = ['Vegetables', 'Grocery', 'Stationery'] as const;

  const sections = categories
    .map((cat) => {
      const catItems = items.filter((i) => i.category === cat);
      if (catItems.length === 0) return '';
      const rows = catItems
        .map(
          (i) => `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${i.name}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${i.qty}</td>
          </tr>`,
        )
        .join('');
      return `
        <h3 style="margin:16px 0 4px;font-size:13px;color:#555;letter-spacing:1px;text-transform:uppercase;">${cat}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:6px 8px;text-align:left;">Item</th>
              <th style="padding:6px 8px;text-align:right;">Qty</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Stock Order List</title></head>
<body style="font-family:sans-serif;padding:24px;max-width:600px;margin:0 auto;">
  <h2 style="margin:0 0 4px;">1stOne — Stock Order List</h2>
  <p style="color:#888;font-size:12px;margin:0 0 16px;">Printed: ${date}</p>
  ${sections}
  <p style="color:#aaa;font-size:10px;margin-top:24px;">Generated by 1stOne Admin</p>
</body>
</html>`;
}
