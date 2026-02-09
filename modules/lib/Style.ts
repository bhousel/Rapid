import type { Context } from '../Context.ts';

/**
 * Style - Visual styling properties for map features.
 *
 * A Style describes *what something looks like*. It contains visual properties for:
 * - fill (areas)
 * - casing (line outline, draws below stroke)
 * - stroke (line)
 * - markers (point markers)
 * - icons (rendered inside markers)
 * - line decorations (oneway arrows, sided markers)
 * - labels
 *
 * The Icon name typically comes from SchemaSystem presets, but can be overridden
 * in a style file. Other visual properties (color, size, alpha) come from styles.
 *
 * @example
 * // A simple fill color
 * const green = new Style(context, {
 *   id: 'green',
 *   fill: { color: 0x8cd05f, alpha: 0.3 }
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
 *   marker: { name: 'pin', color: 0xffffff },
 *   icon: { color: 0x111111, size: 11 },
 *   labelColor: 0xdddddd
 * });
 *
 * @module
 */


/** Line cap style */
export type LineCap = 'butt' | 'round' | 'square';
/** Line join style */
export type LineJoin = 'bevel' | 'miter' | 'round';


/** Properties for fill styling (used for area features). */
export interface FillStyleProps {
  /** Line width in pixels (for the fill outline) */
  width?: number;
  /** The color as a hex number, e.g. 0xcf2081 */
  color?: number;
  /** Opacity: 0 = transparent, 1 = opaque */
  alpha?: number;
  /** Pattern ID for textured fills, e.g. 'grass', 'waves' */
  pattern?: string;
}

/** Properties for line styling (used for casing and stroke). */
export interface LineStyleProps {
  /** Line width in pixels */
  width?: number;
  /** The color as a hex number, e.g. 0xcf2081 */
  color?: number;
  /** Opacity: 0 = transparent, 1 = opaque */
  alpha?: number;
  /** Line cap style */
  cap?: LineCap;
  /** Line join style */
  join?: LineJoin;
  /** Dash pattern as array of pixels on/off, e.g. [10, 5] */
  dash?: number[];
}

/**
 * Style properties for point-like graphics (markers, icons, line markers, sided markers).
 * Used for:
 * - `marker`: Background shape behind an icon
 * - `icon`: Symbol rendered inside a marker
 * - `lineMarker`: Repeating markers along lines (e.g. oneway arrows)
 * - `sidedMarker`: One-sided markers (e.g. cliffs, retaining walls)
 */
export interface PointStyleProps {
  /** Texture name for the graphic */
  name?: string;
  /** Display color applied to the graphic */
  color?: number;
  /** Opacity: 0 = transparent, 1 = opaque */
  alpha?: number;
  /** Size in pixels (defaults vary by usage, typically 11 for icons) */
  size?: number;
}


/**
 * Properties for creating a Style.
 */
export interface StyleProps {
  /** Unique identifier for this style */
  id: StyleID;
  /** The asset this declaration came from */
  assetID?: AssetID;
  /** Version of the asset */
  assetVersion?: string;

  //
  // Area and line rendering
  //

  /** Fill styling (areas) */
  fill?: FillStyleProps;
  /** Casing styling (line outline, draws below stroke) */
  casing?: LineStyleProps;
  /** Stroke styling (line, draws above casing) */
  stroke?: LineStyleProps;

  //
  // Point/vertex marker appearance
  //

  /** Marker styling (point background shape) */
  marker?: PointStyleProps;
  /** Icon styling (rendered inside marker) */
  icon?: PointStyleProps;

  //
  // Line decorations
  //

  /** Line marker styling (repeating markers along lines, e.g. 'oneway') */
  lineMarker?: PointStyleProps;
  /** Sided marker styling (one-sided markers, e.g. for coastlines, retaining walls) */
  sidedMarker?: PointStyleProps;

  //
  // Shared properties
  //

  /** Label color (defaults to fill.color or stroke.color) */
  labelColor?: number;

  //
  // Rendering hints
  //

  /** If true, always use full fill for polygons (not partial fill) */
  requireFill?: boolean;
}


/** Default fill style values. */
const DEFAULT_FILL: FillStyleProps = {
  width: 2,
  color: 0xaaaaaa,
  alpha: 0.3
};

/** Default line style values. */
const DEFAULT_LINE: LineStyleProps = {
  width: 3,
  color: 0xcccccc,
  alpha: 1,
  cap: 'round',
  join: 'round'
};

/** Default marker style values. */
const DEFAULT_MARKER: PointStyleProps = {
  name: 'smallCircle',
  color: 0xffffff,
  alpha: 1
};

/** Default icon style values. */
const DEFAULT_ICON: PointStyleProps = {
  color: 0x111111,
  alpha: 1,
  size: 11
};


