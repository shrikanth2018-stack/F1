/**
 * Tests for extractRole (src/hooks/useAuth.ts) — the pure function that
 * turns JWT custom claims into the app's routing/permission state (health
 * report #14). Every persona decision in RootNavigator flows from this.
 */

// useAuth pulls in native/store modules at import time — mock them out;
// extractRole itself touches none of them.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-device', () => ({ isDevice: false }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('@/api/supabaseClient', () => ({ supabase: {} }));
jest.mock('@/utils/sentry', () => ({
  setSentryUser: jest.fn(), clearSentryUser: jest.fn(), captureError: jest.fn(),
}));
jest.mock('@/utils/analytics', () => ({
  identifyUser: jest.fn(), resetAnalyticsUser: jest.fn(), trackLogin: jest.fn(),
}));

import { extractRole } from '@/hooks/useAuth';
import type { Session } from '@supabase/supabase-js';

/** Build a fake (unsigned) JWT with the given payload claims. */
function fakeSession(claims: Record<string, unknown> | 'malformed'): Session {
  const token =
    claims === 'malformed'
      ? 'not.a-real+jwt.at-all'
      : `header.${Buffer.from(JSON.stringify(claims)).toString('base64')}.sig`;
  return {
    access_token: token,
    user: { id: 'user-1', phone: '911234567890' },
  } as unknown as Session;
}

describe('extractRole', () => {
  it('returns null for a null session', () => {
    expect(extractRole(null)).toBeNull();
  });

  it('extracts all five custom claims', () => {
    const s = extractRole(fakeSession({
      user_role: 'staff',
      branch_id: 3,
      assigned_hub_id: 9,
      is_super_admin: false,
      is_driver: true,
    }));
    expect(s).toEqual({
      user: { id: 'user-1', phone: '911234567890' },
      role: 'staff',
      branchId: 3,
      assignedHubId: 9,
      isSuperAdmin: false,
      isDriver: true,
    });
  });

  it('defaults to customer with null claims when the token carries none', () => {
    const s = extractRole(fakeSession({}));
    expect(s).toMatchObject({
      role: 'customer',
      branchId: null,
      assignedHubId: null,
      isSuperAdmin: false,
      isDriver: false,
    });
  });

  it('is_super_admin is strictly boolean — a "true" STRING does not elevate', () => {
    const s = extractRole(fakeSession({ user_role: 'admin', is_super_admin: 'true' }));
    expect(s?.role).toBe('admin');
    expect(s?.isSuperAdmin).toBe(false);
  });

  it('is_driver is strictly boolean too', () => {
    const s = extractRole(fakeSession({ user_role: 'staff', is_driver: 'yes' }));
    expect(s?.isDriver).toBe(false);
  });

  it('falls back to a plain customer session on a malformed token (never throws)', () => {
    const s = extractRole(fakeSession('malformed'));
    expect(s).toEqual({
      user: { id: 'user-1', phone: '911234567890' },
      role: 'customer',
      assignedHubId: null,
      branchId: null,
      isSuperAdmin: false,
      isDriver: false,
    });
  });
});
