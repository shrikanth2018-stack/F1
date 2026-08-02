/**
 * 1stOne F1 — Vendor listing review (admin side)
 *
 * The queue behind AdminVendorListingsScreen: listings waiting to go live,
 * and proposed changes to listings already selling. Two shapes, because they
 * are genuinely different things —
 *
 *   a NEW listing is an essentials_catalog row parked at listing_status
 *   'pending'. Nothing is live, so approving it simply switches it on.
 *
 *   a CHANGE is a vendor_listing_changes row holding proposed values. The
 *   live row is untouched and still selling, so approving copies the proposed
 *   values onto it and the customer sees the new version from that moment.
 *
 * Nothing here writes a column directly. Every decision goes through a
 * SECURITY DEFINER RPC, because `listing_status` is not writable by any
 * client — that is what stops a vendor approving themselves, and it applies
 * to admins too (same pattern as admin_set_vendor_*).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_KEYS } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';

/** A listing waiting to go live for the first time. */
export interface PendingListing {
  id: number;
  name: string;
  price: number;
  unit: string | null;
  cycle_id: number | null;
  description: string | null;
  image_path: string | null;
  image_updated_at: string | null;
  vendor_id: number | null;
  branch_id: number | null;
  submitted_at: string | null;
}

/** A proposed edit, with the live values alongside so the diff is visible. */
export interface PendingChange {
  id: number;
  item_id: number;
  vendor_id: number;
  proposed: Record<string, unknown>;
  photo_pending: boolean;
  submitted_at: string;
  /** The row as customers see it right now. */
  current: {
    name: string;
    price: number;
    unit: string | null;
    cycle_id: number | null;
    description: string | null;
    image_path: string | null;
    image_updated_at: string | null;
    branch_id: number | null;
  } | null;
}

/**
 * Listings awaiting first approval.
 *
 * Branch-scoped like every other admin list. A non-super admin reviewing
 * another branch's listing would be refused by the RPC anyway, so filtering
 * here keeps the queue honest rather than showing work they cannot do.
 */
export function usePendingListings() {
  const bf = useBranchFilter();
  return useQuery({
    queryKey: ['pending_listings', bf.isActive ? bf.branchId ?? 'all' : 'off'],
    queryFn: async (): Promise<PendingListing[]> => {
      let q = supabase
        .from('essentials_catalog')
        .select(
          'id, name, price, unit, cycle_id, description, image_path, image_updated_at, vendor_id, branch_id, submitted_at',
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq('listing_status' as any, 'pending')
        .order('submitted_at', { ascending: true });
      if (bf.isActive && bf.branchId != null) q = q.eq('branch_id', bf.branchId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PendingListing[];
    },
    // A vendor submitting is a change on another device, so a stale cache here
    // means the queue looks empty while someone waits. Same treatment the
    // customer essentials list got for the same reason.
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}

/** Proposed changes to listings that are already live. */
export function usePendingListingChanges() {
  return useQuery({
    queryKey: ['pending_listing_changes'],
    queryFn: async (): Promise<PendingChange[]> => {
      // MF-08 pattern: vendor_listing_changes is newer than
      // database.types.ts. Regenerate once the SQL is applied, drop the cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('vendor_listing_changes')
        .select(
          'id, item_id, vendor_id, proposed, photo_pending, submitted_at,' +
            // The live row, embedded through the FK, so the screen can show
            // "₹40 → ₹55" rather than a bare proposed value with no context.
            ' current:essentials_catalog!vendor_listing_changes_item_id_fkey' +
            ' (name, price, unit, cycle_id, description, image_path, image_updated_at, branch_id)',
        )
        .eq('status', 'pending')
        .order('submitted_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PendingChange[];
    },
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}

/** Total awaiting review — drives the badge on the Manage row. */
export function usePendingListingCount(): number {
  const listings = usePendingListings();
  const changes = usePendingListingChanges();
  return (listings.data?.length ?? 0) + (changes.data?.length ?? 0);
}

/** Approve or reject a listing that has never gone live. */
export function useReviewListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { itemId: number; approve: boolean; reason?: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('admin_review_listing', {
        p_item_id: p.itemId,
        p_approve: p.approve,
        p_reason: p.reason ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending_listings'] });
      qc.invalidateQueries({ queryKey: ['admin_essentials'] });
      // An approval puts an item on the customer menu — refresh the list they
      // are actually looking at, not just the admin one.
      qc.invalidateQueries({ queryKey: QUERY_KEYS.ESSENTIALS });
    },
  });
}

/**
 * Approve or reject a proposed change.
 *
 * `photoPromoted` tells the RPC whether the caller already moved the pending
 * image into place. It exists because `image_updated_at` is the CDN
 * cache-buster: stamping it before the new bytes are actually at the live key
 * publishes a fresh URL pointing at the OLD picture, which then sticks for the
 * full 30-day cache lifetime. The screen moves the object first and only then
 * calls this.
 */
export function useReviewListingChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      changeId: number;
      approve: boolean;
      reason?: string;
      photoPromoted?: boolean;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('admin_review_listing_change', {
        p_change_id: p.changeId,
        p_approve: p.approve,
        p_reason: p.reason ?? null,
        p_photo_promoted: p.photoPromoted ?? false,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending_listing_changes'] });
      qc.invalidateQueries({ queryKey: ['admin_essentials'] });
      qc.invalidateQueries({ queryKey: QUERY_KEYS.ESSENTIALS });
    },
  });
}
