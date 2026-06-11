import { Extent, geomGetDominantSurroundingRectangle, geomToOrigin, projWgs84ToWorld, vecAdd, vecInterp } from '@rapid-sdk/math';
import { polygonCentroid, polygonHull } from 'd3-polygon';
import polylabel from '@mapbox/polylabel';

import type { Context } from '../Context.ts';
import type { SurroundingRectangle, Vec2 } from '@rapid-sdk/math';
import type { SingularGeometry, SingularGeometryType } from './types.ts';


/**
 * Wraps a producer function so it runs once on first call and caches the result.
 * Used to defer `GeometryPart` derived products (hull, centroid, poi, …) until
 * something actually reads them — most geometries are never rendered or conflated,
 * so this saves both memory and CPU on large datasets.
 * @param  fn - The producer to memoize
 * @return A zero-arg function that computes once and returns the cached value
 */
function lazyValue<T>(fn: () => T): () => T {
  let computed = false;
  let value: T;
  return (): T => {
    if (!computed) {
      value = fn();
      computed = true;
    }
    return value;
  };
}

/**
 * Defines enumerable lazy getter properties on a frame object (`world` / `local`).
 * Each getter computes its value on first access via the supplied memoized function.
 * @param  obj - The frame object to attach getters to
 * @param  getters - Map of property name to a memoized producer function
 */
function defineLazyProps(obj: object, getters: Record<string, () => unknown>): void {
  for (const key in getters) {
    Object.defineProperty(obj, key, { enumerable: true, configurable: true, get: getters[key] });
  }
}


/** Original data, in WGS84 coordinates (longitude, latitude - [0,0] is Null Island) */
export interface GeometryPartOrigData {
  /** GeoJSON Type - must be 'Point', 'LineString', or 'Polygon' */
  geojson: SingularGeometry;
  /** Original GeoJSON coordinates */
  coords: GeoJSON.Position | GeoJSON.Position[] | GeoJSON.Position[][];
  /** Original Extent */
  extent: Extent;
}

/** Projected data, in "world coordinates" (EPSG:3857, prescaled to z16, range 0..16,777,216) */
export interface GeometryPartWorldData {
  /** World coordinates */
  coords: Vec2 | Vec2[] | Vec2[][];
  /** World extent */
  extent: Extent;
  /** World origin point (arbitrary, but we use `world.extent.center`) */
  origin?: Vec2;
  /** For Polygon, the outer ring; for LineString, just the coordinate array */
  outer?: Vec2[];
  /** Computed Convex hull */
  hull?: Vec2[];
  /** Computed Centroid */
  centroid?: Vec2;
  /** Computed Pole of Inaccessability (useful for label placement) */
  poi?: Vec2;
  /** Computed area (unsigned magnitude) */
  area?: number;
  /** Winding direction of the outer ring: +1 = CCW, -1 = CW (in y-up math space) */
  winding?: 1 | -1;
  /** Computed surrounding rectangle */
  surround?: SurroundingRectangle;
}

/** Local coordinate data (also EPSG:3857, but relative to `world.origin`) */
export interface GeometryPartLocalData {
  /** Local coordinates */
  coords: Vec2 | Vec2[] | Vec2[][];
  /** Local extent */
  extent: Extent;
  /** For Polygon, the outer ring; for LineString, just the coordinate array */
  outer?: Vec2[];
  /** Flattened coordinate data (Pixi prefers this) */
  flat?: number[][];
  /** Local convex hull */
  hull?: Vec2[];
  /** Local centroid */
  centroid?: Vec2;
  /** Local Pole of Inaccessability (useful for label placement) */
  poi?: Vec2;
  /** Local area (unsigned magnitude) */
  area?: number;
  /** Winding direction of the outer ring: +1 = CCW, -1 = CW (in y-up math space) */
  winding?: 1 | -1;
  /** Local surrounding rectangle */
  surround?: SurroundingRectangle;
}


