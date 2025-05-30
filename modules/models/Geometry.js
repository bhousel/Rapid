import { Extent, geomGetSmallestSurroundingRectangle, vecInterp } from '@rapid-sdk/math';
import { polygonHull, polygonCentroid } from 'd3-polygon';
import polylabel from '@mapbox/polylabel';


/**
 * Geometry
 * Wrapper for both original and projected geometry data.
 *
 * Previously this code lived in `PixiGeometry` where it applied only to rendered features,
 * and worked with screen coordinates.  Now it works with all features and with world coordinates.
 *
 * The geometry data should be passed to `setCoords()`
 *
 * Properties you can access:
 *   `type`          String describing what kind of geometry this is ('point', 'line', 'polygon')
 *   `origCoords`    Original coordinate data (in WGS84 lon/lat)
 *   `origExtent`    Original extent data (in WGS84 lon/lat)
 *   `coords`        Projected coordinate data
 *   `flatCoords`    Projected coordinate data, flat Array how Pixi wants it [ x,y, x,y, … ]
 *   `extent`        Projected extent
 *   `outer`         Projected outer ring, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `flatOuter`     Projected outer ring, flat Array how Pixi wants it [ x,y, x,y, … ]
 *   `holes`         Projected hole rings, Array of Array of coordinate pairs [ [ [x,y], [x,y], … ] ]
 *   `flatHoles`     Projected hole rings, Array of flat Array how Pixi wants it [ [ x,y, x,y, … ] ]
 *   `hull`          Projected convex hull, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `centroid`      Projected centroid, [x, y]
 *   `poi`           Projected pole of inaccessability, [x, y]
 *   `ssr`           Projected smallest surrounding rectangle data (angle, poly)
 */
export class Geometry {

