import { PropMatcher } from './PropMatcher.ts';

import type { PropMatcherProps } from './PropMatcher.ts';
import type { Context } from '../Context.ts';

/**
 * Ruleset - A collection of PropMatcher rules for classifying properties.
 *
 * A Ruleset groups related PropMatcher rules under a single identifier.
 * It's used by SchemaSystem to scope tag classification data (e.g. which
 * surfaces are "paved", which highways are "routable") per schema scope,
 * replacing module-level globals with scope-owned configuration.
 *
 * @example
 * // Define a ruleset for paved surfaces
 * const paved = new Ruleset({
 *   id: 'paved',
 *   rules: [
 *     { key: 'surface', value: 'paved' },
 *     { key: 'surface', value: 'asphalt' },
 *     { key: 'surface', value: 'concrete' },
 *   ]
 * });
 * paved.matchAny({ surface: 'asphalt' });  // true
 * paved.matchAny({ surface: 'gravel' });   // false
 *
 * // Define a ruleset for routable highways
 * const routable = new Ruleset({
 *   id: 'routable_highway',
 *   rules: [
 *     { key: 'highway', value: 'motorway' },
 *     { key: 'highway', value: 'trunk' },
 *     { key: 'highway', value: 'primary' },
 *     { key: 'highway', value: 'secondary' },
 *   ]
 * });
 * routable.matchKV('highway', 'trunk');       // true
 * routable.firstMatchKey({ highway: 'trunk', name: 'Main St' });  // 'highway'
 *
 * @module
 */


/**
 * Properties for creating a Ruleset.
 */
export interface RulesetProps {
  /** Unique identifier for this ruleset */
  id: RulesetID;
  /** The asset this ruleset came from */
  assetID?: AssetID;
  /** The scope that this Ruleset applies to (e.g. 'osm') */
  scopeID?: ScopeID;
  /** Array of matcher rules — any match means the property set belongs to this ruleset */
  rules: PropMatcherProps[];
}


/**
 * Ruleset - A named collection of PropMatcher rules with OR semantics.
 *
 * Properties you can access:
 *   `id`       Unique identifier for this ruleset
 *   `props`    The full props object
 *   `rules`    The compiled PropMatcher instances
 */
export class Ruleset {
  context: Context;
  props: RulesetProps;

  /** Unique identifier */
  readonly id: RulesetID;

  /** Compiled matchers from the rules */
  readonly rules: PropMatcher[];


  /**
   * @constructor
   * @param context - Global shared application context
   * @param props - Properties defining the ruleset
   * @throws Error if `id` property is missing
   */
  constructor(context: Context, props: Partial<RulesetProps> = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('Ruleset: Missing id property');
    }

    // Deep clone to avoid mutations
    this.props = globalThis.structuredClone(props) as RulesetProps;
    this.props.rules ??= [];
    this.id = props.id;

    // Compile PropMatcherProps into PropMatcher instances
    this.rules = this.props.rules.map(r => new PropMatcher(r));
  }


  /** The asset ID this Ruleset came from. */
  get assetID(): AssetID | undefined {
    return this.props.assetID;
  }

  /** The scope ID this Ruleset applies to. */
  get scopeID(): ScopeID | undefined {
    return this.props.scopeID;
  }


  /**
   * Test if ANY rule matches the given properties object.
   * Implements OR logic across all rules.
   *
   * @param obj - Object with properties to test
   * @return `true` if any rule matches
   */
  matchAny(obj: Record<string, unknown>): boolean {
    return this.rules.some(r => r.matches(obj));
  }


  /**
   * Test if a specific key-value pair matches any rule.
   * Constructs a single-property object and tests against all rules.
   * Useful when you have a key and value but not a full tag object.
   *
   * @param key - The property key
   * @param value - The property value
   * @return `true` if any rule matches the key-value pair
   */
  matchKV(key: string, value: unknown): boolean {
    return this.matchAny({ [key]: value });
  }


  /**
   * Find the first key from the given object that matches any rule.
   * Iterates the object's own properties and returns the first key
   * where the full object matches a rule involving that key.
   *
   * This is useful for determining which tag "triggered" the match.
   *
   * @param obj - Object with properties to test
   * @return The first matching key, or `undefined` if no match
   */
  firstMatchKey(obj: Record<string, unknown>): string | undefined {
    if (!obj || typeof obj !== 'object') return undefined;

    for (const key of Object.keys(obj)) {
      // Check if any rule's key matches this property key AND the rule matches the object
      for (const rule of this.rules) {
        if (rule.key === key && rule.matches(obj)) {
          return key;
        }
      }
    }
    return undefined;
  }


  /**
   * Get all keys from the rules in this ruleset.
   * Useful for building lookup indexes.
   *
   * @return Set of all unique keys referenced by rules
   */
  ruleKeys(): Set<string> {
    return new Set(this.rules.map(r => r.key));
  }


  /**
   * Returns a new Ruleset that is a merge of this and another.
   * Rules from `other` are appended to this ruleset's rules.
   * Properties from `other` (except rules) override this.
   *
   * @param other - Another Ruleset to merge with
   * @return A new merged Ruleset
   */
  merge(other: Ruleset): Ruleset {
    const mergedRules = [...this.props.rules, ...other.props.rules];
    return new Ruleset(this.context, {
      ...this.props,
      ...other.props,
      id: this.id,  // Keep original ID
      rules: mergedRules,
    });
  }


  /**
   * Create a copy of this ruleset with an optional new ID.
   *
   * @param newID - Optional new ID for the copy
   * @return A new Ruleset with copied properties
   */
  clone(newID?: RulesetID): Ruleset {
    const cloned = globalThis.structuredClone(this.props);
    if (newID) {
      cloned.id = newID;
    }
    return new Ruleset(this.context, cloned);
  }


  /**
   * Convert to a JSON-serializable object.
   */
  toJSON(): RulesetProps {
    return {
      ...this.props,
      rules: this.rules.map(r => r.toJSON()),
    };
  }


  /**
   * String representation for debugging.
   */
  toString(): string {
    return `Ruleset(${this.id}, ${this.rules.length} rules)`;
  }
}
