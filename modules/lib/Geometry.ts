import { Extent } from '@rapid-sdk/math';
import { GeometryPart } from './GeometryPart.ts';

import type { Context } from '../Context.ts';
import type {
  GeoJSONObject,
  GeometryOrigData,
  GeometryWorldData,
  SingularGeometry
} from './types.ts';


/**
 * A `Geometry` is a wrapper for both original and projected geometry data.
 * This class wraps `0..n` multiple `GeometryPart` elements in a collection.
 *
 * The geometry data should be passed to `setData()` as a GeoJSON object.
 *
 * Properties you can access:
 *   `orig.extent`    Original Extent bounding box (in WGS84 lon/lat)
 *   `world.extent`   Projected Extent
 *   `parts`          Array of GeometryParts
 */
export class Geometry {
  context: Context;
  /** Array of GeometryPart elements */
  parts: GeometryPart[];
  /** Original data, in WGS84 coordinates ([0,0] is Null Island) */
  orig: GeometryOrigData | null;
  /** Projected data, in world coordinates ([0,0] is the top left corner of a 256x256 Web Mercator world) */
  world: GeometryWorldData | null;

  /**
   * @constructor
   * @param  context - Global shared application context
   */
  constructor(context: Context) {
    this.context = context;
    this.parts = [];
    this.orig = null;
    this.world = null;
  }


  /**
   * Release memory.
   * Do not use the geometry after calling `destroy()`.
   */
  destroy(): void {
    this.reset();
    this.context = null!;
  }


  /**
   * Remove all stored data
   */
  reset(): void {
    this.orig = null;
    this.world = null;

    for (const part of this.parts) {
      part.reset();
    }
    this.parts = [];
  }


  /**
   * Returns a clone of this Geometry object
   * It clones both the calculated extents as well as the GeometryParts in the collection.
   * @return  A new Geometry
   */
  clone(): Geometry {
    const copy = new Geometry(this.context);
    for (const obj of ['orig', 'world'] as const) {
      const src = this[obj];
      if (!src) continue;

      const dst: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) {
        if (v instanceof Extent) {
          dst[k] = new Extent(v);
        /* c8 ignore start */
        } else {
          dst[k] = structuredClone(v);
        /* c8 ignore end */
        }
      }
      if (obj === 'orig') {
        copy.orig = dst as unknown as GeometryOrigData;
      } else {
        copy.world = dst as unknown as GeometryWorldData;
      }
    }

    for (const part of this.parts) {
      copy.parts.push(part.clone());
    }

    return copy;
  }


  /**
   * This method can accept all types of GeoJSON data.
   * It will automatically break multitypes and collections into parts
   *  and create separate GeometryPart elements for each part.
   * If there is any existing data, it is first removed.
   * @param  geojson - source GeoJSON data
   */
  setData(geojson: Partial<GeoJSONObject> = {}): void {
    this.reset();

    const geojsonParts = this._geojsonToParts(geojson as GeoJSONObject);
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
   * Break arbitrary GeoJSON into Geometry parts.
   * This will recurse down through the collection types if needed.
   * @param   geojson - source GeoJSON data
   * @param   parts - collected GeoJSON single geometry parts (Point, LineString, or Polygon)
   * @param   depth - recursion depth
   * @return  An array of singular GeoJSON geometries
   */
  private _geojsonToParts(
    geojson: GeoJSONObject | undefined,
    parts: SingularGeometry[] = [],
    depth: number = 0
  ): SingularGeometry[] {
    if (!geojson?.type) return parts;
    if (depth > 4) return parts;  // limit recursion

    if (geojson.type === 'Feature') {
      this._geojsonToParts(geojson.geometry as GeoJSONObject | undefined, parts, depth + 1);

    } else if (geojson.type === 'FeatureCollection') {
      for (const feature of (geojson.features ?? [])) {
        this._geojsonToParts(feature as GeoJSONObject, parts, depth + 1);
      }

    } else if (geojson.type === 'GeometryCollection') {
      for (const geometry of (geojson.geometries ?? [])) {
        this._geojsonToParts(geometry as GeoJSONObject, parts, depth + 1);
      }

    } else if (geojson.type === 'MultiPoint') {
      for (const coords of (geojson.coordinates ?? [])) {
        parts.push({ type: 'Point', coordinates: coords });
      }

    } else if (geojson.type === 'MultiLineString') {
      for (const coords of (geojson.coordinates ?? [])) {
        parts.push({ type: 'LineString', coordinates: coords });
      }

    } else if (geojson.type === 'MultiPolygon') {
      for (const coords of (geojson.coordinates ?? [])) {
        parts.push({ type: 'Polygon', coordinates: coords });
      }

    } else if (/^(Point|LineString|Polygon)$/.test(geojson.type)) {
      parts.push(geojson as SingularGeometry);  // singular geometry parts are what we want
    }

    return parts;
  }

}