  /**
   * @constructor
   * @param  {Context} context - Global shared application context
   */
  constructor(context) {
    this.type = null;    // 'point', 'line', or 'polygon'
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
   * clone
   * Returns a clone of this Geometry object
   * @return {Geometry}
   */
  clone() {
    const copy = new Geometry(this.context);

    copy.type = this.type;
    copy.dirty = this.dirty;

    // someday: check perf?  JSON.parse(JSON.stringify()) may still beat structuredClone for Array data
    copy.origCoords = globalThis.structuredClone(this.origCoords);
    copy.origExtent = new Extent(this.origExtent);

    copy.extent = new Extent(this.extent);
    copy.coords = globalThis.structuredClone(this.coords);
    copy.flatCoords = globalThis.structuredClone(this.flatCoords);
    copy.outer = globalThis.structuredClone(this.outer);
    copy.flatOuter = globalThis.structuredClone(this.flatOuter);
    copy.hull = globalThis.structuredClone(this.hull);
    copy.centroid = globalThis.structuredClone(this.centroid);
    copy.poi = globalThis.structuredClone(this.poi);
    copy.ssr = globalThis.structuredClone(this.ssr);
    copy.holes = globalThis.structuredClone(this.holes);
    copy.flatHoles = globalThis.structuredClone(this.flatHoles);

    return copy;
  }


  /**
   * reset
   * Remove all stored data
   */
  reset() {
    this.dirty = true;

    // Original data - These are in WGS84 coordinates
    // ([0,0] is Null Island)
    this.origCoords = null;     // coordinate data
    this.origExtent = null;     // extent (bounding box)

    // The rest of the data is projected data in world coordinates
    // ([0,0] is the top left corner of a 256x256 Web Mercator world)
    this.extent = null;      // extent (bounding box)
    this.coords = null;
    this.flatCoords = null;
    this.outer = null;
    this.flatOuter = null;
    this.holes = null;
    this.flatHoles = null;
    this.hull = null;        // convex hull
    this.centroid = null;    // centroid (center of mass / rotation)
    this.poi = null;         // pole of inaccessability
    this.ssr = null;         // smallest surrounding rectangle
  }


  /**
   * update
   */
  update() {
    if (!this.dirty || !this.origCoords) return;  // nothing to do

    const viewport = this.context.viewport;
    this.dirty = false;

    // reset all projected properties
    this.extent = null;
    this.coords = null;
    this.flatCoords = null;
    this.outer = null;
    this.flatOuter = null;
    this.holes = null;
    this.flatHoles = null;
    this.hull = null;
    this.centroid = null;
    this.poi = null;
    this.ssr = null;

    // Points are simple, just project once.
    if (this.type === 'point') {
      this.coords = viewport.wgs84ToWorld(this.origCoords);
      this.extent = new Extent(this.coords);
      this.centroid = this.coords;
      this.poi = this.coords;
      return;
    }

    // A line or a polygon.
    // Project the coordinate data..
    // Generate both normal coordinate rings and flattened rings at the same time to avoid extra iterations.
    // Preallocate Arrays to avoid garbage collection formerly caused by excessive Array.push()
    this.extent = new Extent();
    const origRings = (this.type === 'line') ? [this.origCoords] : this.origCoords;
    const projRings = new Array(origRings.length);
    const projFlatRings = new Array(origRings.length);

    for (let i = 0; i < origRings.length; i++) {
      const origRing = origRings[i];
      projRings[i] = new Array(origRing.length);
      projFlatRings[i] = new Array(origRing.length * 2);

      for (let j = 0; j < origRing.length; j++) {
        const xy = viewport.wgs84ToWorld(origRing[j]);
        projRings[i][j] = xy;
        projFlatRings[i][j * 2] = xy[0];
        projFlatRings[i][j * 2 + 1] = xy[1];

        if (i === 0) {  // the outer ring
          this.extent.extendSelf(xy);
        }
      }
    }

    // Assign outer and holes
    if (this.type === 'line') {
      this.coords = projRings[0];
      this.flatCoords = projFlatRings[0];
      this.outer = projRings[0];
      this.flatOuter = projFlatRings[0];
      this.holes = null;
      this.flatHoles = null;
    } else {  // polygon
      this.coords = projRings;
      this.flatCoords = projFlatRings;
      this.outer = projRings[0];
      this.flatOuter = projFlatRings[0];
      this.holes = projRings.slice(1);
      this.flatHoles = projFlatRings.slice(1);
    }

    // Calculate hull, centroid, poi, ssr if possible
    if (this.outer.length === 0) {          // no coordinates? - shouldn't happen
      // no-op

    } else if (this.outer.length === 1) {   // single coordinate? - wrong but can happen
      this.centroid = this.outer[0];
      this.poi = this.centroid;

    } else if (this.outer.length === 2) {   // 2 coordinate line
      this.centroid = vecInterp(this.outer[0], this.outer[1], 0.5);  // average the 2 points
      this.poi = this.centroid;

    } else {   // > 2 coordinates...
      // Convex Hull
      this.hull = polygonHull(this.outer);

      // Centroid
      if (this.hull.length === 2) {
        this.centroid = vecInterp(this.hull[0], this.hull[1], 0.5);  // average the 2 points
      } else {
        this.centroid = polygonCentroid(this.hull);
      }

      // Pole of Inaccessability (for polygons)
      if (this.type === 'line') {
        this.poi = this.centroid;
      } else {
        this.poi = polylabel(this.coords);   // it expects outer + rings
      }

      // Smallest Surrounding Rectangle
      this.ssr = geomGetSmallestSurroundingRectangle(this.hull);
    }
  }


  /**
   * setCoords
   * @param {Array<*>} data - Geometry `Array` (contents depends on the Feature type)
   *
   * 'point' - Single wgs84 coordinate
   *    [lon, lat]
   *
   * 'line' - Array of coordinates
   *    [ [lon, lat], [lon, lat],  … ]
   *
   * 'polygon' - Array of Arrays
   *    [
   *      [ [lon, lat], [lon, lat], … ],   // outer ring
   *      [ [lon, lat], [lon, lat], … ],   // inner rings
   *      …
   *    ]
   */
  setCoords(data) {
    let type = this._inferType(data);
    if (!type) return;  // do nothing if data is missing

if (type === 'multipolygon') {
  if (data.length > 1) { console.warn('todo: no proper support for true MultiPolygon yet'); }
  data = data[0];
  type = 'polygon';
}

    this.reset();
    this.type = type;
    this.origCoords = data;

    // Determine extent (bounds)
    if (type === 'point') {
      this.origExtent = new Extent(data);
    } else {
      this.origExtent = new Extent();
      const outer = (this.type === 'line') ? this.origCoords : this.origCoords[0];  // outer only
      for (const loc of outer) {
        this.origExtent.extendSelf(loc);
      }
    }

    this.dirty = true;
    this.update();
  }


  /**
   * _inferType
   * Determines what kind of geometry we were passed.
   * @param   {Array<*>}  arr - Geometry `Array` (contents depends on the Feature type)
   * @return  {string?}   'point', 'line', 'polygon' or null
   */
  _inferType(data) {
    const a = Array.isArray(data) && data[0];
    if (typeof a === 'number') return 'point';

    const b = Array.isArray(a) && a[0];
    if (typeof b === 'number') return 'line';

    const c = Array.isArray(b) && b[0];
    if (typeof c === 'number') return 'polygon';

const d = Array.isArray(c) && c[0];
if (typeof d === 'number') return 'multipolygon';

    return null;
  }

}
