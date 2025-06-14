import { Extent, geomGetSmallestSurroundingRectangle, vecInterp } from '@rapid-sdk/math';
import { polygonHull, polygonCentroid } from 'd3-polygon';
import polylabel from '@mapbox/polylabel';


/**
 * PixiGeometry
 * Wrapper for projected geometry in screen coordinates used by Pixi.
 * This now wraps the core GeometryPart class that works in world coordinates,
 *  so these computations are relatively quick.
 *
 * Properties you can access:
 *   `type`        String describing what kind of geometry this is ('Point', 'LineString', 'Polygon')
 *   `geometry`    Original GeometryPart
 *   `coords`      Projected coordinate data
 *   `flatCoords`  Projected coordinate data, flat Array how Pixi wants it [ x,y, x,y, … ]
 *   `extent`      Projected extent
 *   `outer`       Projected outer ring, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `flatOuter`   Projected outer ring, flat Array how Pixi wants it [ x,y, x,y, … ]
 *   `holes`       Projected hole rings, Array of Array of coordinate pairs [ [ [x,y], [x,y], … ] ]
 *   `flatHoles`   Projected hole rings, Array of flat Array how Pixi wants it [ [ x,y, x,y, … ] ]
 *   `hull`        Projected convex hull, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `centroid`    Projected centroid, [x, y]
 *   `poi`         Projected pole of inaccessability, [x, y]
 *   `ssr`         Projected smallest surrounding rectangle data (angle, poly)
 *   `width`       Width of projected shape, in pixels
 *   `height`      Height of projected shape, in pixels
 *   `lod`         Level of detail for the geometry (0 = off, 1 = simplified, 2 = full)
 */
export class PixiGeometry {

  /**
   * @constructor
   */
  constructor() {
    this.geometryPart = null;
    this.reset();
  }

  /* replacement for setCoords, figure this out better */
  setGeometry(geometryPart) {
    this.geometryPart = geometryPart;
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
   * type
   * Type now lives in `GeometryPart`, this is just a convenience getter.
   * @return  {string?}  One of 'Point', 'LineString', 'Polygon'
   * @readonly
   */
  get type() {
    return this.geometryPart?.type;
  }


  /**
   * reset
   * Remove all stored data
   */
  reset() {
    this.dirty = true;

    // Projected data in screen coordinates
    // ([0,0] is the origin of the Pixi scene)
    this.coords = null;
    this.flatCoords = null;
    this.extent = null;
    this.hull = null;
    this.centroid = null;
    this.poi = null;
    this.ssr = null;

    this.outer = null;
    this.flatOuter = null;
    this.holes = null;
    this.flatHoles = null;

    this.width = 0;
    this.height = 0;
    this.lod = 0;
  }


  /**
   * update
   * @param  {Viewport}  viewport - Pixi viewport to use for rendering
   */
  update(viewport) {
    if (!this.dirty || !this.geometryPart) return;  // nothing to do

    this.dirty = false;
    const world = this.geometryPart;

    // reset all projected properties
    this.coords = null;
    this.flatCoords = null;
    this.extent = null;
    this.outer = null;
    this.flatOuter = null;
    this.holes = null;
    this.flatHoles = null;
    this.hull = null;
    this.centroid = null;
    this.poi = null;
    this.ssr = null;

    // Points are simple, just project once.
    if (this.type === 'Point') {
      this.coords = viewport.worldToScreen(world.coords);
      this.extent = new Extent(this.coords);
      this.centroid = this.coords;
      this.width = 0;
      this.height = 0;
      this.lod = 2;  // full detail
      return;
    }

    // A line or a polygon.

    // First, project extent..
    this.extent = new Extent(
      viewport.worldToScreen(world.extent.min),
      viewport.worldToScreen(world.extent.max)
    );

    const [minX, minY] = this.extent.min;
    const [maxX, maxY] = this.extent.max;
    this.width = maxX - minX;
    this.height = maxY - minY;

    // So small, don't waste time on it.
    if (this.width < 4 && this.height < 4) {
      this.lod = 0;
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
      this.coords = projRings[0];
      this.flatCoords = projFlatRings[0];
      this.outer = projRings[0];
      this.flatOuter = projFlatRings[0];
      this.holes = null;
      this.flatHoles = null;
    } else {
      this.coords = projRings;
      this.flatCoords = projFlatRings;
      this.outer = projRings[0];
      this.flatOuter = projFlatRings[0];
      this.holes = projRings.slice(1);
      this.flatHoles = projFlatRings.slice(1);
    }

    // Calculate hull, centroid, poi, ssr if possible
    if (world.hull) {
      this.hull = world.hull.map(coord => viewport.worldToScreen(coord));
    }
    if (world.centroid) {
      this.centroid = viewport.worldToScreen(world.centroid);
    }
    if (world.poi) {
      this.poi = viewport.worldToScreen(world.poi);
    }
    if (world.ssr) {
      this.ssr = {
        poly: world.ssr.poly.map(coord => viewport.worldToScreen(coord)),
        angle: world.ssr.angle
      };
    }

    this.lod = 2;   // full detail (for now)
  }

}
