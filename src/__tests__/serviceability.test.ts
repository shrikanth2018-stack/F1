// Mock supabase so AsyncStorage (a native module) is never loaded in node env.
// Variables prefixed with `mock` are allowed inside jest.mock() per Jest's hoisting rules.
const mockData: {
  zones: Array<{ id: number; zone_name: string; polygon_geojson: { lat: number; lng: number }[] | null }>;
  hubs: Array<{ id: number; hub_name: string; polygon_geojson: { lat: number; lng: number }[] | null; extends_coverage: boolean }>;
} = { zones: [], hubs: [] };

jest.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const filterChain = {
        eq: () => filterChain,
        select: () => filterChain,
        then: (resolve: (value: { data: unknown }) => void) => {
          if (table === 'delivery_zones') resolve({ data: mockData.zones });
          else if (table === 'delivery_hubs') resolve({ data: mockData.hubs });
          else resolve({ data: [] });
        },
      };
      return filterChain;
    },
  },
}));

import { pointInPolygon, checkZone } from '@/utils/serviceability';

// Simple square polygon: (0,0) → (0,2) → (2,2) → (2,0)
const square = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 2 },
  { lat: 2, lng: 2 },
  { lat: 2, lng: 0 },
];

// Realistic Bengaluru-scale polygon (approximate Koramangala block)
const bengaluruZone = [
  { lat: 12.9200, lng: 77.6200 },
  { lat: 12.9200, lng: 77.6400 },
  { lat: 12.9350, lng: 77.6400 },
  { lat: 12.9350, lng: 77.6200 },
];

describe('pointInPolygon — simple square', () => {
  it('returns true for a point clearly inside', () => {
    expect(pointInPolygon(1, 1, square)).toBe(true);
  });

  it('returns false for a point clearly outside', () => {
    expect(pointInPolygon(3, 3, square)).toBe(false);
    expect(pointInPolygon(-1, 1, square)).toBe(false);
  });

  it('returns false for a point to the right of the polygon', () => {
    expect(pointInPolygon(1, 5, square)).toBe(false);
  });

  it('returns false for a point above the polygon', () => {
    expect(pointInPolygon(5, 1, square)).toBe(false);
  });
});

describe('pointInPolygon — Bengaluru-scale zone', () => {
  it('returns true for a coordinate inside the zone', () => {
    // Centre of the bounding box
    expect(pointInPolygon(12.9275, 77.6300, bengaluruZone)).toBe(true);
  });

  it('returns false for a coordinate outside the zone', () => {
    // Well outside — HSR Layout area
    expect(pointInPolygon(12.9116, 77.6389, bengaluruZone)).toBe(false);
  });

  it('returns false for a coordinate north of the zone', () => {
    expect(pointInPolygon(12.9500, 77.6300, bengaluruZone)).toBe(false);
  });

  it('returns false for a coordinate west of the zone', () => {
    expect(pointInPolygon(12.9275, 77.6100, bengaluruZone)).toBe(false);
  });
});

