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
  matchColumn?: string;
  matchValue?: unknown;
  createdAt: number;
  retryCount: number;
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
    }
  )
);
