/**
 * 1stOne F1 — Validators
 *
 * Input validation helpers. Used in forms before submitting to server.
 */

/**
 * Validate Indian mobile number (10 digits, starts with 6-9)
 */
export function isValidIndianPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  // Accept with or without country code
  if (digits.length === 10) {
    return /^[6-9]\d{9}$/.test(digits);
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return /^91[6-9]\d{9}$/.test(digits);
  }
  return false;
}

/**
 * Normalize phone to E.164 format: +91XXXXXXXXXX
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  return phone;
}

/**
 * Validate OTP (6 digits)
 */
export function isValidOTP(otp: string): boolean {
  return /^\d{6}$/.test(otp);
}

/**
 * Validate non-empty string after trim
 */
export function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Validate positive number
 */
export function isPositiveNumber(value: number): boolean {
  return typeof value === 'number' && value > 0 && isFinite(value);
}

/**
 * Validate pincode (6-digit Indian)
 */
export function isValidPincode(pincode: string): boolean {
  return /^\d{6}$/.test(pincode);
}
