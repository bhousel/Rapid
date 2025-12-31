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
 *
 * @param str - The input string
 * @returns The normalized string
 *
 * @example
 * utilNormalizeString('Héllo Wörld!')  // returns 'helloworld'
 * utilNormalizeString('Rock & Roll')   // returns 'rockandroll'
 */
export function utilNormalizeString(str: string): string {
  if (typeof str !== 'string') return '';

  // Get diacritic marks into a consistent format, prefer them combined into fewer characters.
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
  str = str.normalize('NFKC');

  return diacritics.remove(
    str
      .replace(/&/g, 'and')
      .replace(/(İ|i̇)/ig, 'i')   // Turkish, for BİM, İşbank - NSI#5017, NSI#8261
      .replace(/[^\p{L}\p{Nd}]/gu, '')   // Keep Letters and Decimal Numbers only
      .toLowerCase()
  );
}


/**
 * utilGatherTokens
 * This is used by the Preset code to extract tokens from the given string.
 * It sorts them into either the 'primary' or 'alternate' set based on the given `isPrimary` param.
 * This function also automatically checks whether removing diacritics would result in
 * a different string, and if so, adds it to the 'alternate' set.
 * The "primary" set should contain things like the preset name and similar names.
 * The "alternate" set should contain things like related terms and tag values a user might search for.
 *
 * @param str - The input string
 * @param primary - Set of 'primary' tokens
 * @param alternate - Set of 'alternate' tokens
 * @param isPrimary - Pass `true` to put the tokens into the 'primary' Set
 *
 * @example
 * const primary = new Set<string>();
 * const alternate = new Set<string>();
 * utilGatherTokens('Juan Valdes Café', primary, alternate, true);
 * // primary: Set(['juan', 'valdes', 'café'])
 * // alternate: Set(['cafe'])
 */
export function utilGatherTokens(str: string, primary: Set<string>, alternate: Set<string>, isPrimary: boolean): void {
  if (typeof str !== 'string') return;

  const spaceOrPunctuation = /[\n\r\p{Z}\p{P}]+/u;
  const tokens = str.split(spaceOrPunctuation).filter(Boolean);

  for (let s of tokens) {  // Gather tokens from the input string
    s = s.trim().toLowerCase();

    if (s.length < 2 || primary.has(s) || alternate.has(s)) continue;  // too small, or seen it before

    if (isPrimary) {
      primary.add(s);
    } else {
      alternate.add(s);
    }

    // Generate a version with the diacritics folded, e.g. 'ö' -> 'o'
    // If it differs from the original, add it as an alternate match.
    // (extra 'i' hack for Turkish, for BİM, İşbank - NSI#5017, NSI#8261)
    const s2 = diacritics.remove(s.replace(/(İ|i̇)/ig, 'i'));
    if (s2 !== s) {
      alternate.add(s2);
    }
  }
}


/**
 * utilWildcard
 * This checks if a string looks like a "wildcard" string (contains '*' or '?')
 * and if so, converts it to a regular expression.
 *
 * @see https://stackoverflow.com/a/57527468/7620
 *
 * @param str - The string to check
 * @returns A regular expression, or `null` if not a wildcard string
 *
 * @example
 * utilWildcard('foo*')     // returns /^foo.*$/
 * utilWildcard('foo?bar')  // returns /^foo.bar$/
 * utilWildcard('foobar')   // returns null (no wildcards)
 */
export function utilWildcard(str: string): RegExp | null {
  if (typeof str !== 'string') return null;
  if (!(/[*?]/.test(str))) return null;   // no wildcard chars

  const wild = str
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')   // escape special regex characters
    .replace(/\*/g, '.*')                   // * match
    .replace(/\?/g, '.');                   // ? match

  return new RegExp(`^${wild}$`);
}
