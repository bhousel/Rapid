
/**
 * utilDate
 * Accepts a date, a numeric timestamp, or a string that looks like a Date.
 * This does a bit of work to try to treat strings as ISO dates.
 * (Without it, string dates might be intrepreted in the time zone of the user).
 * @param  {string|number|Date}  val - the Date-like value to display.
 * @return {Date}  A valid date, or `null` if input couldn't be turned into a Date.
 */
export function utilDate(val) {
  let d;

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

  return (d && isFinite(d)) ? d : null;    // valid date, or null
}


/**
 * utilDateString
 * Returns a date string as ISO short format, for example 'YYYY-MM-DD'.
 * Accepts a date, a numeric timestamp, or a string that looks like a Date.
 * @param  {string|number|Date}  val - the Date-like value to convert to a date string
 * @return {string}  Date String in 'YYYY-MM-DD' format, or empty string if invalid input
 */
export function utilDateString(val) {
  const d = utilDate(val);
  if (!d) return '';

  return d.toISOString().split('T')[0];  // Return the date part of the ISO string
}
