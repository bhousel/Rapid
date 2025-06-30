import { Extent } from '@rapid-sdk/math';

import { GeometryPart } from './GeometryPart.js';


/**
 * Geometry
 * Wrapper for both original and projected geometry data.
 * This class wraps `0..n` multiple GeometryPart elements in a collection.
 *
 * The geometry data should be passed to `setData()` as a GeoJSON object.
 *
 * Properties you can access:
 *   `orig.extent`    Original Extent bounding box (in WGS84 lon/lat)
 *   `world.extent`   Projected Extent
 *   `parts`          Array of GeometryParts
 */
export class Geometry {

  /**
   * @constructor
   * @param  {Context}  context - Global shared application context
   */
  constructor(context) {
    this.context = context;

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

    for (const part of this.parts) {
      part.reset();
    }
  }


  /**
   * clone
   * Returns a clone of this Geometry object
   * It clones both the calculated extents as well as the GeometryParts in the collection.
   * @return  {Geometry}
   */
  clone() {
    const copy = new Geometry(this.context);

    for (const obj of ['orig', 'world']) {
      const src = this[obj];
      if (!src) continue;

      for (const [k, v] of Object.entries(src)) {
        if (v instanceof Extent) {
          copy[k] = new Extent(v);
        } else {
          copy[k] = globalThis.structuredClone(v);
        }
      }
    }

    for (const part of this.parts) {
      copy.parts.push(part.clone(this.context));
    }

    return copy;
  }


  /**
   * setData
   * This method can accept all types of GeoJSON data.
   * It will automatically break multitypes and collections into parts
   *  and create separate GeometryPart elements for each part.
   * If there is any existing data, it is first removed.
   * @param  {GeoJSON}  geojson - source GeoJSON data
   */
  setData(geojson) {
    this.destroy();

    const geojsonParts = this._geojsonToParts(geojson);
    if (!geojsonParts.length) return; // do nothing if we found no usable parts

    const origExtent = new Extent();
    const worldExtent = new Extent();
    let isValid = false;

    for (const geojsonPart of geojsonParts) {
      const part = new GeometryPart(this.context);
      part.setData(geojsonPart);
      if (!part.orig || !part.world) continue;  // if the GeometryPart was invalid, skip it

      this.parts.push(part);
      origExtent.extendSelf(part.orig.extent);
      worldExtent.extendSelf(part.world.extent);
      isValid = true;
    }

    if (isValid) {   // At least one part was found to be valid
      this.orig  = { extent: origExtent };
      this.world = { extent: worldExtent };
    }
  }


  /**
   * _geojsonToParts
   * Break arbitrary GeoJSON into Geometry parts.
   * This will recurse down through the collection types if needed.
   * @return  {Array<Object>}  An array of singular GeoJSON geometries
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
