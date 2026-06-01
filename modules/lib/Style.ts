import { merge as deepMerge } from 'lodash-es';
import { isVarRef, resolveVarRef } from './Variable.ts';

import type { Vec2 } from '@rapid-sdk/math';
import type { Context } from '../Context.ts';
import type { Variable } from './Variable.ts';

/**
 * A `Style` describes *what a feature should look like*.
 * It contains visual properties for:
 * - fill (areas)
 * - casing (line outline, draws below stroke)
 * - stroke (line)
 * - markers (point markers)
 * - icons (rendered inside markers)
 * - line decorations (oneway arrows, sided markers)
 * - labels
 *
 * The Icon image typically comes from `SchemaSystem` presets, but can be overridden
 * in a style file. Other visual properties (color, size, opacity) come from styles.
 *
 * @example
 * // A simple fill color
 * const green = new Style(context, {
 *   id: 'green',
 *   fill: { color: 0x8cd05f, opacity: 0.3 }
 * });
 *
 * // A road with casing and stroke
 * const motorway = new Style(context, {
 *   id: 'motorway',
 *   casing: { width: 10, color: 0x70372f },
 *   stroke: { width: 8, color: 0xcf2081 }
 * });
 *
 * // A point style with marker and icon properties
 * const poi = new Style(context, {
 *   id: 'poi_pin',
 *   marker: { image: 'pin', color: 0xffffff },
 *   icon: { color: 0x111111, size: 11 },
 *   label: { color: 0xdddddd }
 * });
 *
 * @module
 */


/**
 * Properties for creating a `Style`.
 * All properties (except the id) are optional.
 * Any unassigned properties will be filled in with defaults.
 */
export interface StyleProps {
  /** Unique identifier for this style */
  id: StyleID;
  /** The asset this declaration came from */
  assetID?: AssetID;
  /** Version of the asset */
  assetVersion?: string;
  /** The scope that this Style applies to (e.g. 'osm') */
  scopeID?: ScopeID;

  /** Base properties (currently just a base color) */
  base?: BaseStyleProps;
  /** Properties for styling filled area */
  fill?: FillStyleProps;
  /** Properties for styling the casing (line outline, draws below stroke) */
  casing?: LineStyleProps;
  /** Properties for styling the stroke (line, draws above casing) */
  stroke?: LineStyleProps;
  /** Properties for styling the marker (point outer shape, for example a pin shape */
  marker?: PointStyleProps;
  /** Properties for styling the icon (point inner shape, draws within the marker) */
  icon?: PointStyleProps;
  /** Properties for styling Viewfields */
  viewfield?: ViewfieldStyleProps;
  /** Properties for repeating markers along lines (e.g. oneway arrows) */
  lineMarker?: PointStyleProps;
  /** Properties for one-sided markers (e.g. cliffs, retaining walls) */
  sidedMarker?: PointStyleProps;
  /** Properties for styling the label */
  label?: LabelStyleProps;
}

/** Line cap style */
export type LineCap = 'butt' | 'round' | 'square';
/** Line join style */
export type LineJoin = 'bevel' | 'miter' | 'round';
/** Fill style */
export type FillType = 'full' | 'partial';

/** Properties for base styling */
export interface BaseStyleProps {
  /** The color as a hex number, e.g. 0xcf2081 */
  color?: number;
  /** Opacity: 0 = transparent, 1 = opaque */
  opacity?: number;
}

/** Properties for fill styling (used for area features). */
export interface FillStyleProps {
  /** The color as a hex number, e.g. 0xcf2081 */
  color?: number;
  /** Opacity: 0 = transparent, 1 = opaque */
  opacity?: number;
  /** Line width in pixels (for the fill outline) */
  width?: number;
  /** Pattern ID for textured fills, e.g. 'grass', 'waves' */
  pattern?: string;
  /** Fill type - 'full' or 'partial' */
  type?: FillType;
}

/** Properties for line styling (used for casing and stroke). */
export interface LineStyleProps {
  /** The color as a hex number, e.g. 0xcf2081 */
  color?: number;
  /** Opacity: 0 = transparent, 1 = opaque */
  opacity?: number;
  /** Line width in pixels */
  width?: number;
  /** Line cap style */
  cap?: LineCap;
  /** Line join style */
  join?: LineJoin;
  /** Dash pattern as array of pixels on/off, e.g. [10, 5] */
  dash?: number[];
}

/**
 * Properties for point styling (markers, icons, line markers, sided markers).
 * Used for:
 * - `marker`: Background shape behind an icon
 * - `icon`: Symbol rendered inside a marker
 * - `lineMarker`: Repeating markers along lines (e.g. oneway arrows)
 * - `sidedMarker`: One-sided markers (e.g. cliffs, retaining walls)
 */
