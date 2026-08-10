/**
 * Recursively merges own enumerable properties from one or more source objects
 * into a target object. Source properties that resolve to `undefined` are skipped.
 * Arrays are replaced (not concatenated). The target is mutated and returned.
 *
 * This is a purpose-built replacement for `lodash.merge` used in the style system.
 *
 * @param target  - the object to merge into
 * @param sources - one or more source objects to merge from (left to right)
 * @return the mutated target
 */
export function utilDeepMerge<T extends object>(target: T, ...sources: object[]): T {
  for (const source of sources) {
    if (source === null || source === undefined) continue;

    for (const [key, srcVal] of Object.entries(source)) {
      if (srcVal === undefined) continue;

      const tgtVal = (target as Record<string, unknown>)[key];

      if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
        utilDeepMerge(tgtVal as object, srcVal);
      } else if (isPlainObject(srcVal)) {
        // Clone the source object so mutations to the target don't affect the source.
        (target as Record<string, unknown>)[key] = utilDeepMerge({}, srcVal);
      } else {
        (target as Record<string, unknown>)[key] = srcVal;
      }
    }
  }
  return target;
}


function isPlainObject(val: unknown): val is object {
  if (typeof val !== 'object' || val === null) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}
