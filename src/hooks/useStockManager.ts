/**
 * 1stOne F1 — useStockManager
 *
 * Hooks for the Admin Stock Manager:
 *   - Staff supply requests  (Pending → Approved / Rejected)
 *   - Active order list      (approved items + admin-added items)
 *   - Print batch            (snapshot current list → supply_batches, clears active)
 *   - Batch history          (past prints, reprint)
 * Filtered by branch when branch_management_active is on.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { SupplyRequest, SupplyOrderItem, SupplyBatch } from '../types';

// ── Staff supply requests ────────────────────────────────

export function usePendingSupplyRequests() {
  const bf = useBranchFilter();

  return useQuery({
    queryKey: ['supply_requests', 'pending', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async () => {
      let query = supabase
        .from('staff_order_requests')
        .select('*, profiles!staff_order_requests_submitted_by_fkey(full_name, employee_id)')
        .eq('status', 'Pending')
        .order('created_at', { ascending: true });

      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as (SupplyRequest & { profiles: any })[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

export function useReviewSupplyRequest() {
  const { session } = useAuth();
  const bf = useBranchFilter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      action,
      items,
      category,
    }: {
      requestId: number;
      action: 'Approved' | 'Rejected';
      items?: { name: string; qty: number }[];
      category?: string;
    }) => {
      const { error } = await supabase
        .from('staff_order_requests')
        .update({ status: action, approved_by: session?.user.id ?? null })
        .eq('id', requestId);
      if (error) throw new Error(error.message);

      // When approved, push items into the active order list
      if (action === 'Approved' && items?.length) {
        const rows = items.map((i) => ({
          name: i.name,
          qty: i.qty,
          category: category ?? 'Stationery',
          request_id: requestId,
          batch_id: null,
          added_by: session?.user.id ?? null,
          branch_id: bf.isActive ? bf.branchId : null,
        }));
        const { error: e2 } = await supabase.from('supply_order_items').insert(rows);
        if (e2) throw new Error(e2.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply_requests'] });
      queryClient.invalidateQueries({ queryKey: ['supply_order_items'] });
    },
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
      const { error } = await supabase.from('supply_order_items').insert({
        ...payload,
        request_id: null,
        batch_id: null,
        added_by: session?.user.id ?? null,
        branch_id: bf.isActive ? bf.branchId : null,
      });
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
          branch_id: bf.isActive ? bf.branchId : null,
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
