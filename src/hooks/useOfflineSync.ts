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
import { useStaffQueueStore, matchOf } from '../store/staffQueueStore';
import { MAX_QUEUE_RETRIES } from '../utils/constants';
import { fireOrderStatusPush } from '../utils/orderStatusPush';
import { ORDER_STATUS_FLOW } from '../utils/orderStatus';
import { captureError } from '../utils/sentry';

// Status progression used to guard offline replay: a queued status update
// only applies while the order is still at a status logically EARLIER than
// the queued target — so a mutation that sat in the offline queue can never
// REGRESS an order another staffer/driver already advanced (audit G3).
// ORDER_STATUS_FLOW is the single shared taxonomy (audit D19).

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
        // Giving up on a queued staff mutation is data loss — it was
        // previously silent (health report #17). Record what was dropped
        // so it can be reconciled manually.
        captureError(new Error('Offline queue mutation dropped after max retries'), {
          table: mutation.table,
          operation: mutation.operation,
          match: matchOf(mutation),
          payload: mutation.payload,
          retryCount: mutation.retryCount,
          queuedAt: mutation.createdAt,
        });
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
        const match = matchOf(mutation);
        if (mutation.operation === 'insert') {
          query = db.from(mutation.table).insert(mutation.payload);
        } else if (mutation.operation === 'update' && Object.keys(match).length > 0) {
          // EVERY match column, ANDed. A single column was how an offline
          // clock-out came to rewrite a staff member's whole attendance
          // history — see QueuedMutation.matchColumn.
          query = db.from(mutation.table).update(mutation.payload);
          for (const [col, val] of Object.entries(match)) {
            query = query.eq(col, val);
          }
          // G3: an offline order-status update must never regress an order
          // another staffer/driver advanced while this sat queued. Apply it
          // only while the row is still at a status earlier than the target;
          // otherwise it lands as a harmless 0-row no-op.
          if (mutation.table === 'orders' && typeof mutation.payload.status === 'string') {
            const targetIdx = ORDER_STATUS_FLOW.indexOf(
              mutation.payload.status as typeof ORDER_STATUS_FLOW[number],
            );
            if (targetIdx > 0) {
              query = query.in('status', ORDER_STATUS_FLOW.slice(0, targetIdx));
            }
          }
        } else if (mutation.operation === 'upsert') {
          // The conflict target has to be carried, or supabase-js falls back
          // to the primary key: a payload with no id is then a plain insert,
          // which the row's own unique index rejects. An offline clock-in for
          // a day that already had a row died that way — five retries, then
          // dropped to Sentry.
          query = db
            .from(mutation.table)
            .upsert(
              mutation.payload,
              mutation.onConflict ? { onConflict: mutation.onConflict } : undefined,
            );
        } else {
          dequeue(mutation.id);
          continue;
        }

        const { data: affected, error } = await query.select('id');
        /**
         * A UNIQUE VIOLATION ON A QUEUED INSERT IS SUCCESS, not failure.
         *
         * The row this mutation wanted to create already exists — someone
         * clocked in from another device, or an earlier replay landed and the
         * response was lost. The end state the staffer asked for is the end
         * state on the server, so retrying can only fail again: five attempts,
         * then dropped to Sentry as data loss it is not.
         *
         * 23505 is Postgres's unique_violation. Narrow on purpose — every
         * other error still retries.
         */
        const alreadyThere =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mutation.operation === 'insert' && (error as any)?.code === '23505';
        if (error && !alreadyThere) {
          incrementRetry(mutation.id);
        } else if (alreadyThere) {
          dequeue(mutation.id);
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
            // Orders are matched on their id, in either match shape.
            fireOrderStatusPush(
              Number(match.id ?? mutation.matchValue),
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