export interface PointStyleProps {
  /** Display color applied to the graphic */
  color?: number;
  /** Opacity: 0 = transparent, 1 = opaque */
  opacity?: number;
  /**
   * Image identifier - should be a symbol name from the spritesheet.
   * TODO: Support url(path/to/image.svg) syntax for external images.
   */
  image?: string;
  /** Size in pixels (defaults vary by usage, typically 11 for icons) */
  size?: number;
  /** Anchor position [x, y] where [0.5, 0.5] = centered (default varies by marker type) */
  anchor?: Vec2;
  /** Scale multiplier: uniform number or per-axis [x, y] */
  scale?: number | Vec2;
}

/**
 * Viewfields accept all the style properties that can be applied to a point,
 * with the addition of an `angles` array, to indicate the directions that the viewfields point.
 */
export interface ViewfieldStyleProps extends PointStyleProps {
  /** Angles (in degrees) that the viewfields should extend out from the point */
  angles?: number[];
}

/**
 * Style properties for Labels
 */
export interface LabelStyleProps {
  /** Display color applied to the graphic */
  color?: number;
  /** Opacity: 0 = transparent, 1 = opaque */
  opacity?: number;
  /** Size in pixels (defaults vary by usage) */
  size?: number;
}

/** Just the props needed to make a bare-bones style */
export type MinimalStyleProps = Required<Omit<StyleProps, 'id' | 'assetID' | 'assetVersion' | 'scopeID' | 'base'>>;

/** Some reasonable style default values */
export const styleDefaults: MinimalStyleProps = {
  fill:        { color: 0xaaaaaa, opacity: 0.3, width: 2 },
  casing:      { color: 0x444444, opacity: 1, width: 5, cap: 'round', join: 'round' },
  stroke:      { color: 0xcccccc, opacity: 1, width: 3, cap: 'round', join: 'round' },
  marker:      { color: 0xffffff, opacity: 1, image: 'smallCircle' },
  icon:        { color: 0x111111, opacity: 1, size: 11 },
  viewfield:   { color: 0xffffff, opacity: 0.7, image: 'viewfield', angles: [] },
  label:       { color: 0xeeeeee, opacity: 1 },
  lineMarker:  { color: 0x111111, opacity: 1 },
  sidedMarker: { color: 0xcccccc, opacity: 1 }
};


/**
 * A `Style` describes *what a feature should look like*.
 *
 * Properties you can access:
 *   `id`          Unique identifier for this style
 *   `props`       The full props object
 *   `fill`        Fill style properties (areas)
 *   `casing`      Casing style properties (line outline)
 *   `stroke`      Stroke style properties (line)
 *   `marker`      Marker style properties (point background)
 *   `icon`        Icon style properties (rendered in marker)
 */

/** Describes what a map feature should look like (fill, casing, stroke, markers, icons, labels). */
export class Style {

  /** Global shared application context */
  public context: Context;
  /** Full props object for this style */
  public props: StyleProps;

  /** Unique identifier */
  public readonly id: StyleID;

  /**
   * Resolved copy of props with var() references replaced by actual values.
   * `null` when no var() references have been resolved (or after reset).
   */
  protected _resolved: StyleProps | null;

  /** Whether this style's raw props contain any var() references. */
  protected _hasVarRefs: boolean;


  /**
   * @constructor
   * @param context
   * @param props - Properties defining the visual style
   * @throws Error if `id` property is missing
   */
  public constructor(context: Context, props: Partial<StyleProps> = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('Style: Missing id property');
    }

