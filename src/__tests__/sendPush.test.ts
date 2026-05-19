/**
 * Tests for the shared client-side push sender (audit O4).
 *
 * Locks in the contract the three callers (order-status, special-offer
 * banner, Note to Staff) now depend on: attach the JWT, invoke send-push,
 * no-op without a session, and never throw.
 */

const mockInvoke = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@/api/supabaseClient', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    auth: { getSession: () => mockGetSession() },
  },
}));

import { sendPush } from '@/api/sendPush';

beforeEach(() => {
  mockInvoke.mockReset();
  mockGetSession.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

describe('sendPush', () => {
  it('invokes send-push with the JWT auth header and the body', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } });
    mockInvoke.mockResolvedValue({ data: { sent: 1 }, error: null });

    await sendPush({ role: 'customer', title: 'Hi', body: 'There', trigger_source: 'admin_push' });

    expect(mockInvoke).toHaveBeenCalledWith('send-push', {
      headers: { Authorization: 'Bearer tok-123' },
      body: { role: 'customer', title: 'Hi', body: 'There', trigger_source: 'admin_push' },
    });
  });

  it('no-ops when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    await sendPush({ title: 'Hi', body: 'There' });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('never throws when the invoke fails', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } });
    mockInvoke.mockRejectedValue(new Error('network down'));

    await expect(sendPush({ title: 'Hi', body: 'There' })).resolves.toBeUndefined();
  });

  it('never throws when the session lookup fails', async () => {
    mockGetSession.mockRejectedValue(new Error('auth offline'));

    await expect(sendPush({ title: 'Hi', body: 'There' })).resolves.toBeUndefined();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
