import { Extent } from '@rapid-sdk/math';

import { GeometryPart } from '../data/lib/GeometryPart.js';


/**
 * PixiGeometryPart
 * Wrapper for projected geometry in screen coordinates used by Pixi.
 * This now wraps the core GeometryPart class that works in world coordinates,
 *  so these computations are relatively quick.
 *
 * Properties you can access:
 *   `type`               String describing what kind of geometry this is ('Point', 'LineString', 'Polygon')
 *   `world.coords`       World coordinate data
 *   `screen.coords`      Projected coordinate data
 *   `screen.flatCoords`  Projected coordinate data, flat Array how Pixi wants it [ x,y, x,y, … ]
 *   `screen.extent`      Projected extent
 *   `screen.ssr`         Projected smallest surrounding rectangle data (angle, poly)
 *   `screen.width`       Width of projected shape, in pixels
 *   `screen.height`      Height of projected shape, in pixels
 *   `screen.lod`         Level of detail for the geometry (0 = off, 1 = simplified, 2 = full)
 */
export class PixiGeometryPart {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    this.context = context;
    this.reset();
  }


  /**
   * destroy
   * Release memory.
   * Do not use the geometry after calling `destroy()`.
   */
  destroy() {
    this.reset();
  }


  /**
   * reset
   * Remove all stored data
   */
  reset() {
    this.dirty = true;  // if `true`, the screen coordinates need recomputation.
    this._source = null;  // the source GeometryPart

    // Projected data in world coordinates
    // ([0,0] is the top left corner of a 256x256 Web Mercator world)
    this.world = null;

    // Projected data in screen coordinates
    // ([0,0] is the origin of the Pixi scene)
    this.screen = null;
  }


  /**
   * update
   * @param  {Viewport}  viewport - Pixi viewport to use for rendering
   */
  update(viewport) {
    if (!this.dirty || !this.world) return;  // nothing to do

    this.dirty = false;
    const type = this.type;
    const world = this.world;
    const screen = this.screen = {};

    // Points are simple, just project once.
    if (type === 'Point') {
      screen.coords = viewport.worldToScreen(world.coords);
      screen.extent = new Extent(screen.coords);
      screen.centroid = screen.coords;
      screen.width = 0;
      screen.height = 0;
      screen.lod = 2;  // full detail
      return;
    }

    // A line or a polygon.

    // First, project extent..
    screen.extent = new Extent(
      viewport.worldToScreen(world.extent.min),
      viewport.worldToScreen(world.extent.max)
    );

    const [minX, minY] = screen.extent.min;
    const [maxX, maxY] = screen.extent.max;
    screen.width = maxX - minX;
    screen.height = maxY - minY;

    // So small, don't waste time on it.
    if (screen.width < 4 && screen.height < 4) {
      screen.lod = 0;
      return;
    }

    // Reproject the coordinate data..
    // Generate both normal coordinate rings and flattened rings at the same time to avoid extra iterations.
    // Preallocate Arrays to avoid garbage collection formerly caused by excessive Array.push()
    const rings = (type === 'LineString') ? [world.coords] : world.coords;
    const projRings = new Array(rings.length);
    const projFlatRings = new Array(rings.length);

    for (let i = 0; i < rings.length; ++i) {
      const ring = rings[i];
      projRings[i] = new Array(ring.length);
      projFlatRings[i] = new Array(ring.length * 2);

      for (let j = 0; j < ring.length; ++j) {
        const xy = viewport.worldToScreen(ring[j]);
        projRings[i][j] = xy;
        projFlatRings[i][j * 2] = xy[0];
        projFlatRings[i][j * 2 + 1] = xy[1];
      }
    }

    if (type === 'LineString') {
      screen.coords = projRings[0];
      screen.flatCoords = projFlatRings[0];
    } else {  // Polygon
      screen.coords = projRings;
      screen.flatCoords = projFlatRings;
    }

    // Calculate ssr if possible
    if (world.ssr) {
      screen.ssr = {
        poly: world.ssr.poly.map(coord => viewport.worldToScreen(coord)),
        angle: world.ssr.angle
      };
    }

    screen.lod = 2;   // full detail (for now)
  }


  /**
   * type
   * The original data format lives in the source GeometryPart, this is just a convenience getter.
   * @return  {string}  One of 'Point', 'LineString', 'Polygon'
   * @readonly
   */
  get type() {
    return this._source?.type;
  }


  /**
   * setData
   * The source coordinate data must be passed as either:
   * - A GeometryPart (or something like one, with a `type` and `world` props)
   * - A GeoJSON singular geometry that can be turned into a GeometryPart.
   * If there is any existing data, it is first removed.
   * @param  {GeometryPart|Object}  source - A GeometryPart, or something that can be turned into one.
   */
  setData(source = {}) {
    this.destroy();

    if (source.world && source.type) {   // A GeometryPart, or something that looks like one.
      this._source = source;
      this.world = source.world;
    } else {    // Can this source be turned into a GeometryPart?
      const part = new GeometryPart(this.context);
      part.setData(source);
      if (part.world) {
        this._source = part;
        this.world = part.world;
      }
    }
  }

}
