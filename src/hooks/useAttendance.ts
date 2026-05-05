/**
 * 1stOne F1 — useAttendance
 *
 * Staff attendance hooks:
 * - Fetch today's attendance record
 * - Clock in (with GPS coords)
 * - Clock out (with GPS coords)
 * - Fetch monthly attendance history
 * - Leave request management
 *
 * All mutations are offline-aware.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { supabase } from '../api/supabaseClient';
import { useAuth } from './useAuth';
import { useStaffQueueStore } from '../store/staffQueueStore';
import { useBranchFilter } from './useBranchFilter';
import { QUERY_KEYS, QUERY_STALE_TIME } from '../utils/constants';
import type { StaffAttendance, StaffLeave } from '../types';

// Shape returned by useClockIn mutationFn so onSuccess can optimistically update the cache
type ClockInPayload = Pick<StaffAttendance,
  'staff_id' | 'date' | 'clock_in_time' | 'clock_in_lat' | 'clock_in_lng' | 'branch_id'
>;

/** Today's attendance record for current staff */
export function useTodayAttendance() {
  const { session } = useAuth();
  const today = new Date().toISOString().split('T')[0];

  return useQuery({
    queryKey: [...QUERY_KEYS.STAFF_ATTENDANCE, 'today', session?.user.id],
    queryFn: async () => {
      if (!session) return null;

      const { data, error } = await supabase
        .from('staff_attendance')
        .select('*')
        .eq('staff_id', session.user.id)
        .eq('date', today)
        .maybeSingle();

      if (error) throw error;
      return data as StaffAttendance | null;
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });
}

/** Monthly attendance history */
export function useAttendanceHistory(month: number, year: number) {
  const { session } = useAuth();

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  return useQuery({
    queryKey: [...QUERY_KEYS.STAFF_ATTENDANCE, 'history', session?.user.id, month, year],
    queryFn: async () => {
      if (!session) return [];

      const { data, error } = await supabase
        .from('staff_attendance')
        .select('*')
        .eq('staff_id', session.user.id)
        .gte('date', startDate)
        .lt('date', endDate)
        .order('date', { ascending: true });

      if (error) throw error;
      return (data ?? []) as StaffAttendance[];
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });
}

/** Helper: get current GPS coordinates */
async function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      lat: location.coords.latitude,
      lng: location.coords.longitude,
    };
  } catch {
    return null;
  }
}

/** Clock In mutation (offline-aware) */
export function useClockIn() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const enqueue = useStaffQueueStore((s) => s.enqueue);
  const bf = useBranchFilter();

  return useMutation<ClockInPayload, Error, void>({
    mutationFn: async () => {
      if (!session) throw new Error('Not authenticated');

      const today = new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();
      const coords = await getCurrentCoords();

      const payload: ClockInPayload = {
        staff_id: session.user.id,
        date: today,
        clock_in_time: now,
        clock_in_lat: coords?.lat ?? null,
        clock_in_lng: coords?.lng ?? null,
        branch_id: bf.branchIdForWrite,
      };

      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected && netState.isInternetReachable !== false;

      if (isOnline) {
        const { error } = await supabase
          .from('staff_attendance')
          .upsert(payload, { onConflict: 'staff_id,date' });

        if (error) throw error;
      } else {
        enqueue({
          table: 'staff_attendance',
          operation: 'upsert',
          payload,
          userId: session.user.id,
        });
      }

      // Return the payload so onSuccess can immediately write it to the cache,
      // making the clock-in time visible before the background refetch completes.
      return payload;
    },
    onSuccess: (result) => {
      // Immediate optimistic write — no need to wait for the DB round-trip
      queryClient.setQueryData<StaffAttendance | null>(
        [...QUERY_KEYS.STAFF_ATTENDANCE, 'today', session?.user.id],
        (existing) => ({
          id: existing?.id ?? 0,
          clock_out_time: existing?.clock_out_time ?? null,
          clock_out_lat: existing?.clock_out_lat ?? null,
          clock_out_lng: existing?.clock_out_lng ?? null,
          ...result,
        })
      );
      // Then trigger background refetch to sync server-assigned id / branch_id
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_ATTENDANCE });
    },
  });
}

/** Clock Out mutation (offline-aware) */
export function useClockOut() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const enqueue = useStaffQueueStore((s) => s.enqueue);

  return useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not authenticated');

      const today = new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();
      const coords = await getCurrentCoords();

      const payload = {
        clock_out_time: now,
        clock_out_lat: coords?.lat ?? null,
        clock_out_lng: coords?.lng ?? null,
      };

      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected && netState.isInternetReachable !== false;

      if (isOnline) {
        const { error } = await supabase
          .from('staff_attendance')
          .update(payload)
          .eq('staff_id', session.user.id)
          .eq('date', today);

        if (error) throw error;
      } else {
        enqueue({
          table: 'staff_attendance',
          operation: 'update',
          payload,
          matchColumn: 'staff_id',
          matchValue: session.user.id,
          userId: session.user.id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_ATTENDANCE });
    },
  });
}

/** Fetch staff's leave requests */
export function useStaffLeaves() {
  const { session } = useAuth();

  return useQuery({
    queryKey: [...QUERY_KEYS.STAFF_LEAVES, session?.user.id],
    queryFn: async () => {
      if (!session) return [];

      const { data, error } = await supabase
        .from('staff_leaves')
        .select('*')
        .eq('staff_id', session.user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as StaffLeave[];
    },
    enabled: !!session,
    staleTime: QUERY_STALE_TIME,
  });
}

/** Submit a leave request */
export function useRequestLeave() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const bf = useBranchFilter();

  return useMutation({
    mutationFn: async ({
      startDate,
      endDate,
      reason,
    }: {
      startDate: string;
      endDate: string;
      reason?: string;
    }) => {
      if (!session) throw new Error('Not authenticated');

      const { error } = await supabase.from('staff_leaves').insert({
        staff_id: session.user.id,
        start_date: startDate,
        end_date: endDate,
        reason: reason ?? null,
        status: 'Pending',
        branch_id: bf.branchIdForWrite,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_LEAVES });
    },
  });
}
