/**
 * 1stOne F1 — useMyVendor
 *
 * The signed-in user's own vendor record and store. A vendor is a
 * `customer`-role profile with a vendors row, exactly as a hub operator is a
 * customer with an assigned_hub_id — so nothing here touches roles, RLS
 * helpers or the token hook.
 *
 * What a vendor may write is decided by the database, not by this file:
 * `vendors` has UPDATE revoked except for their own business details, and
 * `essentials_vendor_write` only lets an APPROVED vendor touch rows carrying
 * their own vendor_id.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useAuth } from './useAuth';
import type { Vendor } from './useVendors';

/** The caller's vendor record, or null if they aren't one. */
export function useMyVendor() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['my_vendor', userId ?? 'none'],
    queryFn: async (): Promise<Vendor | null> => {
      const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .eq('owner_user_id', userId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as Vendor) ?? null;
    },
    enabled: !!userId,
    staleTime: QUERY_STALE_TIME,
  });
}

/**
 * Complete registration and send it for verification.
 *
 * Goes through an RPC rather than a table update because `status` is not
 * grantable to `authenticated` — deliberately, so nobody approves
 * themselves. A plain update therefore wrote the details but left the vendor
 * stuck at 'invited' forever, invisible to the admin's "To verify" tab.
 * The RPC is the only thing that can make the move, and it refuses a second
 * submission once the details are already with us.
 */
export function useSubmitVendorRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      businessName: string;
      contactPhone?: string;
      gstNumber?: string;
      fssaiNumber?: string;
      returnPolicy?: string;
    }) => {
      const { error } = await supabase.rpc('vendor_submit_registration', {
        p_business_name: p.businessName,
        p_contact_phone: p.contactPhone ?? undefined,
        p_gst_number: p.gstNumber ?? undefined,
        p_fssai_number: p.fssaiNumber ?? undefined,
        p_return_policy: p.returnPolicy ?? undefined,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my_vendor'] }),
  });
}

export interface VendorItem {
  id: number;
  name: string;
  price: number;
  unit: string | null;
  cycle_id: number;
  is_active: boolean;
  daily_cap: number | null;
  vendor_cost: number | null;
  vendor_id: number | null;
  branch_id: number | null;
}

/** This vendor's own catalogue rows. */
export function useMyVendorItems(vendorId?: number) {
  return useQuery({
    queryKey: ['my_vendor_items', vendorId ?? 'none'],
    queryFn: async (): Promise<VendorItem[]> => {
      const { data, error } = await supabase
        .from('essentials_catalog')
        .select('id, name, price, unit, cycle_id, is_active, daily_cap, vendor_cost, vendor_id, branch_id')
        .eq('vendor_id', vendorId!)
        .order('name');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as VendorItem[];
    },
    enabled: vendorId != null,
    staleTime: QUERY_STALE_TIME,
  });
}

/** Create or update one of the vendor's own items. */
export function useSaveVendorItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      id?: number;
      vendorId: number;
      branchId: number | null;
      name: string;
      price: number;
      unit: string;
      cycleId: number;
      dailyCap: number | null;
    }) => {
      const row = {
        name: p.name,
        price: p.price,
        unit: p.unit,
        cycle_id: p.cycleId,
        daily_cap: p.dailyCap,
        vendor_id: p.vendorId,
        branch_id: p.branchId,
        is_active: true,
      };
      const { error } = p.id
        ? await supabase.from('essentials_catalog').update(row).eq('id', p.id)
        : await supabase.from('essentials_catalog').insert({ ...row, sort_order: 0 });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my_vendor_items'] });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.ESSENTIALS });
    },
  });
}

export function useToggleVendorItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id: number; isActive: boolean }) => {
      const { error } = await supabase
        .from('essentials_catalog')
        .update({ is_active: p.isActive })
        .eq('id', p.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my_vendor_items'] });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.ESSENTIALS });
    },
  });
}

export interface SupplyLine {
  dispatch_date: string;
  cycle_id: number | null;
  cycle_name: string | null;
  item_id: number;
  item_name: string;
  total_qty: number;
  order_count: number;
}

/**
 * What to bring, and when. Server-shaped: item, quantity and date only —
 * a supply-only vendor never sees who ordered. Paid orders only, so a
 * vendor is never asked to source for a sale that may not happen.
 */
export function useVendorSupplyList(enabled: boolean) {
  return useQuery({
    queryKey: ['vendor_supply_list'],
    queryFn: async (): Promise<SupplyLine[]> => {
      const { data, error } = await supabase.rpc('vendor_supply_list');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as SupplyLine[];
    },
    enabled,
    staleTime: QUERY_STALE_TIME,
  });
}

export interface VendorOrder {
  order_id: number;
  dispatch_date: string;
  cycle_name: string | null;
  status: string | null;
  items: { item_name: string; quantity: number }[];
  ready_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  /**
   * The moment this order stops being cancellable — the same instant
   * `cancel-order` enforces (store_config window from creation, or the
   * group's earliest cycle cutoff, whichever falls first). Null once the
   * order is already past cancelling. Before it passes the vendor should
   * not be buying stock against this order.
   */
  cancellable_until: string | null;
}

/**
 * The vendor's own orders, shaped by the server. Customer name and phone come
 * back only for a vendor whose goods are already at the hub — the one who
 * plausibly hands them over. For everyone else those fields are never sent,
 * rather than sent and hidden.
 */
export function useVendorOrders(enabled: boolean) {
  return useQuery({
    queryKey: ['vendor_orders'],
    queryFn: async (): Promise<VendorOrder[]> => {
      const { data, error } = await supabase.rpc('vendor_orders');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as VendorOrder[];
    },
    enabled,
    staleTime: QUERY_STALE_TIME,
  });
}

/** Vendor marks their part of an order supplied. Never touches order.status. */
export function useMarkOrderReady() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: number; ready: boolean }) => {
      const { error } = await supabase.rpc('vendor_mark_order_ready', {
        p_order_id: p.orderId,
        p_ready: p.ready,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendor_orders'] }),
  });
}

export interface VendorEarning {
  id: number;
  order_id: number;
  gross_amount: number;
  commission_amount: number;
  net_amount: number;
  selling_model: string;
  created_at: string;
}

export function useMyVendorEarnings(vendorId?: number) {
  return useQuery({
    queryKey: ['my_vendor_earnings', vendorId ?? 'none'],
    queryFn: async (): Promise<VendorEarning[]> => {
      const { data, error } = await supabase
        .from('vendor_earnings')
        .select('id, order_id, gross_amount, commission_amount, net_amount, selling_model, created_at')
        .eq('vendor_id', vendorId!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as VendorEarning[];
    },
    enabled: vendorId != null,
  });
}

/** Turn the wallet balance into a payout request. Amount is server-computed. */
export function useClaimVendorPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_vendor_payout_claim');
      if (error) throw new Error(error.message);
      return data as { claim_id: number; amount: number; status: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my_vendor_payouts'] });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.WALLET });
    },
  });
}

/** The vendor's own payout requests, newest first. */
export function useMyVendorPayouts() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['my_vendor_payouts', userId ?? 'none'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expense_claims')
        .select('id, amount, status, created_at, paid_at')
        .eq('staff_id', userId!)
        .eq('category', 'Vendor Payout')
        .order('created_at', { ascending: false })
        .limit(24);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!userId,
  });
}
