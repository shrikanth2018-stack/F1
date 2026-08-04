/**
 * 1stOne F1 — Staff Offline Queue Store
 *
 * During lunch rush or poor connectivity, staff mutations
 * (mark-delivered, attendance, etc.) queue locally.
 * On reconnect, bulk-sync fires in order.
 *
 * Each queued action stores the Supabase call metadata
 * so it can be replayed exactly.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface QueuedMutation {
  id: string;
  userId: string;
  table: string;
  operation: 'insert' | 'update' | 'upsert';
  payload: Record<string, unknown>;
  /**
   * Legacy single-column match. Still honoured on replay, because a phone can
   * be holding a queue written by an older build — but prefer `match`.
   *
   * One column was never enough to express what the online calls do. Clocking
   * out online matches (staff_id, date); queued, it could only say staff_id,
   * and the replay stamped today's clock-out time onto EVERY attendance row
   * that person had. A whole history of hours worked, overwritten on
   * reconnect, in the exact low-signal conditions this queue exists for.
   */
  matchColumn?: string;
  matchValue?: unknown;
  /** Every column that must match. All are ANDed on replay. */
  match?: Record<string, unknown>;
  /**
   * Conflict target for an upsert — "staff_id,date". Without it supabase-js
   * falls back to the primary key, which for a payload carrying no id means a
   * plain insert, and the row's own unique index then rejects it.
   */
  onConflict?: string;
  /** Customer to push once this mutation syncs (order status updates only). */
  notifyUserId?: string | null;
  createdAt: number;
  retryCount: number;
}

/** The columns a queued mutation must match, whichever shape it was written in. */
export function matchOf(m: QueuedMutation): Record<string, unknown> {
  if (m.match && Object.keys(m.match).length > 0) return m.match;
  if (m.matchColumn !== undefined && m.matchValue !== undefined) {
    return { [m.matchColumn]: m.matchValue };
  }
  return {};
}

interface StaffQueueState {
  queue: QueuedMutation[];
  isSyncing: boolean;
  enqueue: (mutation: Omit<QueuedMutation, 'id' | 'createdAt' | 'retryCount'>) => void;
  dequeue: (id: string) => void;
  markSyncing: (syncing: boolean) => void;
  incrementRetry: (id: string) => void;
  clearQueue: () => void;
  getPendingCount: () => number;
}

let counter = 0;
function generateId(): string {
  counter += 1;
  return `q_${Date.now()}_${counter}`;
}

export const useStaffQueueStore = create<StaffQueueState>()(
  persist(
    (set, get) => ({
      queue: [],
      isSyncing: false,

      enqueue: (mutation) =>
        set((state) => ({
          queue: [
            ...state.queue,
            {
              ...mutation,
              id: generateId(),
              createdAt: Date.now(),
              retryCount: 0,
            },
          ],
        })),

      dequeue: (id) =>
        set((state) => ({
          queue: state.queue.filter((m) => m.id !== id),
        })),

      markSyncing: (syncing) => set({ isSyncing: syncing }),

      incrementRetry: (id) =>
        set((state) => ({
          queue: state.queue.map((m) =>
            m.id === id ? { ...m, retryCount: m.retryCount + 1 } : m
          ),
        })),

      clearQueue: () => set({ queue: [] }),

      getPendingCount: () => get().queue.length,
    }),
    {
      name: '1stone-staff-queue',
      storage: createJSONStorage(() => AsyncStorage),
      // Persist ONLY the queue. isSyncing is runtime state — if it were
      // persisted and the app died mid-drain, it would rehydrate as `true`
      // and drainQueue's re-entry guard would block every future sync
      // until storage was cleared (health report #2).
      partialize: (state) => ({ queue: state.queue }),
      // Devices that stored the pre-partialize shape may still carry
      // isSyncing:true in AsyncStorage — force it false on rehydrate so
      // an old blob can never wedge the queue either.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<StaffQueueState>),
        isSyncing: false,
      }),
    }
  )
);
