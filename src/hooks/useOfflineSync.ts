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
import { fireOrderStatusPush } from '../utils/orderStatusPush';

/**
 * Order status pipeline, earliest → latest. Used to guard offline replay:
 * a queued status update only applies while the order is still at a status
 * logically EARLIER than the queued target — so a mutation that sat in the
 * offline queue can never REGRESS an order another staffer/driver already
 * advanced. (BF — audit G3: the doc claimed this guard; it did not exist.)
 */
const STATUS_PIPELINE = [
  'Pending', 'Confirmed', 'Paid', 'Preparing', 'Ready',
  'Packed', 'Dispatched', 'Received at Hub', 'On the Way', 'Delivered',
];

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
          // G3: an offline order-status update must never regress an order
          // another staffer/driver advanced while this sat queued. Apply it
          // only while the row is still at a status earlier than the target;
          // otherwise it lands as a harmless 0-row no-op.
          if (mutation.table === 'orders' && typeof mutation.payload.status === 'string') {
            const targetIdx = STATUS_PIPELINE.indexOf(mutation.payload.status as string);
            if (targetIdx > 0) {
              query = query.in('status', STATUS_PIPELINE.slice(0, targetIdx));
            }
          }
        } else if (mutation.operation === 'upsert') {
          query = db.from(mutation.table).upsert(mutation.payload);
        } else {
          dequeue(mutation.id);
          continue;
        }

        const { data: affected, error } = await query.select('id');
        if (error) {
          incrementRetry(mutation.id);
        } else {
          dequeue(mutation.id);
          // An order status change made offline still owes the customer their
          // push — but ONLY if the queued update actually landed. A G3 status
          // guard that matched 0 rows (the order had already advanced) must
          // not fire a stale push for a status the order is already past.
          const rowChanged = Array.isArray(affected) && affected.length > 0;
          if (
            rowChanged &&
            mutation.table === 'orders' &&
            mutation.operation === 'update' &&
            mutation.notifyUserId &&
            typeof mutation.payload.status === 'string'
          ) {
            fireOrderStatusPush(
              Number(mutation.matchValue),
              mutation.payload.status,
              mutation.notifyUserId,
            );
          }
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
