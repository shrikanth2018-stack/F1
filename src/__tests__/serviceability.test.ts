// Mock supabase so AsyncStorage (a native module) is never loaded in node env
jest.mock('@/api/supabaseClient', () => ({ supabase: {} }));

import { pointInPolygon } from '@/utils/serviceability';

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
