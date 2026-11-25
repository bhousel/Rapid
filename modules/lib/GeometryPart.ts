import { Extent, geomGetDominantSurroundingRectangle, geomToOrigin, projWgs84ToWorld, vecAdd, vecInterp } from '@rapid-sdk/math';
import { geoMetersToWorld, geomCoverageBoxes } from '../geo/geom.ts';
import { polygonCentroid, polygonHull } from 'd3-polygon';
import polylabel from '@mapbox/polylabel';

import type { Context } from '../Context.ts';
import type { CoverageBox } from '../geo/geom.ts';
import type { SurroundingRectangle, Vec2 } from '@rapid-sdk/math';
import type { SingularGeometry, SingularGeometryType } from './types.ts';


/**
 * Copies GeoJSON coordinates (a position, or arrays of them) into new arrays.
 * @param coords - The coordinates to copy
 * @return The copy
 */
function copyCoords<T extends GeoJSON.Position | GeoJSON.Position[] | GeoJSON.Position[][]>(coords: T): T {
  if (typeof coords[0] === 'number') {
    return (coords as GeoJSON.Position).slice() as T;
  }
  return (coords as GeoJSON.Position[][]).map(item => copyCoords(item)) as T;
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
  /** How far the pole of inaccessability is from the polygon's edge: the widest circle that fits inside has this radius */
  inradius?: number;
  /** Local area (unsigned magnitude) */
  area?: number;
  /** Winding direction of the outer ring: +1 = CCW, -1 = CW (in y-up math space) */
  winding?: 1 | -1;
  /** Local surrounding rectangle */
  surround?: SurroundingRectangle;
}


/** Marks a derived product that hasn't been computed (`undefined` is a possible result) */
const UNSET = Symbol('unset');
type Unset = typeof UNSET;


/**
 * The `local` frame of a LineString or Polygon part: its coordinates relative to `world.origin`.
 *
 * The derived products (hull, centroid, poi, area, winding, surround, flat) are computed the
 * first time they're read, and kept. Most geometries are never rendered or conflated, so this
 * saves both memory and CPU on large datasets.
 *
 * They're getters on the class, not properties defined on each object: a part with a closure
 * and an accessor for each product took 3 KB before any was read, 2.3 KB of it for those
 * (see section 13 of `design/graphics-system-log.md`).
 * Computing in local space reduces floating point errors; `WorldFrame` translates the results.
 */
class LocalFrame implements GeometryPartLocalData {
  public coords: Vec2[] | Vec2[][];
  public extent: Extent;
  public outer: Vec2[];

  /** The part's type: a LineString has no pole of inaccessability of its own */
  protected _type: SingularGeometryType;
  /** Every ring (a LineString has one) */
  protected _rings: Vec2[][];
  protected _shoelace: number | Unset;
  protected _hull: Vec2[] | undefined | Unset;
  protected _centroid: Vec2 | undefined | Unset;
  protected _poi: Vec2 | undefined | Unset;
  protected _inradius: number | Unset;
  protected _flat: number[][] | Unset;
  protected _surround: SurroundingRectangle | undefined | Unset;

  /**
   * @param type - 'LineString' or 'Polygon'
   * @param rings - The rings' coordinates, relative to the origin
   * @param extent - The extent of the outer ring
   */
  public constructor(type: SingularGeometryType, rings: Vec2[][], extent: Extent) {
    this.coords = (type === 'LineString') ? rings[0] : rings;
    this.extent = extent;
    this.outer = rings[0];
    this._type = type;
    this._rings = rings;
    this._shoelace = UNSET;
    this._hull = UNSET;
    this._centroid = UNSET;
    this._poi = UNSET;
    this._inradius = UNSET;
    this._flat = UNSET;
    this._surround = UNSET;
  }

