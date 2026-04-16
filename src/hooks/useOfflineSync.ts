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
  // Read these via getState() inside drainQueue to avoid recreating the
  // callback (and re-subscribing NetInfo) every time the queue changes.
  const markSyncing = useStaffQueueStore((s) => s.markSyncing);
  const dequeue = useStaffQueueStore((s) => s.dequeue);
  const incrementRetry = useStaffQueueStore((s) => s.incrementRetry);

  const drainQueue = useCallback(async () => {
    const { queue, isSyncing } = useStaffQueueStore.getState();
    if (isSyncing || queue.length === 0) return;
    markSyncing(true);

    for (const mutation of queue) {
      if (mutation.retryCount >= MAX_QUEUE_RETRIES) {
        // Skip permanently failed mutations (admin should investigate)
        continue;
      }

      try {
        let query;
        if (mutation.operation === 'insert') {
          query = supabase.from(mutation.table).insert(mutation.payload);
        } else if (mutation.operation === 'update' && mutation.matchColumn && mutation.matchValue) {
          query = supabase
            .from(mutation.table)
            .update(mutation.payload)
            .eq(mutation.matchColumn, mutation.matchValue);
        } else if (mutation.operation === 'upsert') {
          query = supabase.from(mutation.table).upsert(mutation.payload);
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