describe('pointInPolygon — edge cases', () => {
  it('returns false for a degenerate polygon with fewer than 3 vertices', () => {
    const line = [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
    // Ray-casting on a 2-vertex polygon — should return false (loop never fires)
    expect(pointInPolygon(0.5, 0.5, line)).toBe(false);
  });

  it('returns false for an empty polygon', () => {
    expect(pointInPolygon(1, 1, [])).toBe(false);
  });

  it('handles a triangle correctly — inside', () => {
    const triangle = [
      { lat: 0, lng: 0 },
      { lat: 4, lng: 0 },
      { lat: 2, lng: 4 },
    ];
    expect(pointInPolygon(2, 1, triangle)).toBe(true);
  });

  it('handles a triangle correctly — outside', () => {
    const triangle = [
      { lat: 0, lng: 0 },
      { lat: 4, lng: 0 },
      { lat: 2, lng: 4 },
    ];
    expect(pointInPolygon(0, 3, triangle)).toBe(false);
  });
});

describe('checkZone — hub-extends fallback', () => {
  // Two non-overlapping polygons:
  //   zone covers (0,0) → (10,10)
  //   hub covers (20,20) → (30,30) and has extends_coverage=true
  const zonePoly = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 10 },
    { lat: 10, lng: 10 },
    { lat: 10, lng: 0 },
  ];
  const hubPoly = [
    { lat: 20, lng: 20 },
    { lat: 20, lng: 30 },
    { lat: 30, lng: 30 },
    { lat: 30, lng: 20 },
  ];

  beforeEach(() => {
    mockData.zones = [];
    mockData.hubs = [];
  });

  it('returns serviceable + zoneId when point is inside a zone', async () => {
    mockData.zones = [{ id: 1, zone_name: 'A', polygon_geojson: zonePoly }];
    mockData.hubs = [{ id: 99, hub_name: 'X', polygon_geojson: hubPoly, extends_coverage: true }];
    const r = await checkZone(5, 5);
    expect(r.result).toBe('serviceable');
    expect(r.zoneId).toBe(1);
    expect(r.zoneName).toBe('A');
    expect(r.hubId).toBeNull();
  });

  it('returns serviceable + hubId when point is OUTSIDE zones but inside an extending hub', async () => {
    mockData.zones = [{ id: 1, zone_name: 'A', polygon_geojson: zonePoly }];
    mockData.hubs = [{ id: 99, hub_name: 'X', polygon_geojson: hubPoly, extends_coverage: true }];
    const r = await checkZone(25, 25);
    expect(r.result).toBe('serviceable');
    expect(r.zoneId).toBeNull();
    expect(r.hubId).toBe(99);
    expect(r.hubName).toBe('X');
  });

  it('zone takes priority over hub when point is inside both', async () => {
    // Overlapping case: hub covers same area as zone
    mockData.zones = [{ id: 1, zone_name: 'A', polygon_geojson: zonePoly }];
    mockData.hubs = [{ id: 99, hub_name: 'X', polygon_geojson: zonePoly, extends_coverage: true }];
    const r = await checkZone(5, 5);
    expect(r.zoneId).toBe(1);
    expect(r.hubId).toBeNull();
  });

  it('returns not_serviceable when point is outside everything (with config present)', async () => {
    mockData.zones = [{ id: 1, zone_name: 'A', polygon_geojson: zonePoly }];
    mockData.hubs = [{ id: 99, hub_name: 'X', polygon_geojson: hubPoly, extends_coverage: true }];
    const r = await checkZone(50, 50);
    expect(r.result).toBe('not_serviceable');
    expect(r.zoneId).toBeNull();
    expect(r.hubId).toBeNull();
  });

  it('returns unknown when nothing is configured (no zones, no hubs)', async () => {
    mockData.zones = [];
    mockData.hubs = [];
    const r = await checkZone(5, 5);
    expect(r.result).toBe('unknown');
  });

  it('skips zones with degenerate polygons', async () => {
    mockData.zones = [
      { id: 1, zone_name: 'Bad', polygon_geojson: null },
      { id: 2, zone_name: 'Good', polygon_geojson: zonePoly },
    ];
    const r = await checkZone(5, 5);
    expect(r.zoneId).toBe(2);
  });

  it('does not match a hub when no zones are configured but an extending hub covers the point', async () => {
    // Edge case: only extending hubs, no zones — should still return hub match
    mockData.zones = [];
    mockData.hubs = [{ id: 99, hub_name: 'Solo', polygon_geojson: hubPoly, extends_coverage: true }];
    const r = await checkZone(25, 25);
    expect(r.result).toBe('serviceable');
    expect(r.hubId).toBe(99);
  });

  it('returns first matching extending hub when multiple cover the same point (deterministic order)', async () => {
    mockData.zones = [];
    mockData.hubs = [
      { id: 1, hub_name: 'First', polygon_geojson: hubPoly, extends_coverage: true },
      { id: 2, hub_name: 'Second', polygon_geojson: hubPoly, extends_coverage: true },
    ];
    const r = await checkZone(25, 25);
    // First in array wins — depends on DB row order but is deterministic per query
    expect(r.hubId).toBe(1);
  });

  it('skips hubs with degenerate polygons (e.g. fewer than 3 vertices)', async () => {
    mockData.zones = [];
    mockData.hubs = [
      { id: 1, hub_name: 'Bad', polygon_geojson: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], extends_coverage: true },
      { id: 2, hub_name: 'Good', polygon_geojson: hubPoly, extends_coverage: true },
    ];
    const r = await checkZone(25, 25);
    expect(r.hubId).toBe(2);
  });

  it('skips hubs with null polygon_geojson', async () => {
    mockData.zones = [];
    mockData.hubs = [
      { id: 1, hub_name: 'NoPoly', polygon_geojson: null, extends_coverage: true },
      { id: 2, hub_name: 'WithPoly', polygon_geojson: hubPoly, extends_coverage: true },
    ];
    const r = await checkZone(25, 25);
    expect(r.hubId).toBe(2);
  });
});

describe('checkZone — error handling', () => {
  it('returns the EMPTY result when supabase query throws', async () => {
    // Replace the mock for this test to throw
    const original = require('@/api/supabaseClient').supabase.from;
    require('@/api/supabaseClient').supabase.from = () => {
      throw new Error('Network down');
    };
    try {
      const r = await checkZone(5, 5);
      expect(r.result).toBe('unknown');
      expect(r.zoneId).toBeNull();
      expect(r.hubId).toBeNull();
    } finally {
      require('@/api/supabaseClient').supabase.from = original;
    }
  });
});
