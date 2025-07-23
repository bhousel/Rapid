import { Extent, geomGetSmallestSurroundingRectangle, vecInterp } from '@rapid-sdk/math';
import { polygonArea, polygonCentroid, polygonHull } from 'd3-polygon';
import polylabel from '@mapbox/polylabel';


/**
 * GeometryPart
 * Wrapper for both original and projected geometry data.
 * This class deals with singular geometry elements only: 'Point', 'LineString', 'Polygon'
 *
 * Previously this code lived in `PixiGeometry` where it applied only to rendered features,
 * and worked with screen coordinates.  Now it works with all data elements and with world coordinates.
 *
 * The geometry data should be passed to `setData()` as a GeoJSON geometry object.
 *
 * Properties you can access:
 *   `orig.geojson`   Original GeoJSON Geometry data (in WGS84 lon/lat)
 *   `orig.coords`    Original coordinate data (in WGS84 lon/lat)
 *   `orig.extent`    Original Extent bounding box (in WGS84 lon/lat)
 *   `world.coords`   Projected coordinate data
 *   `world.extent`   Projected Extent
 *   `world.outer`    Projected outer ring, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `world.hull`     Projected convex hull, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `world.centroid` Projected centroid, [x, y]
 *   `world.poi`      Projected pole of inaccessability, [x, y]
 *   `world.ssr`      Projected smallest surrounding rectangle data (angle, poly)
 */
export class GeometryPart {

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
   * Do not use the geometry part after calling `destroy()`.
   */
  destroy() {
    this.reset();
  }


  /**
   * reset
   * Remove all stored data
   */
  reset() {
    // Original data, in WGS84 coordinates
    // ([0,0] is Null Island)
    this.orig = null;

    // Projected data, in world coordinates
    // ([0,0] is the top left corner of a 256x256 Web Mercator world)
    this.world = null;
  }


  /**
   * clone
   * Returns a clone of this GeometryPart object
   * @return  {GeometryPart}  A new GeometryPart
   */
  clone() {
    const copy = new GeometryPart(this.context);

    for (const obj of ['orig', 'world']) {
      const src = this[obj];
      if (!src) continue;

      const dst = copy[obj] = {};
      for (const [k, v] of Object.entries(src)) {
        if (v instanceof Extent) {
          dst[k] = new Extent(v);
        } else {
          dst[k] = globalThis.structuredClone(v);
        }
      }
    }

    return copy;
  }


  /**
   * type
   * The original data format is GeoJSON, this is just a convenience getter.
   * @return  {string}  One of 'Point', 'LineString', 'Polygon'
   * @readonly
   */
  get type() {
    return this.orig?.geojson?.type;
  }


  /**
   * setData
   * This setter accepts singular GeoJSON Geometries only:  'Point', 'LineString', and 'Polygon'
   * If there is any existing data, it is first removed.
   * @param  {Object}  geojson - GeoJSON geometry data
   */
  setData(geojson = {}) {
    this.destroy();

    const type = geojson.type;
    const coords = geojson.coordinates;
    if (!(/^(Point|LineString|Polygon)$/.test(type)) || !coords) return;  // do nothing

    const orig = this.orig = {};
    orig.geojson = globalThis.structuredClone(geojson);
    orig.coords = orig.geojson.coordinates;

    // Determine extent (bounds)
    if (type === 'Point') {
      orig.extent = new Extent(coords);
    } else {
      orig.extent = new Extent();
      const outer = (type === 'LineString') ? coords : coords[0];  // outer only
      for (const loc of outer) {
        orig.extent.extendSelf(loc);
      }
    }

    this.updateWorld();
  }


  /**
   * updateWorld
   * This projects original source data in WGS84 coordinates.
   */
  updateWorld() {
    if (!this.orig || this.world) return;  // can't do it, or done already

    const viewport = this.context.viewport;
    const origCoords = this.orig.coords;
    const type = this.type;

    // Reset all projected properties
    const world = this.world = {};

    // Points are simple, just project once.
    if (type === 'Point') {
      world.coords = viewport.wgs84ToWorld(origCoords);
      world.extent = new Extent(world.coords);
      world.centroid = world.coords;
      world.poi = world.coords;
      return;
    }

    // A line or a polygon.
    // Project the coordinate data..
    // Preallocate Arrays to avoid garbage collection formerly caused by excessive Array.push()
    world.extent = new Extent();
    const origRings = (type === 'LineString') ? [origCoords] : origCoords;
    const projRings = new Array(origRings.length);

    for (let i = 0; i < origRings.length; i++) {
      const origRing = origRings[i];
      projRings[i] = new Array(origRing.length);

      for (let j = 0; j < origRing.length; j++) {
        const xy = viewport.wgs84ToWorld(origRing[j]);
        projRings[i][j] = xy;

        if (i === 0) {  // the outer ring
          world.extent.extendSelf(xy);
        }
      }
    }

    if (type === 'LineString') {
      world.coords = projRings[0];
      world.outer = projRings[0];
    } else {   // Polygon
      world.coords = projRings;
      world.outer = projRings[0];
    }

    // Calculate hull, centroid, poi, ssr if possible
    if (world.outer.length === 0) {          // no coordinates? - shouldn't happen
      // no-op

    } else if (world.outer.length === 1) {   // single coordinate? - wrong but can happen
      world.centroid = world.outer[0];
      world.poi = world.centroid;

    } else if (world.outer.length === 2) {   // 2 coordinate line
      world.centroid = vecInterp(world.outer[0], world.outer[1], 0.5);  // average the 2 points
      world.poi = world.centroid;

    } else {   // > 2 coordinates...

      // check area/winding?
      world.area = polygonArea(world.outer);
      // if (world.area < 0) {
      //   world.area *= -1;
      //   world.outer.reverse();
      // }

      // Convex Hull
      world.hull = polygonHull(world.outer);

      // Centroid
      if (world.hull.length === 2) {
        world.centroid = vecInterp(world.hull[0], world.hull[1], 0.5);  // average the 2 points
      } else {
        world.centroid = polygonCentroid(world.hull);
      }

      // Pole of Inaccessability (for polygons)
      if (type === 'LineString') {
        world.poi = world.centroid;
      } else {
        world.poi = polylabel(world.coords);   // it expects outer + rings
      }

      // Smallest Surrounding Rectangle
      world.ssr = geomGetSmallestSurroundingRectangle(world.hull);
    }
  }

}