/**
 * Style - Describes visual appearance of map features.
 *
 * Properties you can access:
 *   `id`          Unique identifier for this style
 *   `props`       The full props object
 *   `fill`        Fill style properties (areas)
 *   `casing`      Casing style properties (line outline)
 *   `stroke`      Stroke style properties (line)
 *   `marker`      Marker style properties (point background)
 *   `icon`        Icon style properties (rendered in marker)
 *   `lineMarker`  Line marker style (oneway arrows, etc.)
 *   `sidedMarker` Sided marker style (coastlines, retaining walls)
 *   `labelColor`   Label color
 *   `requireFill` Force full fill for polygons
 */
export class Style {
  context: Context;
  props: StyleProps;

  /** Unique identifier */
  readonly id: StyleID;


  /**
   * @constructor
   * @param props - Properties defining the visual style
   * @throws Error if `id` property is missing
   */
  constructor(context: Context, props: Partial<StyleProps> = {}) {
    this.context = context;

    if (!props.id) {
      throw new Error('Style: Missing id property');
    }

    // Deep clone to avoid mutations
    this.props = globalThis.structuredClone(props) as StyleProps;
    this.id = props.id;
  }


  /**
   * Fill style properties.
   */
  get fill(): FillStyleProps | undefined {
    return this.props.fill;
  }


  /**
   * Casing style properties.
   */
  get casing(): LineStyleProps | undefined {
    return this.props.casing;
  }


  /**
   * Stroke style properties.
   */
  get stroke(): LineStyleProps | undefined {
    return this.props.stroke;
  }


  /**
   * The asset ID this style came from.
   */
  get assetID(): AssetID | undefined {
    return this.props.assetID;
  }


  /**
   * Marker style properties (point background shape).
   */
  get marker(): PointStyleProps | undefined {
    return this.props.marker;
  }


  /**
   * Icon style properties (rendered inside marker).
   */
  get icon(): PointStyleProps | undefined {
    return this.props.icon;
  }


  /**
   * Line marker style properties (repeating markers along lines).
   */
  get lineMarker(): PointStyleProps | undefined {
    return this.props.lineMarker;
  }


  /**
   * Sided marker style properties (one-sided markers).
   */
  get sidedMarker(): PointStyleProps | undefined {
    return this.props.sidedMarker;
  }


  /**
   * Label color.
   */
  get labelColor(): number | undefined {
    return this.props.labelColor;
  }


  /**
   * Whether to force full fill for polygons.
   */
  get requireFill(): boolean | undefined {
    return this.props.requireFill;
  }


  /**
   * Get resolved fill properties with defaults applied.
   * Returns an object with all required fill properties.
   * @return Resolved fill properties
   */
  resolvedFill(): FillStyleProps {
    const fill = this.props.fill ?? {};
    return {
      width: fill.width ?? DEFAULT_FILL.width,
      color: fill.color ?? DEFAULT_FILL.color,
      alpha: fill.alpha ?? DEFAULT_FILL.alpha,
      pattern: fill.pattern
    };
  }


  /**
   * Get resolved casing properties with defaults applied.
   * Returns an object with all required line properties.
   * @return Resolved casing properties
   */
  resolvedCasing(): LineStyleProps {
    const casing = this.props.casing ?? {};
    return {
      width: casing.width ?? 5,  // Casing typically wider
      color: casing.color ?? 0x444444,
      alpha: casing.alpha ?? 1,
      cap: casing.cap ?? DEFAULT_LINE.cap,
      join: casing.join ?? DEFAULT_LINE.join,
      dash: casing.dash
    };
  }


  /**
   * Get resolved stroke properties with defaults applied.
   * Returns an object with all required line properties.
   * @return Resolved stroke properties
   */
  resolvedStroke(): LineStyleProps {
    const stroke = this.props.stroke ?? {};
    return {
      width: stroke.width ?? DEFAULT_LINE.width,
      color: stroke.color ?? DEFAULT_LINE.color,
      alpha: stroke.alpha ?? DEFAULT_LINE.alpha,
      cap: stroke.cap ?? DEFAULT_LINE.cap,
      join: stroke.join ?? DEFAULT_LINE.join,
      dash: stroke.dash
    };
  }


  /**
   * Get resolved marker properties with defaults applied.
   * Returns an object with all required marker properties.
   * @return Resolved marker properties
   */
  resolvedMarker(): PointStyleProps {
    const marker = this.props.marker ?? {};
    return {
      name: marker.name ?? DEFAULT_MARKER.name,
      color: marker.color ?? DEFAULT_MARKER.color,
      alpha: marker.alpha ?? DEFAULT_MARKER.alpha
    };
  }


  /**
   * Get resolved icon properties with defaults applied.
   * Returns an object with all required icon properties (except name, which is optional).
   * @return Resolved icon properties
   */
  resolvedIcon(): PointStyleProps {
    const icon = this.props.icon ?? {};
    return {
      name: icon.name,  // undefined if not set (usually comes from preset)
      color: icon.color ?? DEFAULT_ICON.color,
      alpha: icon.alpha ?? DEFAULT_ICON.alpha,
      size: icon.size ?? DEFAULT_ICON.size
    };
  }


