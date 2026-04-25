/**
 * 1stOne F1 — useOfflineSync
 *
 * Watches network state. When connectivity returns,
 * drains the staff offline queue in FIFO order.
 * Retries failed mutations up to MAX_QUEUE_RETRIES.
 */

import { useEffect, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../api/supabaseClient';
import { useStaffQueueStore } from '../store/staffQueueStore';
import { MAX_QUEUE_RETRIES } from '../utils/constants';

export function useOfflineSync() {
  // queue + isSyncing kept as reactive subscriptions for the return value
  const queue = useStaffQueueStore((s) => s.queue);
  const isSyncing = useStaffQueueStore((s) => s.isSyncing);
  const markSyncing = useStaffQueueStore((s) => s.markSyncing);
  const dequeue = useStaffQueueStore((s) => s.dequeue);
  const incrementRetry = useStaffQueueStore((s) => s.incrementRetry);

  const drainQueue = useCallback(async () => {
    // Read via getState() so this callback is not re-created on every queue
    // change — prevents NetInfo from re-subscribing after each dequeue.
    const { queue: currentQueue, isSyncing: currentlySyncing } = useStaffQueueStore.getState();
    if (currentlySyncing || currentQueue.length === 0) return;

    // Verify the current session before replaying any queued mutations.
    // If no session exists, leave the queue intact for when the user logs back in.
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return;

    markSyncing(true);

    for (const mutation of currentQueue) {
      if (mutation.retryCount >= MAX_QUEUE_RETRIES) {
        dequeue(mutation.id);
        continue;
      }

      // Cross-session guard: discard any mutation queued by a different user.
      // This protects against Staff A's offline actions replaying under Staff B's
      // session on a shared device.
      if (mutation.userId !== currentUser.id) {
        dequeue(mutation.id);
        continue;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabase as any;
        let query;
        if (mutation.operation === 'insert') {
          query = db.from(mutation.table).insert(mutation.payload);
        } else if (mutation.operation === 'update' && mutation.matchColumn && mutation.matchValue) {
          query = db
            .from(mutation.table)
            .update(mutation.payload)
            .eq(mutation.matchColumn, mutation.matchValue);
        } else if (mutation.operation === 'upsert') {
          query = db.from(mutation.table).upsert(mutation.payload);
        } else {
          dequeue(mutation.id);
          continue;
        }

        const { error } = await query;
        if (error) {
          incrementRetry(mutation.id);
        } else {
          dequeue(mutation.id);
        }
      } catch {
        incrementRetry(mutation.id);
      }
    }

    markSyncing(false);
  }, [markSyncing, dequeue, incrementRetry]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        drainQueue();
      }
    });

    return () => unsubscribe();
  }, [drainQueue]);

  return {
    pendingCount: queue.length,
    isSyncing,
    manualSync: drainQueue,
  };
}
