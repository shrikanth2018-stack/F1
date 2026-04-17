/**
 * Tests — formatters.ts
 * Pure functions, no mocks needed.
 */

import {
  formatPrice,
  formatPriceShort,
  formatPhone,
  formatDateShort,
  formatDateLong,
  formatRelativeTime,
  truncate,
  capitalize,
  formatOrderStatus,
} from '../utils/formatters';

describe('formatPrice', () => {
  it('formats whole numbers with 2 decimal places', () => {
    expect(formatPrice(100)).toBe('₹100.00');
    expect(formatPrice(0)).toBe('₹0.00');
  });

  it('formats decimal amounts correctly', () => {
    expect(formatPrice(99.5)).toBe('₹99.50');
    expect(formatPrice(1234.99)).toBe('₹1234.99');
  });
});

describe('formatPriceShort', () => {
  it('rounds to nearest integer', () => {
    expect(formatPriceShort(99.9)).toBe('₹100');
    expect(formatPriceShort(99.4)).toBe('₹99');
    expect(formatPriceShort(500)).toBe('₹500');
  });
});

describe('formatPhone', () => {
  it('formats 10-digit number with +91 prefix', () => {
    expect(formatPhone('9876543210')).toBe('+91 98765 43210');
  });

  it('formats 12-digit number starting with 91', () => {
    expect(formatPhone('919876543210')).toBe('+91 98765 43210');
  });

  it('returns input unchanged for unrecognised formats', () => {
    expect(formatPhone('12345')).toBe('12345');
  });
});

describe('truncate', () => {
  it('returns string unchanged if within limit', () => {
    expect(truncate('Hello', 10)).toBe('Hello');
    expect(truncate('Hello', 5)).toBe('Hello');
  });

  it('truncates with ellipsis when over limit', () => {
    const result = truncate('Hello World', 8);
    expect(result).toHaveLength(8);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('capitalize', () => {
  it('capitalizes first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
    expect(capitalize('world')).toBe('World');
  });

  it('handles empty string', () => {
    expect(capitalize('')).toBe('');
  });
});

describe('formatOrderStatus', () => {
  it('converts underscores to spaces and capitalizes', () => {
    expect(formatOrderStatus('out_for_delivery')).toBe('Out for delivery');
    expect(formatOrderStatus('confirmed')).toBe('Confirmed');
  });
});

describe('formatDateShort', () => {
  it('returns a non-empty string for a valid date', () => {
    const result = formatDateShort('2026-04-16');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes the day number', () => {
    expect(formatDateShort('2026-04-16')).toMatch(/16/);
  });
});

describe('formatDateLong', () => {
  it('returns a non-empty string for a valid date', () => {
    const result = formatDateLong('2026-04-16');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes the year', () => {
    expect(formatDateLong('2026-04-16')).toMatch(/2026/);
  });
});

describe('formatRelativeTime', () => {
  it('returns "Just now" for less than a minute ago', () => {
    const recent = new Date(Date.now() - 30 * 1000).toISOString();
    expect(formatRelativeTime(recent)).toBe('Just now');
  });

  it('returns minutes ago for recent times', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe('5 min ago');
  });

  it('returns hours ago for same-day times', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe('2 hr ago');
  });

  it('returns "Yesterday" for times ~25h ago', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(yesterday)).toBe('Yesterday');
  });

  it('returns "N days ago" for 2–6 days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe('3 days ago');
  });

  it('falls back to formatDateShort for 7+ days ago', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(tenDaysAgo);
    // Should be a date string, not a relative label
    expect(result).not.toMatch(/ago/);
    expect(result.length).toBeGreaterThan(0);
  });
});
