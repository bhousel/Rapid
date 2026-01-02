/**
 * Iterable
 * For our purposes, we limit iterables to Arrays and Sets (no Maps, strings, etc.)
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_iterable_protocol
 */
import type { Nullable } from '../core/types.ts';
export type Iterable<T> = T[] | Set<T>;

/**
 * OneOrMore<T>
 * Allows a single value or an iterable of values (Array or Set).
 */
export type OneOrMore<T> = T | Iterable<T>;


/**
 * utilIterable
 * Converts a single or multiple values into something iterable
 * that can be iterated over with for..of
 *
 * @param vals - A single value or something iterable like Array or Set
 * @returns An iterable (Array or Set)
 *
 * @example
 * utilIterable([1, 2, 3])     // returns [1, 2, 3]
 * utilIterable(new Set([1]))  // returns Set([1])
 * utilIterable(5)             // returns [5]
 * utilIterable(null)          // returns []
 */
export function utilIterable<T>(vals: Nullable<OneOrMore<T>>): Iterable<T> {
  if (Array.isArray(vals)) return vals;
  if (vals instanceof Set) return vals;
  if (vals === null || vals === undefined) return [];
  return [vals];
}