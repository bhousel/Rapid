import { Extent } from '@rapid-sdk/math';


/**
 * PixiGeometry
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
 *   `screen.outer`       Projected outer ring, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `screen.flatOuter`   Projected outer ring, flat Array how Pixi wants it [ x,y, x,y, … ]
 *   `screen.holes`       Projected hole rings, Array of Array of coordinate pairs [ [ [x,y], [x,y], … ] ]
 *   `screen.flatHoles`   Projected hole rings, Array of flat Array how Pixi wants it [ [ x,y, x,y, … ] ]
 *   `screen.centroid`    Projected centroid, [x, y]
 *   `screen.poi`         Projected pole of inaccessability, [x, y]
 *   `screen.ssr`         Projected smallest surrounding rectangle data (angle, poly)
 *   `screen.width`       Width of projected shape, in pixels
 *   `screen.height`      Height of projected shape, in pixels
 *   `screen.lod`         Level of detail for the geometry (0 = off, 1 = simplified, 2 = full)
 */
export class PixiGeometry {

  /**
   * @constructor
   */
  constructor() {
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
    this.dirty = true;

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
    const world = this.world;
    const screen = this.screen = {};

    // Points are simple, just project once.
    if (this.type === 'Point') {
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
    const rings = (this.type === 'LineString') ? [world.coords] : world.coords;
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

    // Assign outer and holes
    if (this.type === 'LineString') {
      screen.coords = projRings[0];
      screen.flatCoords = projFlatRings[0];
      screen.outer = projRings[0];
      screen.flatOuter = projFlatRings[0];
      screen.holes = null;
      screen.flatHoles = null;
    } else {
      screen.coords = projRings;
      screen.flatCoords = projFlatRings;
      screen.outer = projRings[0];
      screen.flatOuter = projFlatRings[0];
      screen.holes = projRings.slice(1);
      screen.flatHoles = projFlatRings.slice(1);
    }

    // Calculate centroid, poi, ssr if possible
    if (world.centroid) {
      screen.centroid = viewport.worldToScreen(world.centroid);
    }
    if (world.poi) {
      screen.poi = viewport.worldToScreen(world.poi);
    }
    if (world.ssr) {
      screen.ssr = {
        poly: world.ssr.poly.map(coord => viewport.worldToScreen(coord)),
        angle: world.ssr.angle
      };
    }

    screen.lod = 2;   // full detail (for now)
  }


  /**
   * setCoords
   * The `coords` must be passed as an Object containing world coordinate data,
   * either precomputed as feature's GeometryPart, or generated on the fly
   * from a point like a midpoint.
   *
   * The passed object must contain a property called `coords`, which will be checked:
   *
   * 'Point' - Single coordinate
   *    [lon, lat]
   *
   * 'LineString' - Array of coordinates
   *    [ [lon, lat], [lon, lat],  … ]
   *
   * 'Polygon' - Array of Arrays
   *    [
   *      [ [lon, lat], [lon, lat], … ],   // outer ring
   *      [ [lon, lat], [lon, lat], … ],   // inner rings
   *      …
   *    ]
   *
   * @param {Object} world - An Object containing "world" coordinate data
   *
   */
  setCoords(world) {
    this.destroy();

    const coords = world.coords;
    const type = this._inferType(coords);
    if (!type) return;  // do nothing if data is missing

    this.type = type;
    this.world = globalThis.structuredClone(world);
  }


  /**
   * _inferType
   * Determines what kind of geometry we were passed.
   * @param   {Array<*>}  arr - Geometry `Array` (contents depends on the Feature type)
   * @return  {string?}   'Point', 'LineString', 'Polygon' or null
   */
  _inferType(data) {
    const a = Array.isArray(data) && data[0];
    if (typeof a === 'number') return 'Point';

    const b = Array.isArray(a) && a[0];
    if (typeof b === 'number') return 'LineString';

    const c = Array.isArray(b) && b[0];
    if (typeof c === 'number') return 'Polygon';

    return null;
  }
}
