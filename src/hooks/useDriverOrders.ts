/**
 * 1stOne F1 — useDriverOrders / useDriverOrderHistory
 *
 * The driver's two lists, extracted out of DriverDashboardScreen so the board
 * rule lives beside the one Kitchen, Packing and Hub already follow rather
 * than in a screen where it could drift again — which is exactly what had
 * happened.
 *
 * THE BOARD IS EXACTLY ONE BATCH. The live list is the cycle released by the
 * most recent kitchen push (useActiveStaffBatch) and nothing else. A row stays
 * on it, whatever its status, until it is Delivered or the next push replaces
 * the board.
 *
 * It used to also carry forward anything past due (`isPastDue`), so the driver
 * was the one live board that accumulated a backlog of unknown age while
 * Kitchen and Packing had already stopped doing that. Unfinished work now
 * leaves every live board together and is chased from
 * Admin → Orders → Undelivered; the driver still sees it here, under History.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { useActiveStaffBatch } from './useActiveStaffBatch';
import { isOperationalOrder } from '../utils/orderFilters';

/** Rows the driver's own screens read. Kept loose — the row shape is wide. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DriverOrder = any;

const HISTORY_LIMIT = 100;

const ORDER_SELECT = `
  *,
  order_items(*),
  customer_addresses(*),
  profiles(phone_number)
`;

/**
 * The hubs and zones this driver is assigned to.
 *
 * Its own query so the live board and History resolve the assignment once
 * between them instead of twice, and so switching tabs does not re-read it.
 */
function useDriverAssignment() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';

  return useQuery({
    queryKey: ['driver_assignment', userId],
    queryFn: async (): Promise<{ hubIds: number[]; zoneIds: number[] }> => {
      const [hubsRes, zonesRes] = await Promise.all([
        supabase.from('delivery_hubs').select('id').eq('driver_user_id', userId),
        supabase.from('delivery_zones').select('id').eq('driver_user_id', userId),
      ]);
      if (hubsRes.error) throw hubsRes.error;
      if (zonesRes.error) throw zonesRes.error;
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hubIds: (hubsRes.data ?? []).map((h: any) => h.id),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zoneIds: (zonesRes.data ?? []).map((z: any) => z.id),
      };
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // assignment changes rarely — an admin action
  });
}

/** Does this order's address fall in one of the driver's hubs or zones? */
function isMine(
  order: DriverOrder,
  hubIds: number[],
  zoneIds: number[],
): boolean {
  const addr = order?.customer_addresses;
  if (!addr) return false;
  if (addr.hub_id != null && hubIds.includes(addr.hub_id)) return true;
  if (addr.zone_id != null && zoneIds.includes(addr.zone_id)) return true;
  return false;
}

/**
 * The live board — the active batch, minus anything already Delivered.
 *
 * Cancelled is excluded by the query; Delivered is excluded here because it is
 * the driver's own finish line and a row with nothing left to do on it is
 * clutter on a phone held in one hand.
 */
export function useDriverOrders() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const { data: batch } = useActiveStaffBatch();
  const { data: assignment } = useDriverAssignment();

  return useQuery({
    queryKey: [
      'driver_orders',
      userId,
      batch ? `${batch.cycle_id}:${batch.push_date}` : 'none',
    ],
    queryFn: async (): Promise<DriverOrder[]> => {
      if (!batch || !assignment) return [];
      const { hubIds, zoneIds } = assignment;
      if (hubIds.length === 0 && zoneIds.length === 0) return [];

      // Scoped to the batch in the QUERY, not after the fact: this is one
      // cycle of one day, so the result is small enough to filter the
      // hub/zone membership on the device against the joined address.
      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('cycle_id', batch.cycle_id)
        .eq('dispatch_date', batch.push_date)
        .not('status', 'in', '("Delivered","Cancelled","Failed")')
        .order('created_at', { ascending: false });
      if (error) throw error;

      return (data ?? []).filter(
        (o: DriverOrder) => isOperationalOrder(o) && isMine(o, hubIds, zoneIds),
      );
    },
    // No batch resolved means no board. Waiting avoids rendering an empty
    // list first, which reads as "nothing to deliver" rather than "loading".
    enabled: !!userId && batch !== undefined && assignment !== undefined,
    refetchOnMount: 'always',
  });
}

/**
 * Everything this driver has carried, newest first — delivered, cancelled,
 * and anything that fell off the live board unfinished.
 *
 * Filtered on the JOINED ADDRESS rather than on the device, because this
 * query has a LIMIT: narrowing after the fact would take 100 rows of everyone
 * and then show the driver whichever few happened to be theirs.
 */
export function useDriverOrderHistory() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const { data: assignment } = useDriverAssignment();

  return useQuery({
    queryKey: ['driver_order_history', userId, assignment],
    queryFn: async (): Promise<DriverOrder[]> => {
      if (!assignment) return [];
      const { hubIds, zoneIds } = assignment;
      if (hubIds.length === 0 && zoneIds.length === 0) return [];

      // Build the membership test from whichever lists are non-empty — an
      // `in.()` with no values is not valid PostgREST syntax.
      const parts: string[] = [];
      if (hubIds.length > 0) parts.push(`hub_id.in.(${hubIds.join(',')})`);
      if (zoneIds.length > 0) parts.push(`zone_id.in.(${zoneIds.join(',')})`);

      const { data, error } = await supabase
        .from('orders')
        // !inner so the address filter below narrows the ORDERS returned
        // rather than merely blanking the embedded address on non-matches.
        .select(`
          *,
          order_items(*),
          customer_addresses!inner(*),
          profiles(phone_number)
        `)
        .or(parts.join(','), { referencedTable: 'customer_addresses' })
        .order('dispatch_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);
      if (error) throw error;

      return ((data ?? []) as DriverOrder[]).filter(isOperationalOrder);
    },
    enabled: !!userId && assignment !== undefined,
    staleTime: 30_000,
  });
}
