import type { Context } from '../Context.ts';


/**
 * The allowed types for variable values.
 * Variables can hold scalars (string or number) or arrays of scalars.
 */
export type VariableValue = string | number | string[] | number[];


/**
 * Properties for creating a `Variable`.
 */
export interface VariableProps {
  /** Unique identifier for this variable */
  id: VariableID;
  /** The asset this variable came from */
  assetID?: AssetID;
  /** The scope that this Variable applies to (e.g. 'osm') */
  scopeID?: ScopeID;
  /** The variable's value — a scalar or an array of scalars */
  value: VariableValue;
}


/**
 * A `Variable` holds reusable data - typically lists of domain-specific strings
 * (e.g. lifecycle prefixes, highway classification values) that are referenced
 * by multiple consumers.  Unlike Rulesets (which are matchers with include/exclude
 * semantics), Variables are just named data — "sometimes a list is just a list."
 *
 * Variables can be referenced from PropMatcher rules using a `var()` syntax:
 * ```json5
 * { key: "highway", op: "in", value: "var(major_highway_values)" }
 * ```
 *
 * Multiple variable references are supported and produce a flat union:
 * ```json5
 * { key: "highway", op: "in", value: "var(major_highway_values, minor_highway_values)" }
 * ```
 *
 * For array values, Variable pre-compiles a `Set` for O(1) lookups.
 *
 * @example
 * const v = new Variable(context, {
 *   id: 'lifecycle_prefixes',
 *   value: ['abandoned', 'construction', 'demolished', 'disused', 'proposed']
 * });
 * v.value;    // ['abandoned', 'construction', 'demolished', 'disused', 'proposed']
 * v.asSet();  // Set(5) {'abandoned', 'construction', 'demolished', 'disused', 'proposed'}
 *
 * @module
 */
export class Variable {
  context: Context;
  props: VariableProps;

  /** Unique identifier */
  readonly id: VariableID;

  /** Cached Set for O(1) lookups (compiled from array values) */
  private _set: Set<string | number> | null;


  /**
   * @constructor
   * @param context - Global shared application context
   * @param props - Properties defining the variable
   * @throws Error if `id` property is missing
   * @throws Error if `value` property is missing
   */
  constructor(context: Context, props: Partial<VariableProps> = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('Variable: Missing id property');
    }
    if (props.value === undefined || props.value === null) {
      throw new Error('Variable: Missing value property');
    }

    // Deep clone to avoid mutations
    this.props = structuredClone(props) as VariableProps;
    this.id = props.id;
    this._set = null;
  }


  /**
   * The variable's value.
   */
  get value(): VariableValue {
    return this.props.value;
  }


  /**
   * Returns the value as a Set for O(1) membership testing.
   * For scalar values, returns a single-element Set.
   * The Set is cached after first creation.
   * @return Set of the variable's values
   */
  asSet(): Set<string | number> {
    if (this._set) return this._set;

    const val = this.props.value;
    if (Array.isArray(val)) {
      this._set = new Set<string | number>(val);
    } else {
      this._set = new Set<string | number>([val]);
    }
    return this._set;
  }


  /**
   * Returns the value as a flat array.
   * For scalar values, returns a single-element array.
   * @return Array of the variable's values
   */
  asArray(): string[] | number[] {
    const val = this.props.value;
    if (Array.isArray(val)) return val;
    return [val] as string[] | number[];
  }


  /**
   * Convert to a JSON-serializable object.
   */
  toJSON(): VariableProps {
    return structuredClone(this.props);
  }


  /**
   * String representation for debugging.
   */
  toString(): string {
    const val = this.props.value;
    if (Array.isArray(val)) {
      return `Variable(${this.id}, [${val.length} items])`;
    }
    return `Variable(${this.id}, ${val})`;
  }
}


// ============================================================================
// var() reference resolution
// ============================================================================

/**
 * VAR_PATTERN matches `var(name)` or `var(name1, name2, ...)` reference strings.
 * The content between parens is captured as group 1.
 */
const VAR_PATTERN = /^var\((.+)\)$/;


/**
 * Tests whether a string is a `var(...)` reference.
 * @param str - The string to test
 * @return `true` if the string is a var() reference
 */
export function isVarRef(str: string): boolean {
  return VAR_PATTERN.test(str);
}


/**
 * Resolves a `var(name1, name2, ...)` reference string against a variables Map.
 * Multiple names produce a flat union of all referenced arrays.
 *
 * @param ref - The `var(...)` reference string
 * @param variables - Map of VariableID to Variable
 * @return The resolved flat array of values, or `undefined` if any reference is unresolved
 *
 * @example
 * resolveVarRef('var(major_highway_values)', variables);
 * // → ['motorway', 'trunk', 'primary', ...]
 *
 * resolveVarRef('var(major_highway_values, minor_highway_values)', variables);
 * // → ['motorway', 'trunk', ..., 'service', 'track', ...]
 */
export function resolveVarRef(
  ref: string,
  variables: Map<VariableID, Variable>
): VariableValue | undefined {
  const match = VAR_PATTERN.exec(ref);
  if (!match) return undefined;

  const names = match[1].split(',').map(s => s.trim()).filter(Boolean);
  if (names.length === 0) return undefined;

  // Single reference — return the value directly (preserves scalar vs array)
  if (names.length === 1) {
    const variable = variables.get(names[0]);
    return variable?.value;
  }

  // Multiple references — flatten all into a single array
  const result: (string | number)[] = [];
  for (const name of names) {
    const variable = variables.get(name);
    if (!variable) return undefined;  // unresolved reference

    const val = variable.value;
    if (Array.isArray(val)) {
      result.push(...val);
    } else {
      result.push(val);
    }
  }

  // Return typed array — if all numbers, return number[]; otherwise string[]
  if (result.every(v => typeof v === 'number')) {
    return result as number[];
  }
  return result.map(String);
}