/**
 * A `GeometryPart` is a wrapper for both original and projected geometry data.
 * The geometry data should be passed to `setData()` as a singular GeoJSON geometry object.
 * This class deals with singular geometry elements only: 'Point', 'LineString', 'Polygon'.
 *
 * Properties available:
 * - `orig`    Original GeoJSON Geometry data (in WGS84 lon,lat)
 * - `world`   Projected world coordinate data (world z16, range 0..16,777,216)
 * - `local`   Projected local coordinate data (relative to `world.origin`)
 */
export class GeometryPart {

  /** Global shared application context */
  public context: Context;
  /** Original data, in WGS84 coordinates (longitude, latitude - [0,0] is Null Island) */
  public orig: GeometryPartOrigData | null;
  /** Projected data, in "world coordinates" (EPSG:3857, prescaled to z16, range 0..16,777,216) */
  public world: GeometryPartWorldData | null;
  /** Local coordinate data (also EPSG:3857, but relative to `world.origin`) */
  public local: GeometryPartLocalData | null;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.orig = null;
    this.world = null;
    this.local = null;
  }


  /**
   * Release memory.
   * Do not use the geometry part after calling `destroy()`.
   */
  public destroy(): void {
    this.reset();
    this.context = null!;
  }


  /**
   * Remove all stored data
   */
  public reset(): void {
    this.orig = null;
    this.world = null;
    this.local = null;
  }


  /**
   * Returns a clone of this GeometryPart object.
   * Re-derives the projected frames from the original GeoJSON rather than deep-copying
   * the computed caches — this is cheap (the derived products are lazy and won't be
   * recomputed until accessed) and avoids copying potentially large coordinate arrays.
   * @return  A new GeometryPart
   */
  public clone(): GeometryPart {
    const copy = new GeometryPart(this.context);
    if (this.orig) {
      copy.setData(this.orig.geojson);
    }
    return copy;
  }


  /**
   * The original data format is GeoJSON, this is just a convenience getter.
   * @return  One of 'Point', 'LineString', 'Polygon'
   * @readonly
   */
  public get type(): SingularGeometryType | undefined {
    return this.orig?.geojson?.type;
  }


  /**
   * This setter accepts singular GeoJSON Geometries only:  'Point', 'LineString', and 'Polygon'
   * If there is any existing data, it is first removed.
   * @param  geojson - GeoJSON geometry data
   */
  public setData(geojson: Partial<SingularGeometry> = {}): void {
    this.reset();

    const type = geojson.type;
    const coords = geojson.coordinates;
    if (!(/^(Point|LineString|Polygon)$/.test(type ?? '')) || !coords) return;  // do nothing

    // Clone the original geojson
    const orig = {
      geojson: structuredClone(geojson)
    } as Partial<GeometryPartOrigData>;

    orig.coords = orig.geojson!.coordinates;

    // Determine extent (bounds)
    if (type === 'Point') {
      orig.extent = new Extent(coords as Vec2);
    } else {
      orig.extent = new Extent();
      const outer = (type === 'LineString') ? coords as Vec2[] : (coords as Vec2[][])[0];  // outer only
      for (const loc of outer) {
        orig.extent.extendSelf(loc);
      }
    }

    this.orig = orig as GeometryPartOrigData;
    this.update();
  }


  /**
   * This converts original source data from WGS84 coordinates to world coordinates,
   * computing `world` and `local` caches and supporting geometry data structures.
   */
  public update(): void {
    if (!this.orig || this.world) return;  // can't do it, or done already

    const origCoords = this.orig.coords;
    const type = this.type;

    // Points are simple - project a single point.
    if (type === 'Point') {
      const coords = projWgs84ToWorld(origCoords as Vec2);
      // `origin`, `centroid`, and `poi` for the point is just the point itself.
      this.world = {
        coords,
        extent: new Extent(coords),
        origin: coords,
        centroid: coords,
        poi: coords
      };
      // Points don't have a meaningful "local" coordinate system.
      this.local = {
        coords: [0, 0],
        extent: new Extent([0, 0]),
        centroid: [0, 0],
        poi: [0, 0]
      };
      return;
    }

    // LineString or Polygon
    // Project from original coordinates to "world" coordinates.
    const origRings = (type === 'LineString') ? [origCoords as Vec2[]] : origCoords as Vec2[][];
    const worldExtent = new Extent();
    const worldRings: Vec2[][] = new Array(origRings.length);

    for (let i = 0; i < origRings.length; i++) {
      const origRing = origRings[i];
      worldRings[i] = new Array(origRing.length);

      for (let j = 0; j < origRing.length; j++) {
        const xy = projWgs84ToWorld(origRing[j]) as Vec2;
        worldRings[i][j] = xy;

        if (i === 0) {  // the outer ring
          worldExtent.extendSelf(xy);
        }
      }
    }

    // Choose extent center as the "origin" point.
    const worldOrigin = worldExtent.center();

    // Compute "local" coordinates by translating world coordinates relative to origin.
    const localExtent = new Extent();
    const localRings: Vec2[][] = new Array(worldRings.length);

    for (let i = 0; i < worldRings.length; i++) {
      const worldRing = worldRings[i];
      localRings[i] = new Array(worldRing.length);

      for (let j = 0; j < worldRing.length; j++) {
        const xy: Vec2 = [
          worldRing[j][0] - worldOrigin[0],
          worldRing[j][1] - worldOrigin[1]
        ];
        localRings[i][j] = xy;

        if (i === 0) {  // the outer ring
          localExtent.extendSelf(xy);
        }
      }
    }

    // Core (eager) frame data — cheap projection that every consumer needs.
    const world: GeometryPartWorldData = {
      coords: (type === 'LineString') ? worldRings[0] : worldRings,
      extent: worldExtent,
      origin: worldOrigin,
      outer: worldRings[0]
    };
    const local: GeometryPartLocalData = {
      coords: (type === 'LineString') ? localRings[0] : localRings,
      extent: localExtent,
      outer: localRings[0]
    };

    //
    // Derived products are computed lazily on first access.
    // Most geometries are never rendered or conflated,
    // so deferring these saves memory and CPU on large datasets.
    //
    // Prefer to perform the computations in local space to reduce floating point errors,
    // then translate local results back to world space with `vecAdd` or `geomToOrigin`.
    //
    const outer = local.outer!;
    const outerLen = outer.length;

    // Shoelace sum on the local outer ring (shared by area + winding).
    // The sign convention is the mathematical y-up one: positive = CCW.
    // (Note that d3-polygon's polygonArea() flips this for screen-space y-down,
    // we avoid it so callers don't have to reason about coordinate handedness.)
    const shoelace = lazyValue<number>(() => {
      let s2 = 0;
      for (let i = 0, m = outer.length; i < m; i++) {
        const [x0, y0] = outer[i];
        const [x1, y1] = outer[(i + 1) % m];
        s2 += x0 * y1 - x1 * y0;
      }
      return s2;
    });

    // Area is translation-invariant, so local.area === world.area.
    const areaFn = lazyValue<number | undefined>(() => {
      if (outerLen === 0) return undefined;       // no coordinates? - shouldn't happen
      if (outerLen <= 2) return 0;                // single coordinate or 2 coordinate line
      return Math.abs(shoelace()) / 2;
    });

    // Winding direction of the outer ring: +1 = CCW, -1 = CW (in y-up math space).
    const windingFn = lazyValue<1 | -1 | undefined>(() => {
      if (outerLen <= 2) return undefined;        // only meaningful for rings
      return shoelace() >= 0 ? 1 : -1;
    });

    // Convex hull (local), and the same hull translated back to world space.
    const localHullFn = lazyValue<Vec2[] | undefined>(() => {
      if (outerLen <= 2) return undefined;
      return (polygonHull(outer) as Vec2[] | null) ?? undefined;
    });
    const worldHullFn = lazyValue<Vec2[] | undefined>(() => {
      const hull = localHullFn();
      return hull ? geomToOrigin(hull, worldOrigin) : undefined;
    });

    // Centroid (computed from the hull for numerical stability).
    const localCentroidFn = lazyValue<Vec2 | undefined>(() => {
      if (outerLen === 0) return undefined;
      if (outerLen === 1) return outer[0];
      if (outerLen === 2) return vecInterp(outer[0], outer[1], 0.5);  // average the 2 points
      const hull = localHullFn();
      if (!hull) return undefined;
      if (hull.length === 2) return vecInterp(hull[0], hull[1], 0.5);  // average the 2 points
      return polygonCentroid(hull) as Vec2;
    });
    const worldCentroidFn = lazyValue<Vec2 | undefined>(() => {
      if (outerLen === 1) return world.outer![0];
      const centroid = localCentroidFn();
      return centroid ? vecAdd(centroid, worldOrigin) : undefined;
    });

    // Pole of Inaccessability (useful for label placement).
    // Polygons use polylabel; lines and degenerate rings fall back to the centroid.
    const localPoiFn = lazyValue<Vec2 | undefined>(() => {
      if (outerLen <= 2 || type === 'LineString') return localCentroidFn();
      return polylabel(local.coords as Vec2[][]) as Vec2;   // it expects outer + rings
    });
    const worldPoiFn = lazyValue<Vec2 | undefined>(() => {
      if (outerLen <= 2 || type === 'LineString') return worldCentroidFn();
      const poi = localPoiFn();
      return poi ? vecAdd(poi, worldOrigin) : undefined;
    });

    // Flattened coordinate data (Pixi prefers this) - one flat array per ring.
    const flatFn = lazyValue<number[][]>(() => {
      const flatRings: number[][] = new Array(localRings.length);
      for (let i = 0; i < localRings.length; i++) {
        const ring = localRings[i];
        const flat: number[] = new Array(ring.length * 2);
        for (let j = 0; j < ring.length; j++) {
          flat[j * 2] = ring[j][0];
          flat[j * 2 + 1] = ring[j][1];
        }
        flatRings[i] = flat;
      }
      return flatRings;
    });

    // Surrounding rectangle (only meaningful for rings).
    const localSurroundFn = lazyValue<SurroundingRectangle | undefined>(() => {
      if (outerLen <= 2) return undefined;
      return geomGetDominantSurroundingRectangle(outer) ?? undefined;
    });
    const worldSurroundFn = lazyValue<SurroundingRectangle | undefined>(() => {
      const surround = localSurroundFn();
      if (!surround) return undefined;
      return {
        polygon:     geomToOrigin(surround.polygon, worldOrigin),
        angle:       surround.angle,
        centroid:    vecAdd(surround.centroid, worldOrigin),
        dimensions:  surround.dimensions.slice() as Vec2,   // copy, dimensions are the same
        shortAxis:   geomToOrigin(surround.shortAxis, worldOrigin),
        longAxis:    geomToOrigin(surround.longAxis, worldOrigin)
      };
    });

    // Area and winding are translation-invariant, so the same functions back both frames.
    defineLazyProps(local, {
      hull:      localHullFn,
      centroid:  localCentroidFn,
      poi:       localPoiFn,
      area:      areaFn,
      winding:   windingFn,
      surround:  localSurroundFn,
      flat:      flatFn
    });
    defineLazyProps(world, {
      hull:      worldHullFn,
      centroid:  worldCentroidFn,
      poi:       worldPoiFn,
      area:      areaFn,
      winding:   windingFn,
      surround:  worldSurroundFn
    });

    this.world = world;
    this.local = local;
  }

}
