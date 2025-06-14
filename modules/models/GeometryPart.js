import { Extent, geomGetSmallestSurroundingRectangle, vecInterp } from '@rapid-sdk/math';
import { polygonHull, polygonCentroid } from 'd3-polygon';
import polylabel from '@mapbox/polylabel';


/**
 * GeometryPart
 * Wrapper for both original and projected geometry data.
 * This class deals with singular elements only: 'Point', 'LineString', 'Polygon'
 *
 * Previously this code lived in `PixiGeometry` where it applied only to rendered features,
 * and worked with screen coordinates.  Now it works with all features and with world coordinates.
 *
 * The geometry data should be passed to `setData()` as a GeoJSON geometry object.
 *
 * Properties you can access:
 *   `origData`      Original GeoJSON data (in WGS84 lon/lat)
 *   `origCoords`    Original coordinate data (in WGS84 lon/lat)
 *   `origExtent`    Original Extent bounding box (in WGS84 lon/lat)
 *   `coords`        Projected coordinate data
 *   `extent`        Projected extent
 *   `outer`         Projected outer ring, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `holes`         Projected hole rings, Array of Array of coordinate pairs [ [ [x,y], [x,y], … ] ]
 *   `hull`          Projected convex hull, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `centroid`      Projected centroid, [x, y]
 *   `poi`           Projected pole of inaccessability, [x, y]
 *   `ssr`           Projected smallest surrounding rectangle data (angle, poly)
 */
export class GeometryPart {

  /**
   * @constructor
   * @param  {AbstractData} feature - The data feature that owns this GeometryPart
   */
  constructor(feature) {
    this.feature = feature;
    this.context = feature.context;
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
   * clone
   * Returns a clone of this GeometryPart object
   * @param  {AbstractData} feature - The data feature that will own the clone GeometryPart
   * @return {GeometryPart}
   */
  clone() {
    const copy = new GeometryPart(this.feature);

    copy.dirty = this.dirty;

    // someday: check perf?  JSON.parse(JSON.stringify()) may still beat structuredClone for Array data
    copy.origData = globalThis.structuredClone(this.origData);
    copy.origExtent = new Extent(this.origExtent);

    copy.extent = new Extent(this.extent);
    copy.coords = globalThis.structuredClone(this.coords);
    copy.outer = globalThis.structuredClone(this.outer);
    copy.hull = globalThis.structuredClone(this.hull);
    copy.centroid = globalThis.structuredClone(this.centroid);
    copy.poi = globalThis.structuredClone(this.poi);
    copy.ssr = globalThis.structuredClone(this.ssr);
    copy.holes = globalThis.structuredClone(this.holes);

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
    this.origData = null;    // GeoJSON data
    this.origExtent = null;  // extent (bounding box)

    // The rest of the data is projected data in world coordinates
    // ([0,0] is the top left corner of a 256x256 Web Mercator world)
    this.extent = null;      // extent (bounding box)
    this.coords = null;
    this.outer = null;
    this.holes = null;
    this.hull = null;        // convex hull
    this.centroid = null;    // centroid (center of mass / rotation)
    this.poi = null;         // pole of inaccessability
    this.ssr = null;         // smallest surrounding rectangle
  }


  /**
   * update
   */
  update() {
    if (!this.dirty || !this.origData?.coordinates) return;  // nothing to do

    const viewport = this.context.viewport;
    const origCoords = this.origData.coordinates;
    this.dirty = false;

    // reset all projected properties
    this.extent = null;
    this.coords = null;
    this.outer = null;
    this.holes = null;
    this.hull = null;
    this.centroid = null;
    this.poi = null;
    this.ssr = null;

    // Points are simple, just project once.
    if (this.type === 'Point') {
      this.coords = viewport.wgs84ToWorld(origCoords);
      this.extent = new Extent(this.coords);
      this.centroid = this.coords;
      this.poi = this.coords;
      return;
    }

    // A line or a polygon.
    // Project the coordinate data..
    // Preallocate Arrays to avoid garbage collection formerly caused by excessive Array.push()
    this.extent = new Extent();
    const origRings = (this.type === 'LineString') ? [origCoords] : origCoords;
    const projRings = new Array(origRings.length);

    for (let i = 0; i < origRings.length; i++) {
      const origRing = origRings[i];
      projRings[i] = new Array(origRing.length);

      for (let j = 0; j < origRing.length; j++) {
        const xy = viewport.wgs84ToWorld(origRing[j]);
        projRings[i][j] = xy;

        if (i === 0) {  // the outer ring
          this.extent.extendSelf(xy);
        }
      }
    }

    // Assign outer and holes
    if (this.type === 'LineString') {
      this.coords = projRings[0];
      this.outer = projRings[0];
      this.holes = null;
    } else {  // polygon
      this.coords = projRings;
      this.outer = projRings[0];
      this.holes = projRings.slice(1);
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
      if (this.type === 'LineString') {
        this.poi = this.centroid;
      } else {
        this.poi = polylabel(this.coords);   // it expects outer + rings
      }

      // Smallest Surrounding Rectangle
      this.ssr = geomGetSmallestSurroundingRectangle(this.hull);
    }
  }


  /**
   * geojson
   * The original data format is GeoJSON, this is just a convenience getter.
   * @return {GeoJSON}
   * @readonly
   */
  get geojson() {
    return this.origData;
  }

  /**
   * origCoords
   * The original data format is GeoJSON, this is just a convenience getter.
   * @return {Array<*>}
   * @readonly
   */
  get origCoords() {
    return this.origData?.coordinates;
  }

  /**
   * type
   * The original data format is GeoJSON, this is just a convenience getter.
   * @return {string} One of 'Point', 'LineString', 'Polygon'
   * @readonly
   */
  get type() {
    return this.origData?.type;
  }


  /**
   * setData
   * This setter accepts singular GeoJSON geometries only:  'Point', 'LineString', and 'Polygon'
   * If there is any existing data, it is first removed.
   * @param {GeoJSON} geojson - GeoJSON data
   */
  setData(geojson = {}) {
    this.destroy();
    this.origData = globalThis.structuredClone(geojson);

    const type = geojson.type;
    const coords = geojson.coordinates;
    if (!(/^(Point|LineString|Polygon)$/.test(type)) || !coords) return;  // do nothing

    // Determine extent (bounds)
    if (type === 'Point') {
      this.origExtent = new Extent(coords);
    } else {
      this.origExtent = new Extent();
      const outer = (this.type === 'LineString') ? coords : coords[0];  // outer only
      for (const loc of outer) {
        this.origExtent.extendSelf(loc);
      }
    }

    this.dirty = true;
    this.update();
  }

}
