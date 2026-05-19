/**
 * 1stOne F1 — useActiveStaffBatch
 *
 * The single delivery cycle currently released to the staff operational
 * screens (Kitchen / Packing / Hub / Driver). It is the most recent kitchen
 * push — see the get_active_staff_batch RPC and kitchen_push_log.
 *
 * Staff screens scope their order list to this one cycle + push_date. When
 * the next cycle pushes, a newer kitchen_push_log row appears, this flips,
 * and the previous cycle's orders fall out of every staff screen — one
 * cycle's batch on the board at a time, never two clubbed together.
 *
 * Returns null when no cycle has been pushed yet — staff see nothing until
 * a push happens (orders reach the staff screens ONLY via the push).
 */

import { supabase } from '../api/supabaseClient';
import { useSupabaseSingle } from '../api/useSupabaseQuery';
import { useBranchFilter } from './useBranchFilter';

export interface ActiveStaffBatch {
  cycle_id: number;
  /** YYYY-MM-DD — the delivery date the push released. */
  push_date: string;
}

export function useActiveStaffBatch() {
  const bf = useBranchFilter();
  const branchId = bf.isActive && bf.branchId != null ? bf.branchId : null;

  return useSupabaseSingle<ActiveStaffBatch>(
    ['active_staff_batch', branchId],
    // RPC not in the generated types — cast (same pattern as the other RPCs).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (supabase as any).rpc('get_active_staff_batch', { p_branch_id: branchId }),
    { staleTime: 30_000 },
  );
}