  /**
   * Shoelace sum on the outer ring (shared by area + winding).
   * The sign convention is the mathematical y-up one: positive = CCW.
   * (Note that d3-polygon's polygonArea() flips this for screen-space y-down,
   * we avoid it so callers don't have to reason about coordinate handedness.)
   * @return Twice the signed area
   */
  protected get _shoelaceSum(): number {
    if (this._shoelace === UNSET) {
      const outer = this.outer;
      let s2 = 0;
      for (let i = 0, m = outer.length; i < m; i++) {
        const [x0, y0] = outer[i];
        const [x1, y1] = outer[(i + 1) % m];
        s2 += x0 * y1 - x1 * y0;
      }
      this._shoelace = s2;
    }
    return this._shoelace;
  }

  /** Area (unsigned magnitude). It's translation-invariant, so `world.area` is the same. */
  public get area(): number | undefined {
    const outerLen = this.outer.length;
    if (outerLen === 0) return undefined;       // no coordinates? - shouldn't happen
    if (outerLen <= 2) return 0;                // single coordinate or 2 coordinate line
    return Math.abs(this._shoelaceSum) / 2;
  }

  /** Winding direction of the outer ring: +1 = CCW, -1 = CW (in y-up math space). */
  public get winding(): 1 | -1 | undefined {
    if (this.outer.length <= 2) return undefined;        // only meaningful for rings
    return this._shoelaceSum >= 0 ? 1 : -1;
  }

  /** Convex hull */
  public get hull(): Vec2[] | undefined {
    if (this._hull === UNSET) {
      this._hull = (this.outer.length <= 2) ? undefined : ((polygonHull(this.outer) as Vec2[] | null) ?? undefined);
    }
    return this._hull;
  }

  /** Centroid (computed from the hull for numerical stability). */
  public get centroid(): Vec2 | undefined {
    if (this._centroid === UNSET) {
      const outer = this.outer;
      const outerLen = outer.length;
      let centroid: Vec2 | undefined;
      if (outerLen === 0) {
        centroid = undefined;
      } else if (outerLen === 1) {
        centroid = outer[0];
      } else if (outerLen === 2) {
        centroid = vecInterp(outer[0], outer[1], 0.5);  // average the 2 points
      } else {
        const hull = this.hull;
        if (!hull) {
          centroid = undefined;
        } else if (hull.length === 2) {
          centroid = vecInterp(hull[0], hull[1], 0.5);  // average the 2 points
        } else {
          centroid = polygonCentroid(hull) as Vec2;
        }
      }
      this._centroid = centroid;
    }
    return this._centroid;
  }

  /**
   * Whether the pole of inaccessability is just the centroid: for lines and degenerate rings.
   * @return `true` if `poi` falls back to `centroid`
   */
  public get poiIsCentroid(): boolean {
    return this.outer.length <= 2 || this._type === 'LineString';
  }

  /**
   * Pole of Inaccessability (useful for label placement).
   * Polygons use polylabel; lines and degenerate rings fall back to the centroid.
   */
  public get poi(): Vec2 | undefined {
    if (this._poi === UNSET) {
      this._poi = this.poiIsCentroid ? this.centroid : polylabel(this.coords as Vec2[][]) as Vec2;   // it expects outer + rings
    }
    return this._poi;
  }

