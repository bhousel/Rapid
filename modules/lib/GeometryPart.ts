import { Extent, geomGetSmallestSurroundingRectangle, vecInterp } from '@rapid-sdk/math';
import { polygonArea, polygonCentroid, polygonHull } from 'd3-polygon';
import polylabel from '@mapbox/polylabel';

import type { Context } from '../Context.ts';
import type { SurroundingRectangle, Vec2 } from '@rapid-sdk/math';
import type { SingularGeometry, SingularGeometryType } from './types.ts';


/** Original coordinate data in WGS84 for GeometryPart */
export interface GeometryPartOrigData {
  geojson: SingularGeometry;
  coords: GeoJSON.Position | GeoJSON.Position[] | GeoJSON.Position[][];
  extent: Extent;
}

/** Projected coordinate data in world coordinates for GeometryPart */
export interface GeometryPartWorldData {
  coords: Vec2 | Vec2[] | Vec2[][];
  extent: Extent;
  origin?: Vec2;
  outer?: Vec2[];
  hull?: Vec2[];
  centroid?: Vec2;
  poi?: Vec2;
  area?: number;
  ssr?: SurroundingRectangle;
}

/** Local coordinate data (relative to origin) for GeometryPart */
export interface GeometryPartLocalData {
  coords: Vec2 | Vec2[] | Vec2[][];
  extent: Extent;
  outer?: Vec2[];
  hull?: Vec2[];
  centroid?: Vec2;
  poi?: Vec2;
  area?: number;
  ssr?: SurroundingRectangle;
}


/**
 * A `GeometryPart` is a wrapper for both original and projected geometry data.
 * This class deals with singular geometry elements only: 'Point', 'LineString', 'Polygon'
 *
 * Previously this code lived in `PixiGeometry` where it applied only to rendered features,
 * and worked with screen coordinates.  Now it works with all data elements and with world coordinates.
 *
 * The geometry data should be passed to `setData()` as a GeoJSON geometry object.
 *
 * Properties you can access:
 *   `orig.geojson`     Original GeoJSON Geometry data (in WGS84 lon/lat)
 *   `orig.coords`      Original coordinate data (in WGS84 lon/lat)
 *   `orig.extent`      Original Extent bounding box (in WGS84 lon/lat)
 *   `world.coords`     Computed coordinate data (world z16, range 0..16,777,216)
 *   `world.extent`     Computed Extent bounding box
 *   `world.origin`     Computed origin coordinate (extent center in world space)
 *   `world.outer`      Computed outer ring, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `world.hull`       Computed convex hull, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `world.centroid`   Computed centroid, [x, y]
 *   `world.poi`        Computed pole of inaccessability, [x, y]
 *   `world.ssr`        Computed smallest surrounding rectangle data
 *   `local.coords`     Local coordinate data (relative to origin, small numbers)
 *   `local.extent`     Local Extent bounding box (relative to origin)
 *   `local.outer`      Local outer ring, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `local.hull`       Local convex hull, Array of coordinate pairs [ [x,y], [x,y], … ]
 *   `local.centroid`   Local centroid, [x, y]
 *   `local.poi`        Local pole of inaccessability, [x, y]
 *   `local.ssr`        Local smallest surrounding rectangle data
 */
export class GeometryPart {
  context: Context;
  /** Original data, in WGS84 coordinates ([0,0] is Null Island) */
  orig: GeometryPartOrigData | null;
  /** Projected data, in world coordinates (z16, range 0..16,777,216) */
  world: GeometryPartWorldData | null;
  /** Local data, relative to world origin (small coordinate values) */
  local: GeometryPartLocalData | null;

  /**
   * @constructor
   * @param  context - Global shared application context
   */
  constructor(context: Context) {
    this.context = context;
    this.orig = null;
    this.world = null;
    this.local = null;
  }


