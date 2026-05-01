import { isVarRef, resolveVarRef } from './Variable.ts';

import type { Variable } from './Variable.ts';

/**
 * A `PropMatcher` is set of rules for matching object properties.
 *
 * Used for matching OSM tags and other key-value properties against conditions.
 * Supports various comparison operators: equals, not equals, exists, regex, numeric comparisons, etc.
 *
 * Values can be `var()` references that resolve against a Map of Variables:
 * ```json5
 * { key: "highway", op: "in", value: "var(major_highway_values)" }
 * ```
 *
 * @example
 * // Match highway=motorway
 * const matcher = new PropMatcher({ key: 'highway', value: 'motorway' });
 * matcher.matches({ highway: 'motorway' });  // true
 *
 * // Match any highway tag
 * const anyHighway = new PropMatcher({ key: 'highway', op: 'exists' });
 * anyHighway.matches({ highway: 'residential' });  // true
 *
 * // Match with regex on value
 * const trunkOrPrimary = new PropMatcher({ key: 'highway', op: '~', value: '^(trunk|primary)$' });
 * trunkOrPrimary.matches({ highway: 'trunk' });  // true
 *
 * // Match with regex on key (key pattern matching)
 * const tigerKey = new PropMatcher({ key: '^tiger:', keyOp: '~' });
 * tigerKey.matches({ 'tiger:source': 'census' });  // true
 * tigerKey.matches({ highway: 'motorway' });       // false
 *
 * // Match with RegExp key (keyOp inferred as '~')
 * const tigerKey2 = new PropMatcher({ key: /^tiger:/ });
 * tigerKey2.matches({ 'tiger:source': 'census' });  // true
 *
 * // Match any of several keys (keyOp inferred as 'in')
 * const coords = new PropMatcher({ key: ['lat', 'lon', 'latitude', 'longitude'] });
 * coords.matches({ lat: '35.6' });  // true
 * coords.matches({ longitude: '139.7' });  // true
 *
 * @module
 */


/** Comparison operators for PropMatcher */
export type PropMatcherOp =
  | '='       // Exact match (default when value is provided)
  | '!='      // Not equal
  | 'exists'  // Key exists (default when no value provided)
  | '!exists' // Key does not exist
  | '~'       // Regex match
  | '!~'      // Regex does not match
  | 'in'      // Value is in array
  | '!in'     // Value is not in array
  | '>'       // Greater than (numeric)
  | '>='      // Greater than or equal (numeric)
  | '<'       // Less than (numeric)
  | '<='      // Less than or equal (numeric)
  ;


/**
 * Properties for creating a `PropMatcher`.
 */
export interface PropMatcherProps {
  /**
   * The property key(s) to match against.
   * - `string` — exact key (default) or regex pattern (when `keyOp: '~'`)
   * - `string[]` — match any of several exact keys (infers `keyOp: 'in'`)
   * - `RegExp` — regex key pattern (infers `keyOp: '~'`; normalized to source string internally)
   */
  key: string | string[] | RegExp;
  /**
   * Key matching mode (inferred from `key` type when omitted).
   * - `'='`  (default for `string`): exact key match — checks `obj[key]` directly
   * - `'in'` (default for `string[]`): list key match — checks each key in the array against `obj`
   * - `'~'`  (default for `RegExp`): regex key match — iterates all keys of `obj` and tests each against the key pattern
   */
  keyOp?: '=' | 'in' | '~';
  /**
   * Comparison operator.
   * Defaults to '=' if value is provided, 'exists' if no value.
   */
  op?: PropMatcherOp;
  /**
   * Value to compare against.
   * - `string` for exact/regex match
   * - `number` for numeric comparisons
   * - `string[]` for 'in'/'!in' operators
   * - `RegExp` for '~'/'!~' operators (or string that will be converted)
   */
  value?: string | number | string[] | RegExp;
  /**
   * Whether to allow 'no' as a valid match for 'exists' and wildcard '*' operations.
   * In OSM, `tag=no` is an anti-pattern meaning "this tag does not apply", so by
   * default (false) these values are treated as if the tag doesn't exist.
   * Set to `true` if 'no' should be treated as a legitimate value.
   */
  allowNo?: boolean;
}


/**
 * A `PropMatcher` is set of rules for matching object properties.
 * Used for matching OSM tags and other key-value properties against conditions.
 * Supports various comparison operators: equals, not equals, exists, regex, numeric comparisons, etc.
 *
 * Properties you can access:
 *   `key`   The property key to match
 *   `op`    The comparison operator
 *   `value` The value to compare against (if applicable)
 *   `props` The full props object
 */
export class PropMatcher {
  props: PropMatcherProps;

