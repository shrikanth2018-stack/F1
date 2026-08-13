/**
 * 1stOne F1 — useEssentials
 *
 * Essentials module hooks (feature-flagged):
 * - Fetch essentials catalog
 *
 * Branch-filtered for customers via useBranchFilter — see MF-09: the
 * customer's default address's branch_id drives which branch's items
 * are visible. Customers with no default address (just-onboarded) see
 * all branches' items until they add one.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useSupabaseQuery } from '../api/useSupabaseQuery';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import { useBranchFilter } from './useBranchFilter';
import type { EssentialItem } from '../types';

/**
 * Trading names of approved vendors, for the "Sold by" line.
 *
 * Read from the vendor_public VIEW, not the vendors table: `vendors` also
 * holds GST, FSSAI and the commission negotiated with them, and RLS is
 * row-level — a read policy there would have exposed the whole row to every
 * customer. The view publishes two columns and nothing else.
 *
 * Fetched separately rather than embedded because PostgREST can only embed
 * through a foreign key, and there is no FK to a view.
 */
function useVendorNames() {
  return useQuery({
    queryKey: ['vendor_public_names'],
    queryFn: async (): Promise<Map<number, string>> => {
      const { data, error } = await supabase.from('vendor_public').select('id, business_name');
      if (error) throw new Error(error.message);
      return new Map((data ?? []).map((v: any) => [v.id as number, (v.business_name ?? '') as string]));
    },
    staleTime: QUERY_STALE_TIME,
  });
}

/** Fetch active essentials catalog items */
export function useEssentialsCatalog(cycleId?: number) {
  const bf = useBranchFilter();
  const { data: vendorNames } = useVendorNames();

  return useSupabaseQuery<EssentialItem, EssentialItem[]>(
    [
      ...QUERY_KEYS.ESSENTIALS,
      cycleId ?? 'all',
      bf.isActive ? bf.branchId ?? 'all' : 'off',
    ],
    () => {
      let query = supabase
        .from('essentials_catalog')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (cycleId) {
        query = query.eq('cycle_id', cycleId);
      }
      if (bf.isActive && bf.branchId != null) {
        query = query.eq('branch_id', bf.branchId);
      }
      return query;
    },
    {
      staleTime: QUERY_STALE_TIME,
      // A vendor adding an item is a change on ANOTHER device, so the local
      // cache has no way to know about it — the customer kept seeing the old
      // list for up to QUERY_STALE_TIME and the item looked like it had never
      // been created. 'always' overrides the stale window for these two
      // triggers only, so the list is re-read whenever the customer opens the
      // storefront or brings the app back to the foreground. (A live update
      // while they sit on the screen would need a Realtime subscription; this
      // deliberately stops short of that.)
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
      // Vendor items carry no name of their own — attach the trading name so
      // the row can say who the customer is actually buying from. Which items
      // are visible at all is decided by RLS, not here.
      transform: (rows: EssentialItem[]) =>
        rows.map((r) =>
          r.vendor_id != null
            ? { ...r, vendor_name: vendorNames?.get(r.vendor_id) ?? null }
            : r,
        ),
    },
  );
}
