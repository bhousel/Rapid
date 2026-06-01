import { PropMatcher } from './PropMatcher.ts';

import type { Context } from '../Context.ts';
import type { PropMatcherProps } from './PropMatcher.ts';
import type { Variable } from './Variable.ts';


/**
 * A `StyleSelector` describes *when to apply a style*.
 * It contains matching conditions, references one or more `styleIDs`,
 * and an optional 'weight' property to control the order in which they apply.
 *
 * @example
 * // Match highway=motorway
 * const hwMotorway = new StyleSelector(context, {
 *   id: 'highway-motorway',
 *   styleIDs: ['motorway'],
 *   match: {
 *     tags: [{ key: 'highway', value: 'motorway' }]
 *   }
 * });
 *
 * // Compose multiple styles: base color + pattern overlay
 * const cemetery = new StyleSelector(context, {
 *   id: 'landuse-cemetery',
 *   styleIDs: ['lightgreen', 'pattern-cemetery'],
 *   match: {
 *     tags: [{ key: 'landuse', value: 'cemetery' }]
 *   }
 * });
 *
 * @module
 */


/**
 * Match conditions for a StyleSelector.
 */
export interface StyleMatchConditions {
  /** Geometry type(s) to match. Use '*' or omit to match all geometries. */
  geometry?: GeometryType | GeometryType[] | '*';
  /** Tag conditions to match (AND logic - all must match). */
  tags?: PropMatcherProps[];
}

/**
 * Properties for creating a StyleSelector.
 */
export interface StyleSelectorProps {
  /** Unique identifier for this selector */
  id: StyleSelectorID;
  /** The asset this selector came from */
  assetID?: AssetID;
  /** Version of the asset */
  assetVersion?: string;
  /** The scope that this StyleSelector applies to (e.g. 'osm') */
  scopeID?: ScopeID;
  /** IDs of Styles to apply when this selector matches (merged in order) */
  styleIDs: StyleID[];
  /** Conditions that must be met for this selector to match */
  match: StyleMatchConditions;
  /** Weight (default 1) - when applying styles, the selector with weight overrides those with lower weight. */
  weight?: number;
}

/**
 * Information about a feature to match against selectors.
 */
export interface FeatureMatchInfo {
  /** The geometry type of the feature */
  geometry?: GeometryType;
  /** The tags/properties of the feature */
  tags?: Record<string, unknown>;
}


/**
 * A `StyleSelector` describes *when to apply a style*.
 * It contains matching conditions, references one or more `styleIDs`,
 * and an optional 'weight' property to control the order in which they apply.
 *
 * Properties you can access:
 *   `id`        Unique identifier for this selector
 *   `styleIDs`  IDs of Styles to apply (merged in order)
 *   `weight`    The weight of this selector (higher weights override lower weights)
 *   `props`     The full props object
 */
export class StyleSelector {
  public context: Context;
  public props: StyleSelectorProps;

  /** Unique identifier */
  public readonly id: StyleSelectorID;
  /** IDs of Styles to apply (merged in order, later styles override earlier) */
  public readonly styleIDs: StyleID[];
  /** Cached PropMatcher instances */
  protected _tagMatchers: PropMatcher[] | null = null;


  /**
   * @constructor
   * @param props - Properties defining the selector
   * @throws Error if `id` property is missing
   * @throws Error if `styleIDs` property is missing or empty
   */
  public constructor(context: Context, props: Partial<StyleSelectorProps> = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('StyleSelector: Missing id property');
    }
    if (!props.styleIDs || props.styleIDs.length === 0) {
      throw new Error('StyleSelector: styleIDs is required and must not be empty');
    }

    // Deep clone to avoid mutations
    this.props = structuredClone(props) as StyleSelectorProps;
    this.id = props.id;
    this.styleIDs = props.styleIDs;
  }


  /**
   * Reset compiled caches so this selector can be re-resolved.
   * Called when variables change (e.g. on style reload).
   */
  public reset(): void {
    for (const matcher of this.tagMatchers) {
      matcher.reset();
    }
  }


  /**
   * Get the match conditions.
   */
  public get match(): StyleMatchConditions {
    return this.props.match;
  }

  /**
   * Return the "weight" of this selector.
   * Higher weight selectors are applied later and override lower weight selectors.
   * @return weight score
   */
  public get weight(): number {
    return this.props.weight ?? 1;
  }

  /**
   * Get the tag matchers, lazily creating PropMatcher instances.
   */
  public get tagMatchers(): PropMatcher[] {
    if (this._tagMatchers === null) {
      this._tagMatchers = (this.props.match.tags ?? []).map(m => new PropMatcher(m));
    }
    return this._tagMatchers;
  }


  /**
   * Test if this selector matches a feature.
   *
   * @param feature - Feature information to test
   * @return `true` if the selector matches the feature
   */
  public matches(feature: FeatureMatchInfo): boolean {
    const { match } = this.props;

    // Check geometry condition
    if (match.geometry !== undefined && match.geometry !== '*') {
      const geometries = Array.isArray(match.geometry) ? match.geometry : [match.geometry];
      if (feature.geometry === undefined || !geometries.includes(feature.geometry)) {
        return false;
      }
    }

    // Check tag conditions (AND logic)
    if (this.tagMatchers.length > 0) {
      const tags = feature.tags ?? {};
      if (!PropMatcher.matchAll(this.tagMatchers, tags)) {
        return false;
      }
    }

    return true;
  }


  /**
   * Resolve any `var()` references in this selector's tag matchers.
   * Delegates to each PropMatcher's `resolveVariables()`.
   * @param variables - Map of VariableID to Variable instances
   */
  public resolveVariables(variables: Map<VariableID, Variable>): void {
    for (const matcher of this.tagMatchers) {
      matcher.resolveVariables(variables);
    }
  }


  /**
   * Compare this selector to another for sorting.
   * Sorts the selectors by weight ascending.
   * @param other - Another StyleSelector
   * @return Negative if this weight is less, positive if greater, zero if equal
   */
  public compare(other: StyleSelector): number {
    return this.weight - other.weight;
  }


  /**
   * Create a copy of this selector with a different ID.
   *
   * @param newID - The new ID for the copy
   * @return A new StyleSelector with the new ID
   */
  public clone(newID?: StyleSelectorID): StyleSelector {
    const cloned = structuredClone(this.props);
    if (newID) {
      cloned.id = newID;
    }
    return new StyleSelector(this.context, cloned);
  }


  /**
   * Convert to a JSON-serializable object.
   */
  public toJSON(): StyleSelectorProps {
    return structuredClone(this.props);
  }


  /**
   * Find all matching selectors from a list, sorted by weight.
   *
   * @param selectors - Array or iterable of StyleSelectors
   * @param feature - Feature to match
   * @return Array of matching selectors, sorted by weight ascending (lowest first, highest last)
   */
  public static findAll(selectors: Iterable<StyleSelector>, feature: FeatureMatchInfo): StyleSelector[] {
    const matches: StyleSelector[] = [];

    for (const selector of selectors) {
      if (selector.matches(feature)) {
        matches.push(selector);
      }
    }

    // Sort by weight ascending
    matches.sort((a, b) => a.compare(b));

    return matches;
  }
}