  /** The property key(s) to match (exact string, regex pattern string, or array of exact strings) */
  readonly key: string | string[];
  /** Key matching mode: '=' for exact, '~' for regex, 'in' for list */
  readonly keyOp: '=' | '~' | 'in';
  /** The comparison operator */
  readonly op: PropMatcherOp;
  /** Cached RegExp for regex operations on key (when keyOp is '~') */
  private _keyRegex: RegExp | null = null;
  /** Cached Set for key-list lookups (when keyOp is 'in') */
  private _keySet: Set<string> | null = null;
  /** Cached RegExp for regex operations on value */
  private _valueRegex: RegExp | null = null;
  /** Cached Set for value-list lookups (when op is 'in' or '!in') */
  private _valueSet: Set<string> | null = null;
  /** Raw var() reference string, if the value is a variable reference */
  private _varRef: string | null = null;
  /** Resolved value after var() resolution — `null` means use raw props.value */
  private _resolvedValue: string | number | string[] | RegExp | null = null;
  /** Whether to allow 'no' as a valid match for 'exists' and wildcard '*' ops */
  private _allowNo: boolean;

  /**
   * @constructor
   * @param props - Properties defining the match condition
   * @throws Error if `key` property is missing
   * @throws Error if regex pattern is invalid (for `~` or `!~` operators)
   */
  constructor(props: PropMatcherProps) {
    // Validate and normalize the key
    const rawKey = props.key;
    if (rawKey instanceof RegExp) {
      this.key = rawKey.source;
      this.keyOp = props.keyOp ?? '~';
      this._keyRegex = rawKey;
    } else if (Array.isArray(rawKey)) {
      if (rawKey.length === 0) {
        throw new Error('PropMatcher: key is required');
      }
      this.key = rawKey;
      this.keyOp = props.keyOp ?? 'in';
    } else {
      if (!rawKey) {
        throw new Error('PropMatcher: key is required');
      }
      this.key = rawKey;
      this.keyOp = props.keyOp ?? '=';
    }

    // Shallow clone props, normalizing RegExp key to its source string for serialization
    this.props = { ...props };
    if (rawKey instanceof RegExp) {
      this.props.key = rawKey.source;
    }

    // Determine default operator based on whether value is provided
    if (props.op !== undefined) {
      this.op = props.op;
    } else if (props.value !== undefined) {
      this.op = '=';
    } else {
      this.op = 'exists';
    }

    // Pre-compile key regex if needed (and not already set from RegExp input)
    if (this.keyOp === '~' && !this._keyRegex) {
      try {
        this._keyRegex = new RegExp(this.key as string);
      } catch (e) {
        throw new Error(`PropMatcher: invalid key regex pattern '${this.key}'`, { cause: e });
      }
    }

    // Pre-compile key list into Set for O(1) lookups
    if (this.keyOp === 'in' && Array.isArray(this.key)) {
      this._keySet = new Set(this.key);
    }

    // Pre-compile value regex if needed
    if ((this.op === '~' || this.op === '!~') && props.value !== undefined) {
      if (props.value instanceof RegExp) {
        this._valueRegex = props.value;
      } else if (typeof props.value === 'string') {
        try {
          this._valueRegex = new RegExp(props.value, 'i');  // Case-insensitive by default
        } catch (e) {
          throw new Error(`PropMatcher: invalid regex pattern '${props.value}'`, { cause: e });
        }
      }
    }

    // Pre-compile value list into Set for O(1) lookups
    // If the value is a var() reference string, defer compilation until resolveVariables() is called.
    if ((this.op === 'in' || this.op === '!in') && props.value !== undefined) {
      if (typeof props.value === 'string' && isVarRef(props.value)) {
        this._varRef = props.value;
      } else if (Array.isArray(props.value)) {
        this._valueSet = new Set(props.value as string[]);
      }
    }

    // In OSM, `tag=no` is a common anti-pattern meaning "this doesn't apply".
    // By default, 'exists' and wildcard '*' treat 'no' as if the key were absent.
    this._allowNo = props.allowNo ?? false;
  }


  /**
   * The value to compare against.
   * Returns the resolved value (after var() resolution) if available, otherwise the raw value.
   */
  get value(): string | number | string[] | RegExp | undefined {
    return this._resolvedValue ?? this.props.value;
  }


  /**
   * Test if a properties object matches this matcher's conditions.
   *
   * @param obj - The object with properties to test
   * @return `true` if the object matches, `false` otherwise
   */
  matches(obj: Record<string, unknown>): boolean {
    if (!obj || typeof obj !== 'object') {
      // For 'exists'/'!exists' on null/undefined object
      return this.op === '!exists';
    }

    // Key-pattern matching: iterate all keys and find one matching the regex
    if (this.keyOp === '~' && this._keyRegex) {
      return this._matchKeyPattern(obj);
    }

    // Key-list matching: check each candidate key
    if (this.keyOp === 'in' && Array.isArray(this.key)) {
      return this._matchKeyList(obj);
    }

    // Exact key matching
    const key = this.key as string;
    const hasKey = Object.prototype.hasOwnProperty.call(obj, key);
    const val = obj[key];

    if (this.op === 'exists') return hasKey && val !== undefined && val !== null && (this._allowNo || val !== 'no');
    if (this.op === '!exists') return !hasKey || val === undefined || val === null;

    return this._checkValueOp(val);
  }


