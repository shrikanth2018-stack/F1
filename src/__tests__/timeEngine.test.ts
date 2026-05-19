/**
 * Tests for the time display/parsing helpers.
 *
 * The dispatch DECISION logic moved server-side (Task 3A) — it now lives in
 * supabase/functions/_shared/dispatch.ts and is covered by dispatch.test.ts.
 * This file only covers the surviving pure presentation helpers.
 */

import {
  parseTime,
  timeToMinutes,
  formatTime12h,
  getDispatchLabel,
} from '@/utils/timeEngine';

describe('parseTime', () => {
  it('parses HH:MM', () => {
    expect(parseTime('09:30')).toEqual({ hours: 9, minutes: 30 });
  });

  it('parses HH:MM:SS (ignores seconds)', () => {
    expect(parseTime('22:45:00')).toEqual({ hours: 22, minutes: 45 });
  });

  it('parses midnight', () => {
    expect(parseTime('00:00')).toEqual({ hours: 0, minutes: 0 });
  });
});

describe('timeToMinutes', () => {
  it('converts 00:00 to 0', () => {
    expect(timeToMinutes('00:00')).toBe(0);
  });

  it('converts 01:00 to 60', () => {
    expect(timeToMinutes('01:00')).toBe(60);
  });

  it('converts 22:30 to 1350', () => {
    expect(timeToMinutes('22:30')).toBe(1350);
  });

  it('converts 23:59 to 1439', () => {
    expect(timeToMinutes('23:59')).toBe(1439);
  });
});

describe('getDispatchLabel', () => {
  it('maps A to Today', () => {
    expect(getDispatchLabel('A')).toBe('Today');
  });

  it('maps B to Tomorrow', () => {
    expect(getDispatchLabel('B')).toBe('Tomorrow');
  });

  it('maps C to Day after tomorrow (BF-41 — cross-midnight after-cutoff)', () => {
    expect(getDispatchLabel('C')).toBe('Day after tomorrow');
  });
});

describe('formatTime12h', () => {
  it('formats midnight', () => {
    expect(formatTime12h('00:00')).toBe('12:00 AM');
  });

  it('formats noon', () => {
    expect(formatTime12h('12:00')).toBe('12:00 PM');
  });

  it('formats morning time', () => {
    expect(formatTime12h('07:30')).toBe('7:30 AM');
  });

  it('formats afternoon time', () => {
    expect(formatTime12h('14:45')).toBe('2:45 PM');
  });

  it('formats time with seconds suffix', () => {
    expect(formatTime12h('09:05:00')).toBe('9:05 AM');
  });

  it('pads minutes to 2 digits', () => {
    expect(formatTime12h('08:05')).toBe('8:05 AM');
  });

  it('returns dash for null', () => {
    expect(formatTime12h(null)).toBe('—');
  });

  it('returns dash for undefined', () => {
    expect(formatTime12h(undefined)).toBe('—');
  });

  it('returns dash for empty string', () => {
    expect(formatTime12h('')).toBe('—');
  });

  it('returns dash for a non-time string', () => {
    expect(formatTime12h('not-a-time')).toBe('—');
  });
});
