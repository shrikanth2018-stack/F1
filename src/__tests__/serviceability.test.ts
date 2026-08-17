/**
 * Tests for src/utils/serviceability.ts — asking the server whether a pin can
 * be delivered to.
 *
 * THE DEVICE DOES NO GEOGRAPHY. The point-in-polygon decision lives in
 * `resolve_address_serviceability` (supabase/sql/serviceability_server_side.sql)
 * and a customer cannot set their own zone or hub — the server overwrites
 * whatever they send. So there is exactly one rule worth guarding here, and it
 * is about FAILURE:
 *
 *   every error path returns 'unknown' with isServiceable false, and NOTHING
 *   throws.
 *
 * That is what stops a network blip, a mid-setup database, or a renamed RPC from
 * hard-blocking the address form — the one screen a brand-new customer must get
 * through before they can order anything at all. A thrown error here would
 * strand them at sign-up.
 */

const mockRpc = jest.fn();
jest.mock('@/api/supabaseClient', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

import { checkZone } from '../utils/serviceability';

const EMPTY = {
  result: 'unknown',
  isServiceable: false,
  zoneId: null,
  zoneName: null,
  hubId: null,
  hubName: null,
};

beforeEach(() => mockRpc.mockReset());

describe('checkZone — the happy paths', () => {
  it('passes the coordinate to the server and shapes the row it returns', async () => {
    mockRpc.mockResolvedValue({
      data: [{
        result: 'serviceable', is_serviceable: true,
        zone_id: 2, zone_name: 'Zone 1', hub_id: 19, hub_name: 'Kolsirsi',
      }],
      error: null,
    });

    await expect(checkZone(14.39, 74.88)).resolves.toEqual({
      result: 'serviceable', isServiceable: true,
      zoneId: 2, zoneName: 'Zone 1', hubId: 19, hubName: 'Kolsirsi',
    });

    expect(mockRpc).toHaveBeenCalledWith('resolve_address_serviceability', {
      p_lat: 14.39, p_lng: 74.88,
    });
  });

  it('reports a genuine not_serviceable verdict as itself, not as unknown', async () => {
    // The distinction matters to the caller: 'not_serviceable' is an answer
    // ("we do not deliver there"), 'unknown' is the absence of one.
    mockRpc.mockResolvedValue({
      data: [{ result: 'not_serviceable', is_serviceable: false, zone_id: null, hub_id: null }],
      error: null,
    });
    const out = await checkZone(0, 0);
    expect(out.result).toBe('not_serviceable');
    expect(out.isServiceable).toBe(false);
  });

  it('carries a hub with no zone — a hub that extends coverage', async () => {
    mockRpc.mockResolvedValue({
      data: [{
        result: 'serviceable', is_serviceable: true,
        zone_id: null, zone_name: null, hub_id: 21, hub_name: 'Bilagi',
      }],
      error: null,
    });
    const out = await checkZone(14.36, 74.79);
    expect(out).toMatchObject({ isServiceable: true, zoneId: null, hubId: 21 });
  });

  it('treats is_serviceable as strictly boolean true', async () => {
    // A truthy-but-not-true value from a changed RPC must not read as yes.
    mockRpc.mockResolvedValue({
      data: [{ result: 'serviceable', is_serviceable: 'yes', zone_id: 2 }],
      error: null,
    });
    expect((await checkZone(1, 1)).isServiceable).toBe(false);
  });

  it('fills missing optional columns with null rather than undefined', async () => {
    mockRpc.mockResolvedValue({ data: [{ result: 'serviceable', is_serviceable: true }], error: null });
    const out = await checkZone(1, 1);
    expect(out.zoneId).toBeNull();
    expect(out.hubName).toBeNull();
  });
});

describe('checkZone degrades to unknown instead of blocking the address form', () => {
  it('on an RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    await expect(checkZone(1, 1)).resolves.toEqual(EMPTY);
  });

  it('on an empty result set', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(checkZone(1, 1)).resolves.toEqual(EMPTY);
  });

  it('on a null payload', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(checkZone(1, 1)).resolves.toEqual(EMPTY);
  });

  it('when the call itself throws — a network blip', async () => {
    mockRpc.mockRejectedValue(new Error('Network request failed'));
    await expect(checkZone(1, 1)).resolves.toEqual(EMPTY);
  });

  it('when the client itself is missing the method entirely', async () => {
    mockRpc.mockImplementation(() => { throw new TypeError('rpc is not a function'); });
    await expect(checkZone(1, 1)).resolves.toEqual(EMPTY);
  });

  it('never rejects, for any of the above', async () => {
    const failures: Array<() => void> = [
      () => mockRpc.mockResolvedValue({ data: null, error: { message: 'x' } }),
      () => mockRpc.mockResolvedValue({ data: [], error: null }),
      () => mockRpc.mockRejectedValue(new Error('boom')),
      () => mockRpc.mockImplementation(() => { throw new Error('boom'); }),
    ];
    for (const set of failures) {
      mockRpc.mockReset();
      set();
      await expect(checkZone(1, 1)).resolves.toBeDefined();
    }
  });
});
