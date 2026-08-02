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
  /**
   * Storage path of the item's one photo — `essentials-photos/{id}.jpg`.
   * A vendor sets this themselves from My Store and it reaches customers
   * immediately; the approval step will come with the full listing review.
   * Build a URL with `photoUrl` (src/utils/catalogPhoto.ts).
   */
  image_path?: string | null;
  /** Stamped on every photo upload; used to bust the CDN cache. */
  image_updated_at?: string | null;
  /**
   * Where this listing is in review. `draft` is the vendor still preparing
   * it, `pending` is with us, `rejected` came back with a reason. Only
   * `approved` reaches customers — enforced by RLS and again in orderBuild.
   */
  listing_status?: ListingStatus | null;
  rejection_reason?: string | null;
  submitted_at?: string | null;
}

export type ListingStatus = 'draft' | 'pending' | 'approved' | 'rejected';

/** A proposed edit to a listing that is already approved and selling. */
export interface ListingChange {
  id: number;
  item_id: number;
  proposed: Record<string, unknown>;
  photo_pending: boolean;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  submitted_at: string;
}

/** This vendor's own catalogue rows, at every status. */
export function useMyVendorItems(vendorId?: number) {
  return useQuery({
    queryKey: ['my_vendor_items', vendorId ?? 'none'],
    queryFn: async (): Promise<VendorItem[]> => {
      const { data, error } = await supabase
        .from('essentials_catalog')
        // Explicit column list, so the photo columns have to be named here to
        // reach the screen — the tile silently renders its fallback icon for
        // a row whose image_path was simply never selected.
        .select(
          'id, name, price, unit, cycle_id, is_active, daily_cap, vendor_cost, vendor_id, branch_id, image_path, image_updated_at, listing_status, rejection_reason, submitted_at',
        )
        .eq('vendor_id', vendorId!)
        .order('name');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as VendorItem[];
    },
    enabled: vendorId != null,
    staleTime: QUERY_STALE_TIME,
  });
}

/**
 * Create a draft listing and return its id.
 *
 * An RPC, not an insert: `essentials_catalog` no longer grants INSERT to
 * `authenticated` at all, because a vendor must not be able to choose their
 * own `vendor_id`, `branch_id` or `listing_status`. The server takes those
 * from the caller's vendor row.
 *
 * The id is what matters to the caller — the photo lives at a path keyed by
 * it, and a picture is compulsory before the listing can be submitted, so the
 * row has to exist first.
 */
export function useCreateDraftListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      name: string;
      price: number;
      unit: string;
      cycleId: number;
      description?: string | null;
      dailyCap: number | null;
    }): Promise<number> => {
      // MF-08 pattern: cast until database.types.ts is regenerated.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('vendor_create_draft_listing', {
        p_name: p.name,
        p_price: p.price,
        p_unit: p.unit,
        p_cycle_id: p.cycleId,
        p_description: p.description ?? null,
        p_daily_cap: p.dailyCap,
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my_vendor_items'] }),
  });
}

/**
 * Send drafts for approval, one or many in a single call.
 *
 * The server refuses any item without a photo and names the ones missing it —
 * with five items in flight, "add a photo" on its own is not actionable.
 * It also fires the push to the team; the app cannot, because `send-push`
 * rejects a plain customer-role caller and a vendor is one.
 */
export function useSubmitListings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemIds: number[]): Promise<number> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('vendor_submit_listings', {
        p_item_ids: itemIds,
      });
      if (error) throw new Error(error.message);
      return (data as number) ?? 0;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my_vendor_items'] }),
  });
}

/**
 * Propose a change to a listing that is already approved and selling.
 *
 * The live row is untouched, so the item keeps selling at its current price
 * and name while we look. One open request per item — a second proposal
 * replaces the first rather than queueing behind it.
 */
export function useProposeListingChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      itemId: number;
      proposed: Record<string, unknown>;
      photoPending?: boolean;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('vendor_propose_listing_change', {
        p_item_id: p.itemId,
        p_proposed: p.proposed,
        p_photo_pending: p.photoPending ?? false,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my_vendor_items'] });
      qc.invalidateQueries({ queryKey: ['my_listing_changes'] });
    },
  });
}

/** This vendor's own open change requests, so My Store can show "with us". */
export function useMyListingChanges(vendorId?: number) {
  return useQuery({
    queryKey: ['my_listing_changes', vendorId ?? 'none'],
    queryFn: async (): Promise<ListingChange[]> => {
      // MF-08 pattern: vendor_listing_changes is newer than
      // database.types.ts. Regenerate with `npm run supabase:gen-types` once
      // vendor_listing_approval.sql is applied, then drop the cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('vendor_listing_changes')
        .select('id, item_id, proposed, photo_pending, status, rejection_reason, submitted_at')
        .eq('vendor_id', vendorId!)
        .eq('status', 'pending');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ListingChange[];
    },
    enabled: vendorId != null,
    staleTime: QUERY_STALE_TIME,
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