  /**
   * Test equality match.
   */
  private _matchEquals(val: unknown): boolean {
    const expected = this.value;

    // Handle wildcard '*' - matches any truthy value
    if (expected === '*') {
      return val !== undefined && val !== null && val !== '' && (this._allowNo || val !== 'no');
    }

    // Type coercion for comparison (OSM tags are strings)
    if (typeof val === 'string' && typeof expected === 'number') {
      return val === String(expected);
    }
    if (typeof val === 'number' && typeof expected === 'string') {
      return String(val) === expected;
    }

    return val === expected;
  }


  /**
   * Test regex match.
   */
  private _matchValueRegex(val: unknown): boolean {
    if (!this._valueRegex) return false;
    if (val === undefined || val === null) return false;

    const str = String(val);
    return this._valueRegex.test(str);
  }


  /**
   * Test if value is in the precompiled Set.
   */
  private _matchValueIn(val: unknown): boolean {
    if (!this._valueSet) return false;
    if (val === undefined || val === null) return false;

    const str = String(val);
    return this._valueSet.has(str);
  }


  /**
   * Perform numeric comparison.
   */
  private _compareValueNumeric(actualValue: unknown, compareFn: (a: number, b: number) => boolean): boolean {
    const expected = this.value;
    if (typeof expected !== 'number') return false;

    let actual: number;
    if (typeof actualValue === 'number') {
      actual = actualValue;
    } else if (typeof actualValue === 'string') {
      actual = parseFloat(actualValue);
      if (isNaN(actual)) return false;
    } else {
      return false;
    }

    return compareFn(actual, expected);
  }


  /**
   * Apply a value-side check for a single actual value.
   * Handles all ops except 'exists' and '!exists' (which are handled by the caller).
   */
  private _checkValueOp(val: unknown): boolean {
    switch (this.op) {
      case '=':   return this._matchEquals(val);
      case '!=':  return !this._matchEquals(val);
      case '~':   return this._matchValueRegex(val);
      case '!~':  return !this._matchValueRegex(val);
      case 'in':  return this._matchValueIn(val);
      case '!in': return !this._matchValueIn(val);
      case '>':   return this._compareValueNumeric(val, (a, b) => a > b);
      case '>=':  return this._compareValueNumeric(val, (a, b) => a >= b);
      case '<':   return this._compareValueNumeric(val, (a, b) => a < b);
      case '<=':  return this._compareValueNumeric(val, (a, b) => a <= b);
      default:    return false;
    }
  }


  /**
   * Match by key pattern: iterate all keys of the object and test each
   * against the pre-compiled key regex. For the first matching key, apply
   * the value check (op + value). For 'exists', just check that any key matches.
   */
  private _matchKeyPattern(obj: Record<string, unknown>): boolean {
    const keyRegex = this._keyRegex!;

    // For '!exists', ALL keys must not match the pattern
    if (this.op === '!exists') {
      for (const k of Object.keys(obj)) {
        if (keyRegex.test(k)) {
          const v = obj[k];
          if (v !== undefined && v !== null) return false;
        }
      }
      return true;
    }

    // For all other ops, find the first matching key and test its value
    for (const k of Object.keys(obj)) {
      if (keyRegex.test(k)) {
        const actualValue = obj[k];
        if (this.op === 'exists') {
          if (actualValue !== undefined && actualValue !== null && (this._allowNo || actualValue !== 'no')) return true;
        } else {
          if (this._checkValueOp(actualValue)) return true;
        }
      }
    }
    return false;
  }


  /**
   * Match by key list: iterate obj keys, checking each against the
   * precompiled key Set for O(1) membership tests.
   * For 'exists', returns true if any listed key exists. For '!exists',
   * returns true only if none of the listed keys exist.
   */
  private _matchKeyList(obj: Record<string, unknown>): boolean {
    const keySet = this._keySet!;

    // For '!exists', ALL obj keys in our key set must have null/undefined values
    if (this.op === '!exists') {
      for (const k of Object.keys(obj)) {
        if (keySet.has(k)) {
          const v = obj[k];
          if (v !== undefined && v !== null) return false;
        }
      }
      return true;
    }

    // For all other ops, find the first obj key in our key set that passes
    for (const k of Object.keys(obj)) {
      if (!keySet.has(k)) continue;
      const actualValue = obj[k];
      if (this.op === 'exists') {
        if (actualValue !== undefined && actualValue !== null && (this._allowNo || actualValue !== 'no')) return true;
      } else {
        if (this._checkValueOp(actualValue)) return true;
      }
    }
    return false;
  }


