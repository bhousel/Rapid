import { PropMatcher } from './PropMatcher.ts';

import type { Context } from '../Context.ts';
import type { PropMatcherProps } from './PropMatcher.ts';

/**
 * StyleSelector - Matching conditions for applying styles to features.
 *
 * A StyleSelector describes *when to apply a style*. It contains matching
 * conditions (geometry, tags) and references one or more Styles.
 *
 * All matching selectors are applied in specificity order (more conditions = higher specificity).
 * Selectors with the same specificity are applied in the order they were added.
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


/** Geometry types supported by the style system */
export type StyleGeometry = 'point' | 'vertex' | 'line' | 'area' | 'relation';


/**
 * Match conditions for a StyleSelector.
 */
export interface StyleMatchConditions {
  /** Geometry type(s) to match. Use '*' or omit to match all geometries. */
  geometry?: StyleGeometry | StyleGeometry[] | '*';
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
}

/**
 * Information about a feature to match against selectors.
 */
export interface FeatureMatchInfo {
  /** The geometry type of the feature */
  geometry?: StyleGeometry;
  /** The tags/properties of the feature */
  tags?: Record<string, unknown>;
}


/**
 * StyleSelector - Determines when a style should be applied.
 *
 * Properties you can access:
 *   `id`             Unique identifier for this selector
 *   `styleIDs`       IDs of Styles to apply (merged in order)
 *   `props`          The full props object
 */
export class StyleSelector {
  context: Context;
  props: StyleSelectorProps;

  /** Unique identifier */
  readonly id: StyleSelectorID;
  /** IDs of Styles to apply (merged in order, later styles override earlier) */
  readonly styleIDs: StyleID[];
  /** Cached PropMatcher instances */
  private _tagMatchers: PropMatcher[] | null = null;


  /**
   * @constructor
   * @param props - Properties defining the selector
   * @throws Error if `id` property is missing
   * @throws Error if `styleIDs` property is missing or empty
   */
  constructor(context: Context, props: Partial<StyleSelectorProps> = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('StyleSelector: Missing id property');
    }
    if (!props.styleIDs || props.styleIDs.length === 0) {
      throw new Error('StyleSelector: styleIDs is required and must not be empty');
    }

    // Deep clone to avoid mutations
    this.props = globalThis.structuredClone(props) as StyleSelectorProps;
    this.id = props.id;
    this.styleIDs = props.styleIDs;
  }


  /**
   * Get the match conditions.
   */
  get match(): StyleMatchConditions {
    return this.props.match;
  }


  /**
   * The asset ID this selector came from.
   */
  get assetID(): AssetID | undefined {
    return this.props.assetID;
  }


  /**
   * Get the tag matchers, lazily creating PropMatcher instances.
   */
  get tagMatchers(): PropMatcher[] {
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
  matches(feature: FeatureMatchInfo): boolean {
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
   * Calculate a specificity score for this selector.
   * More specific selectors (more conditions) get higher scores.
   * Higher specificity selectors are applied later and win.
   *
   * @return Specificity score
   */
  specificity(): number {
    let score = 0;
    const { match } = this.props;

    // Geometry specificity
    if (match.geometry !== undefined && match.geometry !== '*') {
      score += 50;
    }

    // Tag specificity (more matchers = more specific)
    score += this.tagMatchers.length * 10;

    return score;
  }


  /**
   * Compare this selector to another for sorting.
   * Returns negative if this should come before other (higher specificity wins).
   *
   * @param other - Another StyleSelector
   * @return Comparison result (-1, 0, or 1)
   */
  compare(other: StyleSelector): number {
    // Higher specificity wins
    return other.specificity() - this.specificity();
  }


  /**
   * Create a copy of this selector with a different ID.
   *
   * @param newID - The new ID for the copy
   * @return A new StyleSelector with the new ID
   */
  clone(newID?: StyleSelectorID): StyleSelector {
    const cloned = globalThis.structuredClone(this.props);
    if (newID) {
      cloned.id = newID;
    }
    return new StyleSelector(this.context, cloned);
  }


  /**
   * Convert to a JSON-serializable object.
   */
  toJSON(): StyleSelectorProps {
    return globalThis.structuredClone(this.props);
  }


  /**
   * String representation for debugging.
   */
  toString(): string {
    const parts: string[] = [];
    const { match } = this.props;

    if (match.geometry !== undefined && match.geometry !== '*') {
      const geom = Array.isArray(match.geometry) ? match.geometry.join('|') : match.geometry;
      parts.push(`geometry=${geom}`);
    }

    for (const matcher of this.tagMatchers) {
      parts.push(matcher.toString());
    }

    return `StyleSelector[${this.id}](${parts.join(', ')}) → [${this.styleIDs.join(', ')}]`;
  }


  /**
   * Find the best matching selector from a list.
   *
   * @param selectors - Array or iterable of StyleSelectors
   * @param feature - Feature to match
   * @return The best matching selector, or undefined if none match
   */
  static findBest(selectors: Iterable<StyleSelector>, feature: FeatureMatchInfo): StyleSelector | undefined {
    let best: StyleSelector | undefined;

    for (const selector of selectors) {
      if (!selector.matches(feature)) continue;

      if (best === undefined || selector.compare(best) < 0) {
        best = selector;
      }
    }

    return best;
  }


  /**
   * Find all matching selectors from a list, sorted by specificity.
   *
   * @param selectors - Array or iterable of StyleSelectors
   * @param feature - Feature to match
   * @return Array of matching selectors, sorted by specificity (highest first)
   */
  static findAll(selectors: Iterable<StyleSelector>, feature: FeatureMatchInfo): StyleSelector[] {
    const matches: StyleSelector[] = [];

    for (const selector of selectors) {
      if (selector.matches(feature)) {
        matches.push(selector);
      }
    }

    // Sort by specificity (highest first)
    matches.sort((a, b) => a.compare(b));

    return matches;
  }
}
