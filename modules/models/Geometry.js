import { Extent } from '@rapid-sdk/math';

import { GeometryPart } from './GeometryPart.js';


/**
 * Geometry
 * Wrapper for both original and projected geometry data.
 * This class wraps `0..n` multiple Geometry elements in a collection.
 *
 * The geometry data should be passed to `setData()` as a GeoJSON object.
 *
 * Properties you can access:
 *   `origData`      Original GeoJSON data (in WGS84 lon/lat)
 *   `origExtent`    Original Extent bounding box (in WGS84 lon/lat)
 *   `extent`        Projected extent (in world coordinates x/y)
 *   `parts`         Array of GeometryParts
 */
export class Geometry {

  /**
   * @constructor
   * @param  {AbstractData} feature - The data feature that owns this Geometry
   */
  constructor(feature) {
    this.feature = feature;
    this.context = feature.context;

    this.parts = [];  // Array<GeometryPart>
    this.reset();
  }


  /**
   * destroy
   * Release memory.
   * Do not use the geometry after calling `destroy()`.
   */
  destroy() {
    this.reset();
    this.parts = [];
  }


  /**
   * clone
   * Returns a clone of this Geometry object
   * It clones both the calculated extents as well as the Geometries in the collection.
   * @param  {AbstractData} feature - The data feature that will own the clone Geometry
   * @return {Geometry}
   */
  clone(feature) {
    const copy = new Geometry(feature);

    copy.dirty = this.dirty;

    // someday: check perf?  JSON.parse(JSON.stringify()) may still beat structuredClone for Array data
    copy.origData = globalThis.structuredClone(this.origData);
    copy.origExtent = new Extent(this.origExtent);
    copy.extent = new Extent(this.extent);

    for (const part of this.parts) {
      copy.parts.push(part.clone(this.context));
    }

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

    // Projected data - These are in world coordinates
    // ([0,0] is the top left corner of a 256x256 Web Mercator world)
    this.extent = null;      // extent (bounding box)

    for (const part of this.parts) {
      part.reset();
    }
  }


  /**
   * setData
   * This setter can accept all types of GeoJSON data.
   * It will automatically break multitypes and collections into parts
   *  and create separate GeometryPart elements for each part.
   * If there is any existing data, it is first removed.
   * @param {GeoJSON} geojson - GeoJSON data
   */
  setData(geojson) {
    this.destroy();

    this.origData = globalThis.structuredClone(geojson);
    const geojsonParts = this._geojsonToParts(geojson);
    if (!geojsonParts.length) return; // do nothing if we found no usable parts

    const origExtent = new Extent();
    const extent = new Extent();
    let isValid = false;

    for (const geojsonPart of geojsonParts) {
      const part = new GeometryPart(this.feature);
      part.setData(geojsonPart);
      if (part.dirty) continue;  // if the GeometryPart was invalid, skip it

      this.parts.push(part);
      origExtent.extendSelf(part.origExtent);
      extent.extendSelf(part.extent);
      isValid = true;
    }

    if (isValid) {   // at least one part is valid
      this.origExtent = origExtent;
      this.extent = extent;
      this.dirty = false;
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
   * _geojsonToParts
   * Break arbitrary GeoJSON into Geometry parts.
   * This will recurse down through the collection types if needed.
   * @return {Array<GeoJSON>}  An array of singular GeoJSON geometries
   */
  _geojsonToParts(geojson = {}, parts = [], depth = 0) {
    if (depth > 4) return;  // limit recursion

    if (geojson.type === 'Feature') {
      this._geojsonToParts(geojson.geometry, parts, depth + 1);

    } else if (geojson.type === 'FeatureCollection') {
      for (const feature of (geojson.features || [])) {
        this._geojsonToParts(feature, parts, depth + 1);
      }

    } else if (geojson.type === 'GeometryCollection') {
      for (const geometry of (geojson.geometries || [])) {
        this._geojsonToParts(geometry, parts, depth + 1);
      }

    } else if (geojson.type === 'MultiPoint') {
      for (const coords of (geojson.coordinates || [])) {
        parts.push({ type: 'Point', coordinates: coords });
      }

    } else if (geojson.type === 'MultiLineString') {
      for (const coords of (geojson.coordinates || [])) {
        parts.push({ type: 'LineString', coordinates: coords });
      }

    } else if (geojson.type === 'MultiPolygon') {
      for (const coords of (geojson.coordinates || [])) {
        parts.push({ type: 'Polygon', coordinates: coords });
      }

    } else if (/^(Point|LineString|Polygon)$/.test(geojson.type)) {
      parts.push(geojson);  // singular geometry parts are what we want
    }

    return parts;
  }

}
