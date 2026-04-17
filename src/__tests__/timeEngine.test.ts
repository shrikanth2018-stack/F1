import {
  parseTime,
  timeToMinutes,
  getDispatchScenario,
  formatTime12h,
  getDispatchLabel,
  isCycleOrderable,
} from '@/utils/timeEngine';
import type { DeliveryCycle } from '@/types';

// Minimal cycle factory — only fields used by the functions under test
function makeCycle(cutoff: string, deliveryStart: string): DeliveryCycle {
  return {
    id: 1,
    cycle_name: 'Test Cycle',
    cutoff_time: cutoff,
    kitchen_push_time: '06:00:00',
    delivery_start: deliveryStart,
    delivery_end: '12:00:00',
    is_active: true,
    is_essentials: false,
    branch_id: null,
    sort_order: 1,
    created_at: '',
    updated_at: '',
  };
}

// Build a fake ISO timestamp with a given "HH:MM" local time
// (getDispatchScenario uses getHours/getMinutes which respect local TZ)
function tsAt(hours: number, minutes: number): string {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

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

describe('getDispatchScenario — normal cycle (cutoff < delivery_start)', () => {
  // cutoff 14:00, delivery_start 07:30 → NOT cross-midnight (cutoff > delivery_start IS cross-midnight)
  // For normal: cutoff=14:00 (840 min), delivery_start=07:30 (450 min) → 840 > 450 → IS cross-midnight
  // Let's use cutoff=10:00, delivery_start=12:00 → 600 < 720 → normal (cutoff < delivery_start)
  const cycle = makeCycle('10:00:00', '12:00:00');

  it('returns A when order placed before cutoff', () => {
    expect(getDispatchScenario(cycle, tsAt(8, 0))).toBe('A');
    expect(getDispatchScenario(cycle, tsAt(9, 59))).toBe('A');
  });

  it('returns B when order placed after cutoff', () => {
    expect(getDispatchScenario(cycle, tsAt(10, 0))).toBe('B');
    expect(getDispatchScenario(cycle, tsAt(14, 0))).toBe('B');
  });
});

describe('getDispatchScenario — cross-midnight cycle (cutoff > delivery_start)', () => {
  // cutoff=22:00 (1320), delivery_start=07:30 (450) → 1320 > 450 → cross-midnight
  const cycle = makeCycle('22:00:00', '07:30:00');

  it('returns A before delivery_start (early morning, still last-night window)', () => {
    expect(getDispatchScenario(cycle, tsAt(6, 0))).toBe('A');
  });

  it('returns B during the delivery window (after delivery_start, before cutoff)', () => {
    expect(getDispatchScenario(cycle, tsAt(9, 0))).toBe('B');
    expect(getDispatchScenario(cycle, tsAt(21, 59))).toBe('B');
  });

  it('returns A after cutoff (evening, ordering for tomorrow morning)', () => {
    expect(getDispatchScenario(cycle, tsAt(22, 0))).toBe('A');
    expect(getDispatchScenario(cycle, tsAt(23, 30))).toBe('A');
  });
});

describe('getDispatchLabel', () => {
  it('maps A to Today', () => {
    expect(getDispatchLabel('A')).toBe('Today');
  });

  it('maps B to Tomorrow', () => {
    expect(getDispatchLabel('B')).toBe('Tomorrow');
  });
});

describe('isCycleOrderable', () => {
  it('returns true when cycle is active', () => {
    expect(isCycleOrderable({ ...makeCycle('10:00:00', '12:00:00'), is_active: true })).toBe(true);
  });

  it('returns false when cycle is inactive', () => {
    expect(isCycleOrderable({ ...makeCycle('10:00:00', '12:00:00'), is_active: false })).toBe(false);
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
