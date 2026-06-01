import { Extent, geomGetDominantSurroundingRectangle, geomToOrigin, projWgs84ToWorld, vecAdd, vecInterp } from '@rapid-sdk/math';
import { polygonCentroid, polygonHull } from 'd3-polygon';
import polylabel from '@mapbox/polylabel';

import type { Context } from '../Context.ts';
import type { SurroundingRectangle, Vec2 } from '@rapid-sdk/math';
import type { SingularGeometry, SingularGeometryType } from './types.ts';


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
   * Returns a clone of this GeometryPart object
   * @return  A new GeometryPart
   */
  public clone(): GeometryPart {
    const copy = new GeometryPart(this.context);

    for (const obj of ['orig', 'world', 'local'] as const) {
      const src = this[obj];
      if (!src) continue;

      const dst: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) {
        if (v instanceof Extent) {
          dst[k] = new Extent(v);
        } else {
          dst[k] = structuredClone(v);
        }
      }
      if (obj === 'orig') {
        copy.orig = dst as unknown as GeometryPartOrigData;
      } else if (obj === 'world') {
        copy.world = dst as unknown as GeometryPartWorldData;
      } else {
        copy.local = dst as unknown as GeometryPartLocalData;
      }
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
    const world: GeometryPartWorldData = {
      coords: (type === 'LineString') ? worldRings[0] : worldRings,
      extent: worldExtent,
      origin: worldOrigin,
      outer: worldRings[0]
    };

    // Compute "local" coordinates by translating world coordinates relative to origin.
    // Also generate flattened coordinate arrays in the same pass.
    const localExtent = new Extent();
    const localRings: Vec2[][] = new Array(worldRings.length);
    const flatRings: number[][] = new Array(worldRings.length);

    for (let i = 0; i < worldRings.length; i++) {
      const worldRing = worldRings[i];
      localRings[i] = new Array(worldRing.length);
      flatRings[i] = new Array(worldRing.length * 2);

      for (let j = 0; j < worldRing.length; j++) {
        const xy: Vec2 = [
          worldRing[j][0] - worldOrigin[0],
          worldRing[j][1] - worldOrigin[1]
        ];
        localRings[i][j] = xy;
        flatRings[i][j * 2] = xy[0];
        flatRings[i][j * 2 + 1] = xy[1];

        if (i === 0) {  // the outer ring
          localExtent.extendSelf(xy);
        }
      }
    }

    const local: GeometryPartLocalData = {
      coords: (type === 'LineString') ? localRings[0] : localRings,
      extent: localExtent,
      outer: localRings[0],
      flat: flatRings
    };

    //
    // Computed data...
    // Prefer to perform the computations in local space to reduce floating point errors.
    // Then translate local coodinates back to world space with `vecAdd` or `geomToOrigin`.
    //

    if (world.outer!.length === 0) {          // no coordinates? - shouldn't happen
      // no-op

    } else if (world.outer!.length === 1) {   // single coordinate? - wrong but can happen
      local.centroid = local.outer![0];
      local.poi = local.centroid;
      local.area = 0;
      world.centroid = world.outer![0];
      world.poi = world.centroid;
      world.area = 0;

    } else if (world.outer!.length === 2) {   // 2 coordinate line
      local.centroid = vecInterp(local.outer![0], local.outer![1], 0.5);  // average the 2 points
      local.poi = local.centroid;
      local.area = 0;
      world.centroid = vecAdd(local.centroid, worldOrigin);
      world.poi = world.centroid;
      world.area = 0;

    } else {   // > 2 coordinates...

      // Area
      // Shoelace formula on the outer ring: unsigned area + winding direction.
      // Translation doesn't change area, so local.area === world.area.
      // The sign convention is the mathematical y-up one: positive = CCW.
      // (Note that d3-polygon's polygonArea() flips this for screen-space y-down,
      // we avoid it so callers don't have to reason about coordinate handedness.)
      const ring = local.outer!;
      let s2 = 0;
      for (let i = 0, m = ring.length; i < m; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[(i + 1) % m];
        s2 += x0 * y1 - x1 * y0;
      }
      local.area = Math.abs(s2) / 2;
      local.winding = s2 >= 0 ? 1 : -1;
      world.area = local.area;
      world.winding = local.winding;

      // Convex Hull
      local.hull = polygonHull(local.outer!) as Vec2[] | undefined;
      if (local.hull) {
        world.hull = geomToOrigin(local.hull, worldOrigin);
      }

      // Centroid
      if (local.hull) {
        if (local.hull.length === 2) {
          local.centroid = vecInterp(local.hull[0], local.hull[1], 0.5);  // average the 2 points
        } else {
          local.centroid = polygonCentroid(local.hull) as Vec2;
        }
        if (local.centroid) {
          world.centroid = vecAdd(local.centroid, worldOrigin);
        }
      }

      // Pole of Inaccessability
      if (type === 'LineString') {
        local.poi = local.centroid;
        world.poi = world.centroid;
      } else {
        local.poi = polylabel(local.coords as Vec2[][]) as Vec2;   // it expects outer + rings
        world.poi = vecAdd(local.poi, worldOrigin);
      }

      // Surrounding Rectangle
      if (local.outer) {
        local.surround = geomGetDominantSurroundingRectangle(local.outer) ?? undefined;

        if (local.surround) {
          world.surround = {
            polygon:     geomToOrigin(local.surround.polygon, worldOrigin),
            angle:       local.surround.angle,
            centroid:    vecAdd(local.surround.centroid, worldOrigin),
            dimensions:  local.surround.dimensions.slice() as Vec2,   // copy, dimensions are the same
            shortAxis:   geomToOrigin(local.surround.shortAxis, worldOrigin),
            longAxis:    geomToOrigin(local.surround.longAxis, worldOrigin)
          };
        }
      }
    }

    this.world = world;
    this.local = local;
  }

}
