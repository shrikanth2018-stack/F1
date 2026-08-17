/**
 * Tests for src/utils/orderStatusPush.ts — which status changes reach the
 * customer's phone.
 *
 * THIS IS AN ANTI-SPAM RULE, and it is a business decision rather than an
 * implementation detail: a push fires at five milestones only — Ready,
 * Dispatched, Received at Hub, Delivered, Cancelled. Preparing, Packed and
 * On the Way are deliberately SILENT.
 *
 * A subscriber on Breakfast 30 receives a dispatch every single morning. Adding
 * one more status to the noisy set means thirty extra notifications a month per
 * customer, which is how an app gets its notifications switched off entirely —
 * and then the five that matter stop arriving too.
 *
 * The same helper serves both paths, online (useUpdateOrderStatus) and offline
 * (useOfflineSync replaying a queued change), so this set is the whole rule.
 */

const mockSendPush = jest.fn();
jest.mock('@/api/sendPush', () => ({ sendPush: (...args: unknown[]) => mockSendPush(...args) }));

import { fireOrderStatusPush } from '../utils/orderStatusPush';
import { ORDER_STATUS_FLOW } from '../utils/orderStatus';

const CUSTOMER = 'c0ffee00-0000-4000-8000-000000000001';

/** The five the customer is allowed to hear about. */
const PUSHES = ['Ready', 'Dispatched', 'Received at Hub', 'Delivered', 'Cancelled'];
/** In the flow, but deliberately silent. */
const SILENT = ['Pending', 'Confirmed', 'Preparing', 'Packed', 'On the Way'];

beforeEach(() => mockSendPush.mockClear());

describe('fireOrderStatusPush — the five milestones', () => {
  it.each(PUSHES)('pushes on %s', async (status) => {
    await fireOrderStatusPush(101, status, CUSTOMER);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
  });

  it.each(SILENT)('stays silent on %s', async (status) => {
    await fireOrderStatusPush(101, status, CUSTOMER);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it('covers every status in the flow — each one either pushes or is silent', () => {
    // Guards the test itself: add a status to ORDER_STATUS_FLOW and this fails
    // until someone decides, deliberately, which side it belongs on.
    for (const status of ORDER_STATUS_FLOW) {
      expect([...PUSHES, ...SILENT]).toContain(status);
    }
  });

  it('stays silent on a status that is not in the vocabulary at all', async () => {
    await fireOrderStatusPush(101, 'Refunded', CUSTOMER);
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

describe('fireOrderStatusPush — what it sends', () => {
  it('carries the event_key so the admin template wins over the fallback', async () => {
    await fireOrderStatusPush(11698, 'Delivered', CUSTOMER);
    const body = mockSendPush.mock.calls[0][0];
    expect(body.event_key).toBe('order.delivered');
    // The fallback copy is only used when no notification_templates row matches.
    expect(body.title).toBe('Delivered!');
    expect(body.body).toContain('11698');
  });

  it('names the order in every fallback body, so a push is actionable', async () => {
    for (const status of PUSHES) {
      mockSendPush.mockClear();
      await fireOrderStatusPush(4242, status, CUSTOMER);
      expect(mockSendPush.mock.calls[0][0].body).toContain('4242');
    }
  });

  it('deep-links to the order and tags the trigger for push_logs', async () => {
    await fireOrderStatusPush(7, 'Ready', CUSTOMER);
    const body = mockSendPush.mock.calls[0][0];
    expect(body.data).toEqual({ screen: 'OrderDetail', params: { orderId: 7 } });
    expect(body.trigger_source).toBe('order_status');
    expect(body.reference_id).toBe('7');
    expect(body.user_ids).toEqual([CUSTOMER]);
  });

  it('uses a distinct event_key per milestone', async () => {
    const keys: string[] = [];
    for (const status of PUSHES) {
      mockSendPush.mockClear();
      await fireOrderStatusPush(1, status, CUSTOMER);
      keys.push(mockSendPush.mock.calls[0][0].event_key);
    }
    // A shared key would make one template overwrite another's copy in the
    // admin's Notification Manager.
    expect(new Set(keys).size).toBe(PUSHES.length);
  });
});

describe('fireOrderStatusPush — when the customer is unknown', () => {
  it.each([[null], [undefined], ['']])('sends nothing when the user id is %p', async (id) => {
    await fireOrderStatusPush(101, 'Delivered', id as string | null | undefined);
    // A push with no recipient is a wasted call at best; at worst the server
    // would have to decide what an empty audience means.
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

describe('fireOrderStatusPush never breaks the status update', () => {
  /**
   * WHERE THE NO-THROW GUARANTEE ACTUALLY LIVES. This helper awaits
   * `sendPush`, and `sendPush` is the layer that swallows everything — it
   * catches, logs and returns null, and `sendPush.test.ts` asserts that. So the
   * right test here is not "this rejects when its dependency rejects" (true of
   * the code, but of a situation production cannot produce); it is that nothing
   * in THIS module throws before or after the call.
   *
   * The status write has already committed by the time this runs, so a
   * notification problem must never surface to the staffer as a failed status
   * change.
   */
  it('resolves quietly for a milestone', async () => {
    mockSendPush.mockResolvedValueOnce({ sent: 1, failed: 0 });
    await expect(fireOrderStatusPush(101, 'Delivered', CUSTOMER)).resolves.toBeUndefined();
  });

  it('resolves quietly for a silent status, without calling out at all', async () => {
    await expect(fireOrderStatusPush(101, 'Packed', CUSTOMER)).resolves.toBeUndefined();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it('does not throw synchronously on a malformed status', () => {
    // Called from a tap handler; a synchronous throw would take the screen down
    // rather than lose a notification.
    expect(() => {
      void fireOrderStatusPush(101, undefined as unknown as string, CUSTOMER);
    }).not.toThrow();
  });
});
