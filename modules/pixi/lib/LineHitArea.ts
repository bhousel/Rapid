import { geomStrokeContains, geomStrokeOutline } from '../../geo/index.ts';

import type { Extent } from '@rapid-sdk/math';
import type { StrokeOptions, StrokeOutline } from '../../geo/stroke.ts';


/**
 * The hit area of a line, or of a polygon's ring: the line with a few pixels around it.
 *
 * A point is in it when it's within a distance of the line (`geomStrokeContains()`), so there's
 * no shape to work out, and nothing to build again when the distance changes with the zoom:
 * a feature keeps one of these and calls `set()`. The line is looked at only when the pointer
 * is inside its box.
 *
 * A select halo follows the same line at the same distance (`outline()`).
 *
 * Pixi asks a container's `hitArea` only for `contains(x, y)`.
 */
export class LineHitArea {
  /** The line's coordinates `[x,y,x,y,…]`, in the container's own coordinates (not a copy) */
  protected _coords: ArrayLike<number>;
  /** How far from the line a point can be: half the line's width, and the pixels around it */
  protected _halfWidth: number;
  /** Whether the line's last point joins its first */
  protected _closed: boolean;
  /** The box that everything within that distance is certainly inside of */
  protected _minX: number;
  protected _minY: number;
  protected _maxX: number;
  protected _maxY: number;


  /**
   * @param coords - The line's coordinates `[x,y,x,y,…]`, in the container's own coordinates
   * @param halfWidth - How far from the line a point can be, in the same coordinates
   * @param extent - The extent of those coordinates, or of something that contains them
   * @param closed - Whether the line's last point joins its first
   */
  public constructor(coords: ArrayLike<number>, halfWidth: number, extent: Extent, closed: boolean = false) {
    this._coords = coords;
    this._halfWidth = halfWidth;
    this._closed = closed;
    this._minX = extent.min[0] - halfWidth;
    this._minY = extent.min[1] - halfWidth;
    this._maxX = extent.max[0] + halfWidth;
    this._maxY = extent.max[1] + halfWidth;
  }


  /**
   * Changes the line or the distance, as the constructor sets them.
   * @param coords - The line's coordinates `[x,y,x,y,…]`, in the container's own coordinates
   * @param halfWidth - How far from the line a point can be, in the same coordinates
   * @param extent - The extent of those coordinates, or of something that contains them
   * @param closed - Whether the line's last point joins its first
   */
  public set(coords: ArrayLike<number>, halfWidth: number, extent: Extent, closed: boolean = false): void {
    this._coords = coords;
    this._halfWidth = halfWidth;
    this._closed = closed;
    this._minX = extent.min[0] - halfWidth;
    this._minY = extent.min[1] - halfWidth;
    this._maxX = extent.max[0] + halfWidth;
    this._maxY = extent.max[1] + halfWidth;
  }


  /**
   * Whether a point is within the distance of the line.
   * @param x - The point's x coordinate, in the container's own coordinates
   * @param y - The point's y coordinate
   * @return `true` if it is
   */
  public contains(x: number, y: number): boolean {
    if (x < this._minX || x > this._maxX || y < this._minY || y > this._maxY) return false;
    return geomStrokeContains(this._coords, this._halfWidth, x, y, this._closed);
  }


  /**
   * The edge of the hit area, for a halo: the rings at the distance from the line.
   * @param options - How to go around the line's ends and corners (see `geomStrokeOutline`)
   * @return One ring around an open line, and one outside and one inside a closed line
   */
  public outline(options: Partial<StrokeOptions> = {}): StrokeOutline {
    return geomStrokeOutline(this._coords, this._halfWidth, { ...options, closed: this._closed });
  }

}
