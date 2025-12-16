import diacritics from 'diacritics';


/**
 * utilNormalizeString
 * This converts a string into a "normalized" version useful for searching and comparisons.
 * (Various versions of this exist in other projects, see NSI, OCI, etc.)
 *
 * - Diacritics are normalized into as few code points as possible. ('o◌̈' -> 'ö')
 * - A few common substitutions are made ('&' -> 'and')
 * - Letters and Decimal Numbers are kept, everything else (punctuation, spaces, etc) removed
 * - Diacritics are folded into their latin form  ('ö' -> 'o')
 *
 * @see https://dev.to/tillsanders/let-s-stop-using-a-za-z-4a0m
 * @see https://stackoverflow.com/questions/4328500/how-can-i-strip-all-punctuation-from-a-string-in-javascript-using-regex
 * @param  {string}  str - the input string
 * @return {string}  the normalized string
 */
export function utilNormalizeString(str) {
  if (typeof str !== 'string') return '';

  // Get diacritic marks into a consistent format, perfer them combined into fewer characters.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
  if (typeof str.normalize === 'function') {
    str = str.normalize('NFKC');
  }

  return diacritics.remove(
    str
      .replace(/&/g, 'and')
      .replace(/(İ|i̇)/ig, 'i')   // Turkish, for BİM, İşbank - NSI#5017, NSI#8261
      .replace(/[^\p{L}\p{Nd}]/gu, '')   // Keep Letters and Decimal Numbers only
      .toLowerCase()
  );
}


/**
 * utilWildcard
 * This checks if a string looks like a "wildcard" string (contains '*' or '?')
 * and if so, converts it to a regular expression.
 *
 * @see https://stackoverflow.com/a/57527468/7620
 * @param  {string}  str - the string to check
 * @return {RegExp}  a regular expression, or `null` if not a wildcard string.
 */
export function utilWildcard(str) {
  if (typeof str !== 'string') return null;
  if (!(/[*?]/.test(str))) return null;   // no wildcard chars

  const wild = str
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')   // escape special regex characters
    .replace(/\*/g, '.*')                   // * match
    .replace(/\?/g, '.');                   // ? match

  return new RegExp(`^${wild}$`);
}
