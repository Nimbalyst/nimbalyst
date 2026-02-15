/**
 * Timestamp utility functions for database operations
 *
 * PGLite returns dates in various formats depending on how the query is made.
 * This utility normalizes timestamps to milliseconds for consistent handling.
 */

/**
 * Convert a database timestamp value to milliseconds since epoch.
 * Handles PGLite timezone issues by treating Date objects as UTC.
 *
 * @param value - The timestamp value from the database (Date, string, number, or unknown)
 * @returns Milliseconds since epoch, or Date.now() if value is invalid
 */
export function toMillis(value: unknown): number {
  if (!value) return Date.now();
  if (typeof value === 'number') return value;

  if (value instanceof Date) {
    // PGLite may return dates in local timezone when they should be UTC
    // Extract components and reconstruct as UTC
    const year = value.getFullYear();
    const month = value.getMonth();
    const day = value.getDate();
    const hour = value.getHours();
    const minute = value.getMinutes();
    const second = value.getSeconds();
    const ms = value.getMilliseconds();
    return Date.UTC(year, month, day, hour, minute, second, ms);
  }

  // Handle string timestamps
  const str = String(value).trim();
  const hasTimezone = str.endsWith('Z') || str.includes('+') || /[0-9]-\d{2}:\d{2}$/.test(str);
  const utcStr = hasTimezone ? str : str.replace(' ', 'T') + 'Z';
  const parsed = new Date(utcStr).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}
