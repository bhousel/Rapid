
import type { Nullable } from '../core/types.ts';

/** A value that can be converted to a Date: Date object, numeric timestamp, or date string */
export type DateLike = Date | number | string;


/**
 * utilDate
 * Accepts a date, a numeric timestamp, or a string that looks like a Date.
 * This does a bit of work to try to treat strings as ISO dates.
 * (Without it, string dates might be interpreted in the time zone of the user).
 *
 * @param val - The Date-like value to convert
 * @returns A valid Date, or `null` if input couldn't be turned into a Date
 *
 * @example
 * utilDate(new Date())           // returns the Date object
 * utilDate(1704067200000)        // returns Date from timestamp
 * utilDate('2024-01-01')         // returns Date, treated as UTC
 * utilDate('invalid')            // returns null
 */
export function utilDate(val: Nullable<DateLike>): Date | null {
  let d: Date | undefined;

  if (val instanceof Date) {
    d = val;

  } else if (typeof val === 'number') {  // treat as a timestamp
    d = new Date(val);

  } else if (typeof val === 'string' && val !== '') {
    let s = val;
    if (/^\d{4}/.test(s)) {    // starts with 4 digits..
      if (!(/([+-]\d{2}:\d{2}|Z)$/i).test(s)) {  // if it doesn't already end in a timezone
        s += 'Z';    // append Z to treat the string as a UTC date
      }
    }
    d = new Date(s);
  }

  return (d && isFinite(d.getTime())) ? d : null;    // valid date, or null
}


/**
 * utilDateString
 * Returns a date string as ISO short format, for example 'YYYY-MM-DD'.
 * Accepts a date, a numeric timestamp, or a string that looks like a Date.
 *
 * @param val - The Date-like value to convert to a date string
 * @returns Date string in 'YYYY-MM-DD' format, or empty string if invalid input
 *
 * @example
 * utilDateString(new Date('2024-01-15'))  // returns '2024-01-15'
 * utilDateString(1704067200000)           // returns '2024-01-01'
 * utilDateString('invalid')               // returns ''
 */
export function utilDateString(val: Nullable<DateLike>): string {
  const d = utilDate(val);
  if (!d) return '';

  return d.toISOString().split('T')[0];  // Return the date part of the ISO string
}
