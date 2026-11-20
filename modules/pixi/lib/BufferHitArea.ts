import * as PIXI from 'pixi.js';
import { lineToPoly } from '../helpers.ts';

import type { Extent } from '@rapid-sdk/math';
import type { LineToPolyResult } from '../helpers.ts';


/**
 * The hit area of a line, or of a polygon's ring: the line with a few pixels around it.
 *
 * Working out that shape costs more than anything else in drawing a line again (`lineToPoly()`
 * walks the line and builds several arrays), and it changes with every zoom. Almost none of
 * them are ever used: the pointer is near a handful of features at a time. So this keeps what's
 * needed to work the shape out, and does it the first time the pointer is inside the line's
 * box, or when a halo is drawn around it (`buffer`).
 *
 * Pixi asks a container's `hitArea` only for `contains(x, y)`.
 */
export class BufferHitArea {
  /** The line's coordinates `[x,y,x,y,…]`, in the container's own coordinates (not a copy) */
  protected _flat: number[];
  /** The stroke that makes the buffer: its `width` is the line's width and the pixels around it */
  protected _style: PIXI.StrokeStyle;
  /** The box that the buffer is certainly inside of */
  protected _minX: number;
  protected _minY: number;
  protected _maxX: number;
  protected _maxY: number;
  /** The buffer, once something needed it */
  protected _buffer: LineToPolyResult | null;
  /** The buffer's perimeter as a polygon, once the pointer was near */
  protected _polygon: PIXI.Polygon | null;


  /**
   * @param flat - The line's coordinates `[x,y,x,y,…]`, in the container's own coordinates
   * @param style - The stroke that makes the buffer (see `lineToPoly`)
   * @param extent - The extent of those coordinates, or of something that contains them
   */
  public constructor(flat: number[], style: PIXI.StrokeStyle, extent: Extent) {
    const pad = style.width ?? 0;   // (half of it would do for a centered stroke)
    this._flat = flat;
    this._style = style;
    this._minX = extent.min[0] - pad;
    this._minY = extent.min[1] - pad;
    this._maxX = extent.max[0] + pad;
    this._maxY = extent.max[1] + pad;
    this._buffer = null;
    this._polygon = null;
  }


  /**
   * The shape of the buffer: its perimeter, and for a closed line its outer and inner edges.
   * @return The paths, as `lineToPoly()` returns them
   */
  public get buffer(): LineToPolyResult {
    this._buffer ??= lineToPoly(this._flat, this._style);
    return this._buffer;
  }


  /**
   * Whether a point is inside the buffer.
   * @param x - The point's x coordinate, in the container's own coordinates
   * @param y - The point's y coordinate
   * @return `true` if the point is inside
   */
  public contains(x: number, y: number): boolean {
    if (x < this._minX || x > this._maxX || y < this._minY || y > this._maxY) return false;

    this._polygon ??= new PIXI.Polygon(this.buffer.perimeter);
    return this._polygon.contains(x, y);
  }

}
