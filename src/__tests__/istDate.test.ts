/**
 * Tests for the shared IST calendar-date helpers (audit O6).
 *
 * The headline case: between 00:00 and 05:30 IST the UTC date is still the
 * previous calendar day. todayIST() / istDateStr() must return the IST date.
 */

import { todayIST, istDateStr, istDateWithOffset, addDaysToISODate } from '../utils/istDate';

describe('istDateStr', () => {
  it('returns the IST calendar date for a given instant', () => {
    // 2026-05-19 14:00 UTC = 2026-05-19 19:30 IST
    expect(istDateStr(new Date('2026-05-19T14:00:00Z'))).toBe('2026-05-19');
  });

  it('rolls forward to the next IST day for a late-UTC instant', () => {
    // 2026-05-19 20:00 UTC = 2026-05-20 01:30 IST — UTC says the 19th,
    // IST says the 20th. A toISOString() date would be wrong here.
    expect(istDateStr(new Date('2026-05-19T20:00:00Z'))).toBe('2026-05-20');
  });

  it('handles the IST-midnight boundary', () => {
    // 2026-05-19 18:30 UTC = exactly 2026-05-20 00:00 IST
    expect(istDateStr(new Date('2026-05-19T18:30:00Z'))).toBe('2026-05-20');
  });
});

describe('todayIST', () => {
  afterEach(() => jest.useRealTimers());

  it('uses the IST date when UTC is still on the previous day', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-19T23:00:00Z'));
    // 04:30 IST on 2026-05-20
    expect(todayIST()).toBe('2026-05-20');
  });

  it('matches istDateStr() with no argument', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-19T10:00:00Z'));
    expect(todayIST()).toBe(istDateStr());
    expect(todayIST()).toBe('2026-05-19');
  });
});

describe('istDateWithOffset', () => {
  afterEach(() => jest.useRealTimers());

  it('returns a future / past IST date relative to today', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-19T10:00:00Z'));
    expect(istDateWithOffset(0)).toBe('2026-05-19');
    expect(istDateWithOffset(1)).toBe('2026-05-20');
    expect(istDateWithOffset(-7)).toBe('2026-05-12');
  });

  it('crosses month boundaries', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T10:00:00Z'));
    expect(istDateWithOffset(3)).toBe('2026-06-02');
  });
});

describe('addDaysToISODate', () => {
  it('adds days within a month', () => {
    expect(addDaysToISODate('2026-05-19', 5)).toBe('2026-05-24');
  });

  it('subtracts days', () => {
    expect(addDaysToISODate('2026-05-19', -5)).toBe('2026-05-14');
  });

  it('crosses a month boundary', () => {
    expect(addDaysToISODate('2026-04-20', 15)).toBe('2026-05-05');
  });

  it('crosses a year boundary', () => {
    expect(addDaysToISODate('2026-12-20', 20)).toBe('2027-01-09');
  });

  it('handles a non-leap February correctly', () => {
    expect(addDaysToISODate('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('is a no-op for zero days', () => {
    expect(addDaysToISODate('2026-05-19', 0)).toBe('2026-05-19');
  });
});