  /**
   * Create a PropMatcher from various input formats.
   *
   * @param input - PropMatcherProps, or shorthand formats
   * @return A new PropMatcher instance
   */
  static from(input: PropMatcherProps | string): PropMatcher {
    if (typeof input === 'string') {
      // Parse simple "key=value" format
      const eqIndex = input.indexOf('=');
      if (eqIndex > 0) {
        return new PropMatcher({
          key: input.slice(0, eqIndex),
          value: input.slice(eqIndex + 1)
        });
      }
      // Just a key (existence check)
      return new PropMatcher({ key: input });
    }

    return new PropMatcher(input);
  }


  /**
   * Test if ALL matchers in an array match the given object.
   * This implements AND logic for multiple conditions.
   *
   * @param matchers - Array of PropMatchers
   * @param obj - Object to test
   * @return `true` if all matchers match
   */
  static matchAll(matchers: PropMatcher[], obj: Record<string, unknown>): boolean {
    return matchers.every(m => m.matches(obj));
  }


  /**
   * Test if ANY matcher in an array matches the given object.
   * This implements OR logic for multiple conditions.
   *
   * @param matchers - Array of PropMatchers
   * @param obj - Object to test
   * @return `true` if any matcher matches
   */
  static matchAny(matchers: PropMatcher[], obj: Record<string, unknown>): boolean {
    return matchers.some(m => m.matches(obj));
  }


  /**
   * Whether this matcher has an unresolved `var()` reference.
   * @return `true` if the value contains a `var(...)` reference that hasn't been resolved
   */
  get hasVarRef(): boolean {
    return this._varRef !== null;
  }


  /**
   * Resolve any `var()` reference in this matcher's value against the given variables Map.
   * If the value is not a var() reference, this is a no-op.
   *
   * After resolution, `_valueSet` is compiled from the resolved array values.
   *
   * @param variables - Map of VariableID to Variable instances
   */
  resolveVariables(variables: Map<VariableID, Variable>): void {
    if (!this._varRef) return;

    const resolved = resolveVarRef(this._varRef, variables);
    if (resolved === undefined) return;  // unresolved — leave as-is

    // Store resolved value separately — raw props.value is never mutated
    if (Array.isArray(resolved)) {
      const strValues = resolved.map(String);
      this._resolvedValue = strValues;
      this._valueSet = new Set(strValues);
    } else {
      this._resolvedValue = String(resolved);
      this._valueSet = new Set([String(resolved)]);
    }
  }


  /**
   * Reset compiled caches so this matcher can be re-resolved.
   * Called when variables change (e.g. on schema reload).
   * Only affects matchers that have var() references.
   */
  reset(): void {
    if (!this._varRef) return;
    this._resolvedValue = null;
    this._valueSet = null;
    // _varRef is preserved — it holds the raw reference for re-resolution
  }


  /**
   * Convert to a JSON-serializable object.
   */
  toJSON(): PropMatcherProps {
    const result: PropMatcherProps = { key: this.key };

    // Only include keyOp if it's not the inferred default
    const defaultKeyOp = Array.isArray(this.key) ? 'in' : '=';
    if (this.keyOp !== defaultKeyOp) {
      result.keyOp = this.keyOp;
    }

    // Only include op if it's not the default
    const defaultOp = this.props.value !== undefined ? '=' : 'exists';
    if (this.op !== defaultOp) {
      result.op = this.op;
    }

    // Include allowNo only when it's true (non-default)
    if (this._allowNo) {
      result.allowNo = true;
    }

    // Include value if present (convert RegExp to string, preserve var() refs)
    if (this._varRef) {
      result.value = this._varRef;
    } else if (this.props.value !== undefined) {
      if (this.props.value instanceof RegExp) {
        result.value = this.props.value.source;
      } else {
        result.value = this.props.value;
      }
    }

    return result;
  }


  /**
   * String representation for debugging.
   */
  toString(): string {
    const value = this.value;
    let keyStr: string;
    if (this.keyOp === '~') {
      keyStr = `/${this.key}/`;
    } else if (Array.isArray(this.key)) {
      keyStr = `(${this.key.join(', ')})`;
    } else {
      keyStr = this.key;
    }

    if (this.op === 'exists') {
      return `[${keyStr}]`;
    }
    if (this.op === '!exists') {
      return `[!${keyStr}]`;
    }
    if (value instanceof RegExp) {
      return `[${keyStr}${this.op}/${value.source}/]`;
    }
    if (Array.isArray(value)) {
      return `[${keyStr} ${this.op} (${value.join(', ')})]`;
    }
    return `[${keyStr}${this.op}${value}]`;
  }
}
