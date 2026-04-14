/**
 * 1stOne F1 — Formatters
 *
 * Display formatting utilities. Pure functions, no side effects.
 */

/**
 * Format price in INR (₹)
 * Always shows 2 decimal places for consistency.
 */
export function formatPrice(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

/** Alias for formatPrice — preferred in UI contexts */
export const formatCurrency = formatPrice;

/**
 * Format price without decimals (for whole-number displays)
 */
export function formatPriceShort(amount: number): string {
  return `₹${Math.round(amount)}`;
}

/**
 * Format phone number for display: +91 XXXXX XXXXX
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return phone;
}

/**
 * Format date as "Mon, 6 Apr" style
 */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Format date as "6 April 2026"
 */
export function formatDateLong(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Relative time: "2 min ago", "1 hr ago", "Yesterday"
 */
export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;

  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return formatDateShort(dateStr);
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

/**
 * Capitalize first letter
 */
export function capitalize(text: string): string {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Format order status for display: "out_for_delivery" → "Out for delivery"
 */
export function formatOrderStatus(status: string): string {
  return capitalize(status.replace(/_/g, ' '));
}
