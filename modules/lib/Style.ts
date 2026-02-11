import { merge as deepMerge } from 'lodash-es';

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
 * The Icon image typically comes from SchemaSystem presets, but can be overridden
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
 * Properties for creating a Style.
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
  /** Repeating markers along the line (e.g. oneway arrows) */
  lineMarker?: PointStyleProps;
  /** One-sided markers (e.g. cliffs, retaining walls) */
  sidedMarker?: PointStyleProps;
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
  /** Anchor position { x, y } where 0.5, 0.5 = centered (default varies by marker type) */
  anchor?: { x: number; y: number };
  /** Scale multiplier: uniform number or per-axis { x, y } */
  scale?: number | { x: number; y: number };
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
  /** Size in pixels (defaults vary by usage, typically 11 for icons) */
  size?: number;
}


/** Default fill style values. */
const DEFAULT_FILL: FillStyleProps = {
  color: 0xaaaaaa,
  opacity: 0.3,
  width: 2
};

/** Default marker style values. */
const DEFAULT_MARKER: PointStyleProps = {
  color: 0xffffff,
  opacity: 1,
  image: 'smallCircle'
};

/** Default icon style values. */
const DEFAULT_ICON: PointStyleProps = {
  color: 0x111111,
  opacity: 1,
  size: 11
};

/** Default viewfield style values. */
const DEFAULT_VIEWFIELD: ViewfieldStyleProps = {
  angles: [],
  color: 0xffffff,
  opacity: 0.7,
  image: 'viewfield'
};

/** Default line style values. */
const DEFAULT_LINE: LineStyleProps = {
  color: 0xcccccc,
  opacity: 1,
  width: 3,
  cap: 'round',
  join: 'round'
};

/** Default label style values. */
const DEFAULT_LABEL: LabelStyleProps = {
  color: 0xeeeeee,
  opacity: 1,
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


  /** The asset ID this Style came from. */
  get assetID(): AssetID | undefined {
    return this.props.assetID;
  }

  /** Fill style properties. */
  get fill(): FillStyleProps | undefined {
    return this.props.fill;
  }
  /** Casing style properties. */
  get casing(): LineStyleProps | undefined {
    return this.props.casing;
  }
  /** Stroke style properties. */
  get stroke(): LineStyleProps | undefined {
    return this.props.stroke;
  }
  /** Marker style properties (point background shape). */
  get marker(): PointStyleProps | undefined {
    return this.props.marker;
  }
  /** Icon style properties (rendered inside marker). */
  get icon(): PointStyleProps | undefined {
    return this.props.icon;
  }
  /** Viewfield style properties */
  get viewfield(): ViewfieldStyleProps | undefined {
    return this.props.viewfield;
  }
  /** Label styling properties. */
  get label(): LabelStyleProps | undefined {
    return this.props.label;
  }


  /**
   * Get resolved fill properties with defaults applied.
   * Returns an object with all required fill properties.
   * @return Resolved fill properties
   */
  resolvedFill(): FillStyleProps {
    const fill = this.props.fill ?? {};
    return {
      color: fill.color ?? DEFAULT_FILL.color,
      opacity: fill.opacity ?? DEFAULT_FILL.opacity,
      width: fill.width ?? DEFAULT_FILL.width,
      pattern: fill.pattern ?? DEFAULT_FILL.pattern
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
      color: casing.color ?? 0x444444,
      opacity: casing.opacity ?? 1,
      width: casing.width ?? 5,  // Casing typically wider
      cap: casing.cap ?? DEFAULT_LINE.cap,
      join: casing.join ?? DEFAULT_LINE.join,
      dash: casing.dash ?? DEFAULT_LINE.dash,
      lineMarker: casing.lineMarker ?? DEFAULT_LINE.lineMarker,
      sidedMarker: casing.sidedMarker ?? DEFAULT_LINE.sidedMarker
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
      color: stroke.color ?? DEFAULT_LINE.color,
      opacity: stroke.opacity ?? DEFAULT_LINE.opacity,
      width: stroke.width ?? DEFAULT_LINE.width,
      cap: stroke.cap ?? DEFAULT_LINE.cap,
      join: stroke.join ?? DEFAULT_LINE.join,
      dash: stroke.dash ?? DEFAULT_LINE.dash,
      lineMarker: stroke.lineMarker ?? DEFAULT_LINE.lineMarker,
      sidedMarker: stroke.sidedMarker ?? DEFAULT_LINE.sidedMarker
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
      color: marker.color ?? DEFAULT_MARKER.color,
      opacity: marker.opacity ?? DEFAULT_MARKER.opacity,
      image: marker.image ?? DEFAULT_MARKER.image,
      anchor: marker.anchor,
      scale: marker.scale
    };
  }

  /**
   * Get resolved icon properties with defaults applied.
   * Returns an object with all required icon properties (except image, which is optional).
   * @return Resolved icon properties
   */
  resolvedIcon(): PointStyleProps {
    const icon = this.props.icon ?? {};
    return {
      color: icon.color ?? DEFAULT_ICON.color,
      opacity: icon.opacity ?? DEFAULT_ICON.opacity,
      image: icon.image,  // undefined if not set (usually comes from preset)
      size: icon.size ?? DEFAULT_ICON.size,
      anchor: icon.anchor,
      scale: icon.scale
    };
  }


  /**
   * Get resolved viewfield properties with defaults applied.
   * Returns an object with all required viewfield properties.
   * @return Resolved viewfield properties
   */
  resolvedViewfield(): ViewfieldStyleProps {
    const viewfield = this.props.viewfield ?? {};
    return {
      angles: viewfield.angles ?? DEFAULT_VIEWFIELD.angles,
      color: viewfield.color ?? DEFAULT_VIEWFIELD.color,
      opacity: viewfield.opacity ?? DEFAULT_VIEWFIELD.opacity,
      image: viewfield.image ?? DEFAULT_VIEWFIELD.image,
      size: viewfield.size,
      anchor: viewfield.anchor,
      scale: viewfield.scale
    };
  }

  /**
   * Get resolved label properties with defaults applied.
   * Color has a smart default that falls back to fill.color, then stroke.color, then gray.
   * @return Resolved label properties
   */
  resolvedLabel(): LabelStyleProps {
    const label = this.props.label ?? {};

    // Smart default for color: follow the dominant color
    let color = label.color;
    if (color === undefined) {
      if (this.props.fill?.color !== undefined) {
        color = this.props.fill.color;
      } else if (this.props.stroke?.color !== undefined) {
        color = this.props.stroke.color;
      } else {
        color = DEFAULT_LABEL.color;
      }
    }

    return {
      color: color,
      opacity: label.opacity ?? DEFAULT_LABEL.opacity,
      size: label.size ?? DEFAULT_LABEL.size
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
    const merged = deepMerge({}, this.props, other.props) as StyleProps;
    merged.id = this.id;  // Keep original ID
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
   * Convert to a JSON-serializable object.
   */
  toJSON(): StyleProps {
    return globalThis.structuredClone(this.props);
  }

}
