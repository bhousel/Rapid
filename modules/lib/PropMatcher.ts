/**
 * PropMatcher - A declarative property matcher for comparing object properties.
 *
 * Used for matching OSM tags and other key-value properties against conditions.
 * Supports various comparison operators: equals, not equals, exists, regex, numeric comparisons, etc.
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
 * // Match with regex
 * const trunkOrPrimary = new PropMatcher({ key: 'highway', op: '~', value: '^(trunk|primary)$' });
 * trunkOrPrimary.matches({ highway: 'trunk' });  // true
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
 * Properties for creating a PropMatcher.
 */
export interface PropMatcherProps {
  /** The property key to match against */
  key: string;
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
}


/**
 * PropMatcher - Declarative property matching for OSM tags and other key-value data.
 *
 * Properties you can access:
 *   `key`   The property key to match
 *   `op`    The comparison operator
 *   `value` The value to compare against (if applicable)
 *   `props` The full props object
 */
export class PropMatcher {
  props: PropMatcherProps;

  /** The property key to match */
  readonly key: string;
  /** The comparison operator */
  readonly op: PropMatcherOp;
  /** Cached RegExp for regex operations */
  private _regex: RegExp | null = null;

  /**
   * @constructor
   * @param props - Properties defining the match condition
   * @throws Error if `key` property is missing
   * @throws Error if regex pattern is invalid (for `~` or `!~` operators)
   */
  constructor(props: PropMatcherProps) {
    if (!props.key) {
      throw new Error('PropMatcher: key is required');
    }

    this.props = { ...props };
    this.key = props.key;

    // Determine default operator based on whether value is provided
    if (props.op !== undefined) {
      this.op = props.op;
    } else if (props.value !== undefined) {
      this.op = '=';
    } else {
      this.op = 'exists';
    }

    // Pre-compile regex if needed
    if ((this.op === '~' || this.op === '!~') && props.value !== undefined) {
      if (props.value instanceof RegExp) {
        this._regex = props.value;
      } else if (typeof props.value === 'string') {
        try {
          this._regex = new RegExp(props.value, 'i');  // Case-insensitive by default
        } catch (e) {
          throw new Error(`PropMatcher: invalid regex pattern '${props.value}'`);
        }
      }
    }
  }


  /**
   * The value to compare against.
   */
  get value(): string | number | string[] | RegExp | undefined {
    return this.props.value;
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

    const hasKey = Object.prototype.hasOwnProperty.call(obj, this.key);
    const actualValue = obj[this.key];

    switch (this.op) {
      case 'exists':
        return hasKey && actualValue !== undefined && actualValue !== null;

      case '!exists':
        return !hasKey || actualValue === undefined || actualValue === null;

      case '=':
        return this._matchEquals(actualValue);

      case '!=':
        return !this._matchEquals(actualValue);

      case '~':
        return this._matchRegex(actualValue);

      case '!~':
        return !this._matchRegex(actualValue);

      case 'in':
        return this._matchIn(actualValue);

      case '!in':
        return !this._matchIn(actualValue);

      case '>':
        return this._compareNumeric(actualValue, (a, b) => a > b);

      case '>=':
        return this._compareNumeric(actualValue, (a, b) => a >= b);

      case '<':
        return this._compareNumeric(actualValue, (a, b) => a < b);

      case '<=':
        return this._compareNumeric(actualValue, (a, b) => a <= b);

      default:
        return false;
    }
  }


  /**
   * Test equality match.
   */
  private _matchEquals(actualValue: unknown): boolean {
    const expected = this.props.value;

    // Handle wildcard '*' - matches any truthy value
    if (expected === '*') {
      return actualValue !== undefined && actualValue !== null && actualValue !== '';
    }

    // Type coercion for comparison (OSM tags are strings)
    if (typeof actualValue === 'string' && typeof expected === 'number') {
      return actualValue === String(expected);
    }
    if (typeof actualValue === 'number' && typeof expected === 'string') {
      return String(actualValue) === expected;
    }

    return actualValue === expected;
  }


  /**
   * Test regex match.
   */
  private _matchRegex(actualValue: unknown): boolean {
    if (!this._regex) return false;
    if (actualValue === undefined || actualValue === null) return false;

    const str = String(actualValue);
    return this._regex.test(str);
  }


  /**
   * Test if value is in an array.
   */
  private _matchIn(actualValue: unknown): boolean {
    const expected = this.props.value;
    if (!Array.isArray(expected)) return false;
    if (actualValue === undefined || actualValue === null) return false;

    const str = String(actualValue);
    return expected.includes(str);
  }


  /**
   * Perform numeric comparison.
   */
  private _compareNumeric(actualValue: unknown, compareFn: (a: number, b: number) => boolean): boolean {
    const expected = this.props.value;
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
   * Convert to a JSON-serializable object.
   */
  toJSON(): PropMatcherProps {
    const result: PropMatcherProps = { key: this.key };

    // Only include op if it's not the default
    const defaultOp = this.props.value !== undefined ? '=' : 'exists';
    if (this.op !== defaultOp) {
      result.op = this.op;
    }

    // Include value if present (convert RegExp to string)
    if (this.props.value !== undefined) {
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
    const value = this.props.value;
    if (this.op === 'exists') {
      return `[${this.key}]`;
    }
    if (this.op === '!exists') {
      return `[!${this.key}]`;
    }
    if (value instanceof RegExp) {
      return `[${this.key}${this.op}/${value.source}/]`;
    }
    if (Array.isArray(value)) {
      return `[${this.key} ${this.op} (${value.join(', ')})]`;
    }
    return `[${this.key}${this.op}${value}]`;
  }
}