  /**
   * How far the pole of inaccessability is from the polygon's edge (holes' edges included):
   * the radius of the widest circle that fits inside. It says at a glance whether the polygon
   * has a middle that a partial fill leaves empty (`geomAreaBand`).
   * The pole is found to within 1 unit, so the true radius is this or up to 1 more.
   * 0 for lines and degenerate rings.
   */
  public get inradius(): number {
    if (this._inradius === UNSET) {
      let inradius = 0;
      const poi = this.poiIsCentroid ? undefined : this.poi;
      if (poi) {
        let nearest = Infinity;   // squared
        for (const ring of this._rings) {
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const ax = ring[j][0];
            const ay = ring[j][1];
            const dx = ring[i][0] - ax;
            const dy = ring[i][1] - ay;
            const px = poi[0] - ax;
            const py = poi[1] - ay;
            const length2 = dx * dx + dy * dy;
            let t = (length2 > 0) ? (px * dx + py * dy) / length2 : 0;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            const ex = px - t * dx;
            const ey = py - t * dy;
            const distance2 = ex * ex + ey * ey;
            if (distance2 < nearest) nearest = distance2;
          }
        }
        if (Number.isFinite(nearest)) inradius = Math.sqrt(nearest);
      }
      this._inradius = inradius;
    }
    return this._inradius;
  }

  /** Flattened coordinate data (Pixi prefers this) - one flat array per ring. */
  public get flat(): number[][] {
    if (this._flat === UNSET) {
      const rings = this._rings;
      const flatRings: number[][] = new Array(rings.length);
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        const flat: number[] = new Array(ring.length * 2);
        for (let j = 0; j < ring.length; j++) {
          flat[j * 2] = ring[j][0];
          flat[j * 2 + 1] = ring[j][1];
        }
        flatRings[i] = flat;
      }
      this._flat = flatRings;
    }
    return this._flat;
  }

  /** Surrounding rectangle (only meaningful for rings). */
  public get surround(): SurroundingRectangle | undefined {
    if (this._surround === UNSET) {
      this._surround = (this.outer.length <= 2) ? undefined : (geomGetDominantSurroundingRectangle(this.outer) ?? undefined);
    }
    return this._surround;
  }
}


/**
 * The `world` frame of a LineString or Polygon part. Its derived products are the local frame's,
 * translated back by the origin the first time they're read (see `LocalFrame`).
 */
class WorldFrame implements GeometryPartWorldData {
  public coords: Vec2[] | Vec2[][];
  public extent: Extent;
  public origin: Vec2;
  public outer: Vec2[];

  /** The local frame, where the derived products are computed */
  protected _local: LocalFrame;
  protected _hull: Vec2[] | undefined | Unset;
  protected _centroid: Vec2 | undefined | Unset;
  protected _poi: Vec2 | undefined | Unset;
  protected _surround: SurroundingRectangle | undefined | Unset;

  /**
   * @param type - 'LineString' or 'Polygon'
   * @param rings - The rings' coordinates, in world coordinates
   * @param extent - The extent of the outer ring
   * @param origin - The origin of the local frame
   * @param local - The local frame
   */
  public constructor(type: SingularGeometryType, rings: Vec2[][], extent: Extent, origin: Vec2, local: LocalFrame) {
    this.coords = (type === 'LineString') ? rings[0] : rings;
    this.extent = extent;
    this.origin = origin;
    this.outer = rings[0];
    this._local = local;
    this._hull = UNSET;
    this._centroid = UNSET;
    this._poi = UNSET;
    this._surround = UNSET;
  }

  /** Area (unsigned magnitude) */
  public get area(): number | undefined {
    return this._local.area;
  }

  /** Winding direction of the outer ring: +1 = CCW, -1 = CW (in y-up math space). */
  public get winding(): 1 | -1 | undefined {
    return this._local.winding;
  }

  /** Convex hull */
  public get hull(): Vec2[] | undefined {
    if (this._hull === UNSET) {
      const hull = this._local.hull;
      this._hull = hull ? geomToOrigin(hull, this.origin) : undefined;
    }
    return this._hull;
  }

  /** Centroid */
  public get centroid(): Vec2 | undefined {
    if (this._centroid === UNSET) {
      if (this.outer.length === 1) {
        this._centroid = this.outer[0];
      } else {
        const centroid = this._local.centroid;
        this._centroid = centroid ? vecAdd(centroid, this.origin) : undefined;
      }
    }
    return this._centroid;
  }

  /** Pole of Inaccessability (useful for label placement) */
  public get poi(): Vec2 | undefined {
    if (this._poi === UNSET) {
      if (this._local.poiIsCentroid) {
        this._poi = this.centroid;
      } else {
        const poi = this._local.poi;
        this._poi = poi ? vecAdd(poi, this.origin) : undefined;
      }
    }
    return this._poi;
  }