  /**
   * Get resolved label color with smart default.
   * Falls back to fill.color, then stroke.color, then a default gray.
   * @return Resolved label color
   */
  resolvedLabelColor(): number {
    if (this.props.labelColor !== undefined) {
      return this.props.labelColor;
    }
    // Smart default: follow the dominant color
    if (this.props.fill?.color !== undefined) {
      return this.props.fill.color;
    }
    if (this.props.stroke?.color !== undefined) {
      return this.props.stroke.color;
    }
    return 0xeeeeee;  // default gray
  }


  /**
   * Merge another style's properties into this one.
   * Properties from `other` override properties from `this`.
   * Useful for applying modifiers (e.g., lifecycle styles) on top of base styles.
   *
   * @param other - Another Style to merge
   * @return A new Style with merged properties
   */
  merge(other: Style): Style {
    const merged: StyleProps = {
      id: this.id,  // Keep original ID

      // Nested objects: spread merge
      fill: { ...this.props.fill, ...other.props.fill },
      casing: { ...this.props.casing, ...other.props.casing },
      stroke: { ...this.props.stroke, ...other.props.stroke },
      marker: { ...this.props.marker, ...other.props.marker },
      icon: { ...this.props.icon, ...other.props.icon },
      lineMarker: { ...this.props.lineMarker, ...other.props.lineMarker },
      sidedMarker: { ...this.props.sidedMarker, ...other.props.sidedMarker },

      // Scalar properties: other wins if defined
      labelColor: other.props.labelColor ?? this.props.labelColor,
      requireFill: other.props.requireFill ?? this.props.requireFill
    };

    // Clean up empty nested objects
    if (merged.fill && Object.keys(merged.fill).length === 0) {
      delete merged.fill;
    }
    if (merged.casing && Object.keys(merged.casing).length === 0) {
      delete merged.casing;
    }
    if (merged.stroke && Object.keys(merged.stroke).length === 0) {
      delete merged.stroke;
    }
    if (merged.marker && Object.keys(merged.marker).length === 0) {
      delete merged.marker;
    }
    if (merged.icon && Object.keys(merged.icon).length === 0) {
      delete merged.icon;
    }
    if (merged.lineMarker && Object.keys(merged.lineMarker).length === 0) {
      delete merged.lineMarker;
    }
    if (merged.sidedMarker && Object.keys(merged.sidedMarker).length === 0) {
      delete merged.sidedMarker;
    }

    return new Style(this.context, merged);
  }


  /**
   * Create a copy of this style with a different ID.
   *
   * @param newID - The new ID for the copy
   * @return A new Style with the new ID
   */
  clone(newID?: StyleID): Style {
    const cloned = globalThis.structuredClone(this.props);
    if (newID) {
      cloned.id = newID;
    }
    return new Style(this.context, cloned);
  }


  /**
   * Check if this declaration has any fill properties.
   */
  hasFill(): boolean {
    return this.props.fill !== undefined && Object.keys(this.props.fill).length > 0;
  }


  /**
   * Check if this declaration has any casing properties.
   */
  hasCasing(): boolean {
    return this.props.casing !== undefined && Object.keys(this.props.casing).length > 0;
  }


  /**
   * Check if this declaration has any stroke properties.
   */
  hasStroke(): boolean {
    return this.props.stroke !== undefined && Object.keys(this.props.stroke).length > 0;
  }


  /**
   * Check if this declaration has any marker properties.
   */
  hasMarker(): boolean {
    return this.props.marker !== undefined && Object.keys(this.props.marker).length > 0;
  }


  /**
   * Check if this declaration has any icon properties.
   */
  hasIcon(): boolean {
    return this.props.icon !== undefined && Object.keys(this.props.icon).length > 0;
  }


  /**
   * Check if this declaration has any line marker properties.
   */
  hasLineMarker(): boolean {
    return this.props.lineMarker !== undefined && Object.keys(this.props.lineMarker).length > 0;
  }


  /**
   * Check if this declaration has any sided marker properties.
   */
  hasSidedMarker(): boolean {
    return this.props.sidedMarker !== undefined && Object.keys(this.props.sidedMarker).length > 0;
  }


  /**
   * Convert to a JSON-serializable object.
   */
  toJSON(): StyleProps {
    return globalThis.structuredClone(this.props);
  }


  /**
   * String representation for debugging.
   */
  toString(): string {
    const parts: string[] = [];
    if (this.hasFill()) {
      const f = this.props.fill!;
      parts.push(`fill(${f.color?.toString(16) ?? '?'})`);
    }
    if (this.hasCasing()) {
      const c = this.props.casing!;
      parts.push(`casing(w=${c.width ?? '?'})`);
    }
    if (this.hasStroke()) {
      const s = this.props.stroke!;
      parts.push(`stroke(w=${s.width ?? '?'})`);
    }
    if (this.hasMarker()) {
      const m = this.props.marker!;
      parts.push(`marker(${m.name ?? '?'})`);
    }
    if (this.hasIcon()) {
      const i = this.props.icon!;
      parts.push(`icon(${i.name ?? '?'})`);
    }
    if (this.props.labelColor !== undefined) {
      parts.push(`labelColor(${this.props.labelColor.toString(16)})`);
    }
    return `Style[${this.id}]{${parts.join(', ')}}`;
  }

}
