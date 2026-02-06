/**
 * Style - Visual styling properties for map features.
 *
 * A Style describes *what something looks like*. It contains
 * visual properties for fill (areas), casing (line outline), and stroke (line).
 *
 * @example
 * // A simple fill color
 * const green = new Style({
 *   id: 'green',
 *   fill: { color: 0x8cd05f, alpha: 0.3 }
 * });
 *
 * // A road with casing and stroke
 * const motorway = new Style({
 *   id: 'motorway',
 *   casing: { width: 10, color: 0x70372f },
 *   stroke: { width: 8, color: 0xcf2081 }
 * });
 *
 * @module
 */


/** Line cap style */
export type LineCap = 'butt' | 'round' | 'square';
/** Line join style */
export type LineJoin = 'bevel' | 'miter' | 'round';


/**
 * Properties for fill styling (used for area features).
 */
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


/**
 * Properties for line styling (used for casing and stroke).
 */
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
 * Properties for creating a Style.
 */
export interface StyleProps {
  /** Unique identifier for this style */
  id: StyleID;
  /** The asset this declaration came from */
  assetID?: AssetID;
  /** Version of the asset */
  assetVersion?: string;
  /** Fill styling (areas) */
  fill?: FillStyleProps;
  /** Casing styling (line outline, draws below stroke) */
  casing?: LineStyleProps;
  /** Stroke styling (line, draws above casing) */
  stroke?: LineStyleProps;
}


/**
 * Default fill style values.
 */
const DEFAULT_FILL: Required<Omit<FillStyleProps, 'pattern'>> = {
  width: 2,
  color: 0xaaaaaa,
  alpha: 0.3
};


/**
 * Default line style values.
 */
const DEFAULT_LINE: Required<Omit<LineStyleProps, 'dash'>> = {
  width: 3,
  color: 0xcccccc,
  alpha: 1,
  cap: 'round',
  join: 'round'
};


/**
 * Style - Describes visual appearance of map features.
 *
 * Properties you can access:
 *   `id`      Unique identifier for this style
 *   `props`   The full props object
 *   `fill`    Fill style properties
 *   `casing`  Casing (line outline) style properties
 *   `stroke`  Stroke (line) style properties
 */
export class Style {
  props: StyleProps;

  /** Unique identifier */
  readonly id: StyleID;


  /**
   * @constructor
   * @param props - Properties defining the visual style
   * @throws Error if `id` property is missing
   */
  constructor(props: StyleProps) {
    if (!props.id) {
      throw new Error('Style: id is required');
    }

    // Deep clone to avoid mutations
    this.props = globalThis.structuredClone(props);
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
   * Get resolved fill properties with defaults applied.
   * Returns an object with all required fill properties.
   *
   * @return Resolved fill properties
   */
  resolvedFill(): Required<Omit<FillStyleProps, 'pattern'>> & { pattern?: string } {
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
   *
   * @return Resolved casing properties
   */
  resolvedCasing(): Required<Omit<LineStyleProps, 'dash'>> & { dash?: number[] } {
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
   *
   * @return Resolved stroke properties
   */
  resolvedStroke(): Required<Omit<LineStyleProps, 'dash'>> & { dash?: number[] } {
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
      fill: { ...this.props.fill, ...other.props.fill },
      casing: { ...this.props.casing, ...other.props.casing },
      stroke: { ...this.props.stroke, ...other.props.stroke }
    };

    // Clean up empty objects
    if (merged.fill && Object.keys(merged.fill).length === 0) {
      delete merged.fill;
    }
    if (merged.casing && Object.keys(merged.casing).length === 0) {
      delete merged.casing;
    }
    if (merged.stroke && Object.keys(merged.stroke).length === 0) {
      delete merged.stroke;
    }

    return new Style(merged);
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
    return new Style(cloned);
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
    return `Style[${this.id}]{${parts.join(', ')}}`;
  }


  /**
   * Create a Style from raw props (from JSON).
   * This is essentially the same as the constructor but provided for consistency.
   *
   * @param props - Raw properties object
   * @return A new Style instance
   */
  static from(props: StyleProps): Style {
    return new Style(props);
  }
}
