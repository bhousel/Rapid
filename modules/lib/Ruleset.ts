import { PropMatcher } from './PropMatcher.ts';

import type { Context } from '../Context.ts';
import type { PropMatcherProps } from './PropMatcher.ts';
import type { Variable } from './Variable.ts';

/**
 * A `Ruleset` is a group of related `PropMatcher` rules with include/exclude semantics.
 * It's used by `SchemaSystem` to scope tag classification data (e.g. which
 * surfaces are "paved", which highways are "routable") per schema scope,
 * replacing module-level globals with scope-owned configuration.
 *
 * Rules are split into `include` (positive matches) and `exclude` (vetoes):
 * - A feature matches the ruleset if ANY `include` rule matches
 *   AND NO `exclude` rule matches.
 * - This mirrors the include/exclude pattern from location-conflation's locationSets.
 *
 * @example
 * // Define a ruleset for sided features with a veto condition
 * const sided = new Ruleset(context, {
 *   id: 'sided_right',
 *   include: [
 *     { key: 'natural', op: 'in', value: ['cliff', 'coastline'] },
 *     { key: 'barrier', op: 'in', value: ['retaining_wall', 'kerb'] },
 *   ],
 *   exclude: [
 *     { key: 'two_sided', value: 'yes' }
 *   ]
 * });
 * sided.match({ natural: 'cliff' });                    // true
 * sided.match({ natural: 'cliff', two_sided: 'yes' });  // false (vetoed)
 *
 * // Define a simple ruleset (include only)
 * const paved = new Ruleset(context, {
 *   id: 'surface_paved',
 *   include: [
 *     { key: 'surface', value: 'asphalt' },
 *     { key: 'surface', value: 'concrete' },
 *   ]
 * });
 * paved.match({ surface: 'asphalt' });  // true
 * paved.match({ surface: 'gravel' });   // false
 *
 * @module
 */


/**
 * Properties for creating a `Ruleset`.
 */
export interface RulesetProps {
  /** Unique identifier for this ruleset */
  id: RulesetID;
  /** The asset this ruleset came from */
  assetID?: AssetID;
  /** The scope that this Ruleset applies to (e.g. 'osm') */
  scopeID?: ScopeID;
  /** Positive match rules — any match means the property set belongs to this ruleset */
  include: PropMatcherProps[];
  /** Negative match rules — any match vetoes the classification (even if include matched) */
  exclude?: PropMatcherProps[];
}


/**
 * A `Ruleset` is a group of related `PropMatcher` rules with include/exclude semantics.
 * Matching logic: ANY 'include' matches AND NO 'exclude' matches.
 *
 * Properties you can access:
 *   `id`        Unique identifier for this ruleset
 *   `props`     The full props object
 *   `include`   The compiled include PropMatcher instances
 *   `exclude`   The compiled exclude PropMatcher instances
 *
 * Methods:
 *   `match(obj)` Test if the property set belongs to this ruleset
 */
export class Ruleset {

  public context: Context;
  public props: RulesetProps;

  /** Unique identifier */
  public readonly id: RulesetID;

  /** Compiled include matchers */
  public readonly include: PropMatcher[];

  /** Compiled exclude matchers */
  public readonly exclude: PropMatcher[];


  /**
   * @constructor
   * @param context - Global shared application context
   * @param props - Properties defining the ruleset
   * @throws Error if `id` property is missing
   */
  public constructor(context: Context, props: Partial<RulesetProps> = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('Ruleset: Missing id property');
    }

    // Deep clone to avoid mutations
    this.props = structuredClone(props) as RulesetProps;
    this.props.include ??= [];
    this.props.exclude ??= [];
    this.id = props.id;

    // Compile PropMatcherProps into PropMatcher instances
    this.include = this.props.include.map(r => new PropMatcher(r));
    this.exclude = this.props.exclude.map(r => new PropMatcher(r));
  }


  /**
   * Test if ANY include rule matches AND NO exclude rule matches.
   *
   * @param obj - Object with properties to test
   * @return `true` if any include matches and no exclude matches
   */
  public match(obj: Record<string, unknown>): boolean {
    if (this.exclude.some(r => r.matches(obj))) return false;
    if (!this.include.some(r => r.matches(obj))) return false;
    return true;
  }


  /**
   * Returns a new Ruleset that is a merge of this and another.
   * Include rules from `other` are appended to this ruleset's include rules.
   * Exclude rules from `other` are appended to this ruleset's exclude rules.
   * Properties from `other` (except include/exclude) override this.
   *
   * @param other - Another Ruleset to merge with
   * @return A new merged Ruleset
   */
  public merge(other: Ruleset): Ruleset {
    const mergedInclude = [...this.props.include, ...other.props.include];
    const mergedExclude = [...(this.props.exclude ?? []), ...(other.props.exclude ?? [])];
    return new Ruleset(this.context, {
      ...this.props,
      ...other.props,
      id: this.id,  // Keep original ID
      include: mergedInclude,
      exclude: mergedExclude,
    });
  }


  /**
   * Create a copy of this ruleset with an optional new ID.
   *
   * @param newID - Optional new ID for the copy
   * @return A new Ruleset with copied properties
   */
  public clone(newID?: RulesetID): Ruleset {
    const cloned = structuredClone(this.props);
    if (newID) {
      cloned.id = newID;
    }
    return new Ruleset(this.context, cloned);
  }


  /**
   * Resolve any `var()` references in this ruleset's include/exclude matchers.
   * Delegates to each PropMatcher's `resolveVariables()`.
   *
   * @param variables - Map of VariableID to Variable instances
   */
  public resolveVariables(variables: Map<VariableID, Variable>): void {
    for (const matcher of this.include) {
      matcher.resolveVariables(variables);
    }
    for (const matcher of this.exclude) {
      matcher.resolveVariables(variables);
    }
  }


  /**
   * Reset compiled caches on all matchers with var() references.
   * Called when variables change (e.g. on schema reload) so they can be re-resolved.
   */
  public reset(): void {
    for (const matcher of this.include) {
      matcher.reset();
    }
    for (const matcher of this.exclude) {
      matcher.reset();
    }
  }


  /**
   * Convert to a JSON-serializable object.
   */
  public toJSON(): RulesetProps {
    const { exclude: _exclude, ...rest } = this.props;
    const result: RulesetProps = {
      ...rest,
      include: this.include.map(r => r.toJSON()),
    };
    if (this.exclude.length) {
      result.exclude = this.exclude.map(r => r.toJSON());
    }
    return result;
  }


  /**
   * String representation for debugging.
   */
  public toString(): string {
    const parts = [`${this.include.length} include`];
    if (this.exclude.length) {
      parts.push(`${this.exclude.length} exclude`);
    }
    return `Ruleset(${this.id}, ${parts.join(', ')})`;
  }
}