    // Deep clone to avoid mutations
    this.props = structuredClone(props) as StyleProps;
    this.id = props.id;
    this._resolved = null;
    this._hasVarRefs = false;
  }


  /**
   * Returns the resolved props (with var() references replaced), or the raw
   * props if no variables have been resolved.
   * @return  Resolved (or raw) `StyleProps`
   */
  public get resolved(): StyleProps {
    return this._resolved ?? this.props;
  }

  /** Fill style properties.
   * @return  Fill `FillStyleProps`, or `undefined` if not set
   */
  public get fill(): FillStyleProps | undefined {
    return this.resolved.fill;
  }
  /** Casing style properties.
   * @return  Casing `LineStyleProps`, or `undefined` if not set
   */
  public get casing(): LineStyleProps | undefined {
    return this.resolved.casing;
  }
  /** Stroke style properties.
   * @return  Stroke `LineStyleProps`, or `undefined` if not set
   */
  public get stroke(): LineStyleProps | undefined {
    return this.resolved.stroke;
  }
  /** Marker style properties (point background shape).
   * @return  Marker `PointStyleProps`, or `undefined` if not set
   */
  public get marker(): PointStyleProps | undefined {
    return this.resolved.marker;
  }
  /** Icon style properties (rendered inside marker).
   * @return  Icon `PointStyleProps`, or `undefined` if not set
   */
  public get icon(): PointStyleProps | undefined {
    return this.resolved.icon;
  }
  /** Viewfield style properties
   * @return  Viewfield `ViewfieldStyleProps`, or `undefined` if not set
   */
  public get viewfield(): ViewfieldStyleProps | undefined {
    return this.resolved.viewfield;
  }
  /** Line marker style properties (e.g. oneway arrows).
   * @return  Line marker `PointStyleProps`, or `undefined` if not set
   */
  public get lineMarker(): PointStyleProps | undefined {
    return this.resolved.lineMarker;
  }
  /** Sided marker style properties (e.g. cliffs, retaining walls).
   * @return  Sided marker `PointStyleProps`, or `undefined` if not set
   */
  public get sidedMarker(): PointStyleProps | undefined {
    return this.resolved.sidedMarker;
  }
  /** Label styling properties.
   * @return  Label `LabelStyleProps`, or `undefined` if not set
   */
  public get label(): LabelStyleProps | undefined {
    return this.resolved.label;
  }


  /**
   * Get resolved style properties with defaults applied for all groups.
   * Layers: defaults ← fallbacks ← props (later values win).
   * @param userDefaults
   * @return  Resolved style properties
   */
  public resolvedStyle(userDefaults?: Style): MinimalStyleProps {
    // Look in several places for fallback color properties.
    // Only the matched style's own props are used here — userDefaults are applied as a
    // separate layer so they don't interfere with the cascade computation.
    const resolved = this.resolved;
    const base = resolved.base;
    const stroke = resolved.stroke;
    const fill = resolved.fill;

    const fallbacks: MinimalStyleProps = {
      fill: {
        color: base?.color ?? stroke?.color
      },
      casing: {
        opacity: base?.opacity ?? stroke?.opacity
      },
      stroke: {
        color: base?.color ?? fill?.color,
        opacity: base?.opacity,
      },
      marker: {
        color: base?.color,
        opacity: base?.opacity
      },
      icon: {
        opacity: base?.opacity
      },
      viewfield: {
        color: base?.color ?? stroke?.color ?? fill?.color,
        opacity: base?.opacity ?? stroke?.opacity,
      },
      label: {
        color: base?.color ?? stroke?.color ?? fill?.color,
        opacity: base?.opacity ?? stroke?.opacity,
      },
      lineMarker: {
        opacity: base?.opacity ?? stroke?.opacity
      },
      sidedMarker: {
        // Only cascade from base - not from stroke/fill, so user DEFAULTS can set
        // a meaningful default color that isn't overridden by a nearby road stroke.
        color: base?.color,
        opacity: base?.opacity ?? stroke?.opacity,
      }
    };

    // result: styleDefaults ← userDefaults ← fallbacks ← this.resolved
    // userDefaults (e.g. DEFAULTS style from the asset file) fills the gap between hardcoded
    // styleDefaults and the semantic fallbacks, so base.color and stroke/fill cascades still win.
    return deepMerge({}, styleDefaults, userDefaults?.resolved ?? {}, fallbacks, resolved) as MinimalStyleProps;
  }


  /**
   * Returns a new Style that is deep property merge of `other` and `this`.
   * Properties from `other` override properties from `this`.
   * Useful for applying modifiers (e.g., lifecycle styles) on top of base styles.
   * @param other - Another Style to merge with this one
   * @return A new Style with merged properties
   */
  public merge(other: Style): Style {
    const merged = deepMerge({}, this.resolved, other.resolved) as StyleProps;
    merged.id = this.id;  // Keep original ID
    return new Style(this.context, merged);
  }


  /**
   * Create a copy of this style with a different ID.
   * @param newID - The new ID for the copy
   * @return A new Style with the new ID
   */
  public clone(newID?: StyleID): Style {
    const cloned = structuredClone(this.props);
    if (newID) {
      cloned.id = newID;
    }
    return new Style(this.context, cloned);
  }


  /**
   * Resolve any `var()` reference strings found in this style's props.
   * Creates a resolved copy of `props` — the raw props are never mutated.
   * Call `reset()` to discard the resolved copy before re-resolving.
   *
   * @param variables - Map of VariableID to Variable instances
   */
  public resolveVariables(variables: Map<VariableID, Variable>): void {
    for (const [group, subProps] of Object.entries(this.props) as [keyof StyleProps, unknown][]) {
      if (!subProps || typeof subProps !== 'object') continue;

      for (const [prop, val] of Object.entries(subProps)) {
        if (typeof val !== 'string' || !isVarRef(val)) continue;

        // Lazy-clone on first var() hit
        if (!this._resolved) {
          this._resolved = structuredClone(this.props);
          this._hasVarRefs = true;
        }

        // Resolve in the clone only
        const result = resolveVarRef(val, variables);
        if (result !== undefined) {
          const resolvedGroup = this._resolved[group] as Record<string, unknown> | undefined;
          if (resolvedGroup) {
            resolvedGroup[prop] = result;
          }
        }
      }
    }
  }


  /**
   * Discard the resolved copy so getters fall back to raw props.
   * Called before re-resolving when variables change (e.g. on style reload).
   */
  public reset(): void {
    this._resolved = null;
  }


  /**
   * Whether this style's raw props contain any `var()` references.
   * @return  `true` if any prop value uses a `var()` reference
   */
  public get hasVarRefs(): boolean {
    return this._hasVarRefs;
  }


  /**
   * Convert to a JSON-serializable object.
   * @return  A deep clone of the style props suitable for JSON serialization
   */
  public toJSON(): StyleProps {
    return structuredClone(this.props);
  }

}
