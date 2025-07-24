
/**
 * utilIterable
 * Converts a single or multiple values into something iterable
 *  that can be iterated over with for..of
 * @param   {OneOrMore<T>}  vals - a single value or something iterable like Array or Set.
 * @return  {Iterable<T>}   An iterable
 */
export function utilIterable(vals) {
  if (Array.isArray(vals)) return vals;
  if (vals instanceof Set) return vals;
  if (vals === null || vals === undefined) return [];
  return [vals];
}

/**
 * An Iterable is technically any Object that supports the "iterable protocol",
 *  i.e. has a [Symbol.iterator] property.
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_iterable_protocol
 *
 * But here we limit it to Arrays and Sets (no Maps, strings, etc.)
 * @typedef  {Array|Set}   Iterable
 */

/**
 * For places we want to allow one or more.
 * @typedef  {T|Iterable<T>}   OneOrMore
 */

/**
 * Just a type alias to allow 'T' to stand in for '*'.
 * @typedef  {*}  T
 */