  /**
   * Release memory.
   * Do not use the geometry part after calling `destroy()`.
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
    this.local = null;
  }


  /**
   * Returns a clone of this GeometryPart object
   * @return  A new GeometryPart
   */
  clone(): GeometryPart {
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
  get type(): SingularGeometryType | undefined {
    return this.orig?.geojson?.type;
  }


  /**
   * This setter accepts singular GeoJSON Geometries only:  'Point', 'LineString', and 'Polygon'
   * If there is any existing data, it is first removed.
   * @param  geojson - GeoJSON geometry data
   */
  setData(geojson: Partial<SingularGeometry> = {}): void {
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
  update(): void {
    if (!this.orig || this.world) return;  // can't do it, or done already

    const viewport = this.context.viewport;
    const origCoords = this.orig.coords;
    const type = this.type;

    // Points are simple, just project once.
    if (type === 'Point') {
      const coords = viewport.wgs84ToWorld(origCoords as Vec2);
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

    // A line or a polygon.
    // Project the coordinate data..
    // Preallocate Arrays to avoid garbage collection formerly caused by excessive Array.push()
    const worldExtent = new Extent();
    const origRings = (type === 'LineString') ? [origCoords as Vec2[]] : origCoords as Vec2[][];
    const projRings: Vec2[][] = new Array(origRings.length);

    for (let i = 0; i < origRings.length; i++) {
      const origRing = origRings[i];
      projRings[i] = new Array(origRing.length);

      for (let j = 0; j < origRing.length; j++) {
        const xy = viewport.wgs84ToWorld(origRing[j]) as Vec2;
        projRings[i][j] = xy;

        if (i === 0) {  // the outer ring
          worldExtent.extendSelf(xy);
        }
      }
    }

    const worldOrigin = worldExtent.center();
    const world: GeometryPartWorldData = {
      coords: (type === 'LineString') ? projRings[0] : projRings,
      extent: worldExtent,
      origin: worldOrigin,
      outer: projRings[0]
    };

    // Compute local coordinates by translating world coordinates relative to origin
    const localExtent = new Extent();
    const localRings: Vec2[][] = new Array(projRings.length);

    for (let i = 0; i < projRings.length; i++) {
      const worldRing = projRings[i];
      localRings[i] = new Array(worldRing.length);

      for (let j = 0; j < worldRing.length; j++) {
        const localCoord: Vec2 = [
          worldRing[j][0] - worldOrigin[0],
          worldRing[j][1] - worldOrigin[1]
        ];
        localRings[i][j] = localCoord;

        if (i === 0) {  // the outer ring
          localExtent.extendSelf(localCoord);
        }
      }
    }

    const local: GeometryPartLocalData = {
      coords: (type === 'LineString') ? localRings[0] : localRings,
      extent: localExtent,
      outer: localRings[0]
    };

    // Calculate hull, centroid, poi, ssr if possible
    if (world.outer!.length === 0) {          // no coordinates? - shouldn't happen
      // no-op

    } else if (world.outer!.length === 1) {   // single coordinate? - wrong but can happen
      world.centroid = world.outer![0];
      world.poi = world.centroid;
      local.centroid = local.outer![0];
      local.poi = local.centroid;

    } else if (world.outer!.length === 2) {   // 2 coordinate line
      world.centroid = vecInterp(world.outer![0], world.outer![1], 0.5);  // average the 2 points
      world.poi = world.centroid;
      local.centroid = vecInterp(local.outer![0], local.outer![1], 0.5);  // average the 2 points
      local.poi = local.centroid;

    } else {   // > 2 coordinates...

      // check area/winding?
      world.area = polygonArea(world.outer!);
      local.area = polygonArea(local.outer!);
      // if (world.area < 0) {
      //   world.area *= -1;
      //   world.outer.reverse();
      // }

      // Convex Hull
      world.hull = polygonHull(world.outer!) as Vec2[] | undefined;
      local.hull = polygonHull(local.outer!) as Vec2[] | undefined;

      // Centroid (compute in local space for numerical stability)
      if (local.hull) {
        if (local.hull.length === 2) {
          local.centroid = vecInterp(local.hull[0], local.hull[1], 0.5);  // average the 2 points
        } else {
          local.centroid = polygonCentroid(local.hull) as Vec2;
        }
        // Convert back to world space
        if (local.centroid) {
          world.centroid = [local.centroid[0] + worldOrigin[0], local.centroid[1] + worldOrigin[1]];
        }
      }

      // Pole of Inaccessability (for polygons, compute in local space for numerical stability)
      if (type === 'LineString') {
        world.poi = world.centroid;
        local.poi = local.centroid;
      } else {
        local.poi = polylabel(local.coords as Vec2[][]) as Vec2;   // it expects outer + rings
        world.poi = [local.poi[0] + worldOrigin[0], local.poi[1] + worldOrigin[1]];
      }

      // Smallest Surrounding Rectangle (compute in local space)
      if (local.hull) {
        local.ssr = geomGetSmallestSurroundingRectangle(local.hull) ?? undefined;
        // Convert back to world space
        if (local.ssr) {
          world.ssr = {
            polygon: local.ssr.polygon.map(coord => [coord[0] + worldOrigin[0], coord[1] + worldOrigin[1]]) as typeof local.ssr.polygon,
            angle: local.ssr.angle
          };
        }
      }
    }

    this.world = world;
    this.local = local;
  }

}
