import {
  isValidIndianPhone,
  normalizePhone,
  isValidOTP,
  isNonEmpty,
  isPositiveNumber,
  isValidPincode,
} from '@/utils/validators';

describe('isValidIndianPhone', () => {
  it('accepts 10-digit numbers', () => {
    expect(isValidIndianPhone('9876543210')).toBe(true);
    expect(isValidIndianPhone('6000000000')).toBe(true);
    expect(isValidIndianPhone('4444444444')).toBe(true); // test accounts
  });

  it('accepts 12-digit numbers starting with 91', () => {
    expect(isValidIndianPhone('919876543210')).toBe(true);
  });

  it('strips non-digits before validation', () => {
    expect(isValidIndianPhone('+91 98765 43210')).toBe(true);
    expect(isValidIndianPhone('98765-43210')).toBe(true);
  });

  it('rejects short numbers', () => {
    expect(isValidIndianPhone('98765')).toBe(false);
    expect(isValidIndianPhone('123456789')).toBe(false); // 9 digits
  });

  it('rejects 11-digit numbers not starting with 91', () => {
    expect(isValidIndianPhone('12345678901')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidIndianPhone('')).toBe(false);
  });
});

describe('normalizePhone', () => {
  it('prefixes 10-digit number with +91', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('normalizes 12-digit number starting with 91', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('strips non-digits before normalizing', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
  });

  it('returns input unchanged if it cannot be normalized', () => {
    expect(normalizePhone('12345')).toBe('12345');
  });
});

describe('isValidOTP', () => {
  it('accepts 6 digits', () => {
    expect(isValidOTP('123456')).toBe(true);
    expect(isValidOTP('000000')).toBe(true);
  });

  it('rejects fewer or more digits', () => {
    expect(isValidOTP('12345')).toBe(false);
    expect(isValidOTP('1234567')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isValidOTP('12345a')).toBe(false);
    expect(isValidOTP('      ')).toBe(false);
  });
});

describe('isNonEmpty', () => {
  it('returns true for non-empty string', () => {
    expect(isNonEmpty('hello')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isNonEmpty('')).toBe(false);
  });

  it('returns false for whitespace-only string', () => {
    expect(isNonEmpty('   ')).toBe(false);
    expect(isNonEmpty('\t\n')).toBe(false);
  });
});

describe('isPositiveNumber', () => {
  it('returns true for positive finite numbers', () => {
    expect(isPositiveNumber(1)).toBe(true);
    expect(isPositiveNumber(0.01)).toBe(true);
    expect(isPositiveNumber(999999)).toBe(true);
  });

  it('returns false for zero', () => {
    expect(isPositiveNumber(0)).toBe(false);
  });

  it('returns false for negative numbers', () => {
    expect(isPositiveNumber(-1)).toBe(false);
  });

  it('returns false for Infinity', () => {
    expect(isPositiveNumber(Infinity)).toBe(false);
  });
});

describe('isValidPincode', () => {
  it('accepts 6-digit pincodes', () => {
    expect(isValidPincode('560001')).toBe(true);
    expect(isValidPincode('000000')).toBe(true);
  });

  it('rejects non-6-digit strings', () => {
    expect(isValidPincode('56000')).toBe(false);
    expect(isValidPincode('5600011')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isValidPincode('56000a')).toBe(false);
  });
});
