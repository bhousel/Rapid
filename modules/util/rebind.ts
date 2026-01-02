/**
 * A D3-style getter-setter method.
 * When called with no arguments, returns the current value.
 * When called with arguments, sets the value and returns the source object.
 */
type D3Method<S> = (this: S, ...args: unknown[]) => unknown;

/**
 * Wraps a D3 getter-setter method to return target instead of source.
 * This enables method chaining on the target object.
 * @param target - The object to return for method chaining
 * @param source - The object containing the original method
 * @param method - The D3 getter-setter method to wrap
 * @returns A wrapped function that chains to target instead of source
 */
function d3_rebind<T, S>(target: T, source: S, method: D3Method<S>): (...args: unknown[]) => T | unknown {
  return function(...args: unknown[]): T | unknown {
    const value = method.apply(source, args);
    return value === source ? target : value;
  };
}

/**
 * Copies methods from source to target, rebinding them for proper method chaining.
 * This is useful for composing D3-style objects with getter-setter methods.
 * @param target - The object to copy methods to
 * @param source - The object to copy methods from
 * @param methods - The method names to copy
 * @returns The target object with the copied methods
 *
 * @example
 * const wrapper = utilRebind({}, d3.behavior.zoom(), 'on', 'scale', 'translate');
 */
export function utilRebind<T extends Record<string, unknown>, S extends Record<string, D3Method<S>>>(
  target: T,
  source: S,
  ...methods: (keyof S)[]
): T {
  for (const method of methods) {
    (target as Record<string, unknown>)[method as string] = d3_rebind(target, source, source[method]);
  }
  return target;
}