  /** Surrounding rectangle (only meaningful for rings). */
  public get surround(): SurroundingRectangle | undefined {
    if (this._surround === UNSET) {
      const surround = this._local.surround;
      const origin = this.origin;
      this._surround = !surround ? undefined : {
        polygon:     geomToOrigin(surround.polygon, origin),
        angle:       surround.angle,
        centroid:    vecAdd(surround.centroid, origin),
        dimensions:  surround.dimensions.slice() as Vec2,   // copy, dimensions are the same
        shortAxis:   geomToOrigin(surround.shortAxis, origin),
        longAxis:    geomToOrigin(surround.longAxis, origin)
      };
    }
    return this._surround;
  }
}


/**
 * A `GeometryPart` is a wrapper for both original and projected geometry data.
 * The geometry data should be passed to `setData()` as a singular GeoJSON geometry object.
 * This class deals with singular geometry elements only: 'Point', 'LineString', 'Polygon'.
 *
 * Properties available:
 * - `orig`  - Original GeoJSON Geometry data (in WGS84 lon,lat)
 * - `world` - Projected world coordinate data (world z16, range 0..16,777,216)
 * - `local` - Projected local coordinate data (relative to `world.origin`)
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

  /** Coverage boxes from the last `computeCoverage()` call */
  protected _coverage: CoverageBox[] | null;
  /** The radius (meters) that `_coverage` was computed for */
  protected _coverageRadius: number;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    this.context = context;
    this.orig = null;
    this.world = null;
    this.local = null;
    this._coverage = null;
    this._coverageRadius = 0;
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
    this._coverage = null;
    this._coverageRadius = 0;
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

    // Copy the original geojson, with new coordinate pairs: the caller's arrays (e.g. a node's `loc`)
    // must never be aliased. (This is much cheaper than a `structuredClone` of the whole object.)
    const orig = {
      geojson: { type: type, coordinates: copyCoords(coords) } as SingularGeometry
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

    // The frames hold the core data — a cheap projection that every consumer needs — and
    // compute their derived products when they're first read (see `LocalFrame`).
    const local = new LocalFrame(type!, localRings, localExtent);
    const world = new WorldFrame(type!, worldRings, worldExtent, worldOrigin, local);

    this.world = world;
    this.local = local;
  }


  /**
   * Covers this geometry with axis-aligned boxes, in world coordinates. This is a fast,
   * approximate buffer that conflation uses as RBush query boxes.
   *
   * The shape of the coverage depends on the geometry type:
   * - **Point**: one box of half-size `radius`, centered on the point.
   * - **LineString**: boxes of half-size `radius`, evenly spaced at most `radius` apart along the
   *   whole line, including both ends (see `geomCoverageBoxes`). Each box is a separate unit, so
   *   conflation can tell which parts of a line already exist.
   * - **Polygon**: one box, the outer ring's extent grown by `radius`. Filling a 2D area with
   *   boxes would be wasteful, so precise polygon overlap tests happen later, in the refine step.
   *
   * The radius is a recompute parameter: users can tune it, so it is not part of `setData()`.
   * The result for the most recent radius is cached, so repeated calls are cheap.
   * @param  radius - Buffer distance, in meters
   * @return Coverage boxes in world coordinates (empty if there is no data or `radius <= 0`)
   */
  public computeCoverage(radius: number): CoverageBox[] {
    if (!this.orig || !this.world || radius <= 0) return [];
    if (this._coverage && this._coverageRadius === radius) return this._coverage;

    // Convert meters to world units at this geometry's latitude.
    const lat = this.orig.extent.center()[1];
    const r = geoMetersToWorld(radius, lat);
    const type = this.type;
    let boxes: CoverageBox[];

    if (type === 'Point') {
      boxes = geomCoverageBoxes([this.world.coords as Vec2], r);
    } else if (type === 'LineString') {
      boxes = geomCoverageBoxes(this.world.outer!, r);
    } else {
      const extent = this.world.extent;
      boxes = [{
        minX: extent.min[0] - r,
        minY: extent.min[1] - r,
        maxX: extent.max[0] + r,
        maxY: extent.max[1] + r,
        coord: extent.center(),
        angle: 0,
        index: 0,
        t: 0
      }];
    }

    this._coverage = boxes;
    this._coverageRadius = radius;
    return boxes;
  }

}
