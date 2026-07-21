/**
 * Tests for the shared client-side push sender (audit O4).
 *
 * Locks in the contract the callers (order-status, special-offer banner,
 * Note to Staff, admin custom-push composer) depend on: attach the JWT,
 * invoke send-push, no-op without a session, never throw — and return
 * {sent, failed} on success / null on any failure (composer feedback).
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

  it('returns {sent, failed} on success', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } });
    mockInvoke.mockResolvedValue({ data: { sent: 3, failed: 1 }, error: null });

    await expect(sendPush({ title: 'Hi', body: 'There' })).resolves.toEqual({ sent: 3, failed: 1 });
  });

  it('returns null (never throws) when the invoke fails', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } });
    mockInvoke.mockRejectedValue(new Error('network down'));

    await expect(sendPush({ title: 'Hi', body: 'There' })).resolves.toBeNull();
  });

  it('returns null when the function responds with an error', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } });
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'unauthorized' } });

    await expect(sendPush({ title: 'Hi', body: 'There' })).resolves.toBeNull();
  });

  it('returns null (never throws) when the session lookup fails', async () => {
    mockGetSession.mockRejectedValue(new Error('auth offline'));

    await expect(sendPush({ title: 'Hi', body: 'There' })).resolves.toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
