/**
 * Type definitions for the lib module.
 * These types support the library classes: Graph, Preset, Field, etc.
 * @module
 */

import type { Extent, Vec2 } from '@rapid-sdk/math';
export type { Vec2 } from '@rapid-sdk/math';


// ============================================================================
// GeoJSON Types
// ============================================================================
//
// We use the global `GeoJSON.*` namespace from `@types/geojson` for most types.
// This is available globally via UMD declaration (`export as namespace GeoJSON`).
//
// The type aliases below define a few concepts not in the standard types
// (like SingularGeometry) and provide convenient pre-configured generics.
// ============================================================================

/** GeoJSON geometry type for singular geometries (not Multi* or GeometryCollection) */
export type SingularGeometryType = 'Point' | 'LineString' | 'Polygon';

/** Singular GeoJSON geometry types (Point, LineString, Polygon) - excludes Multi* and GeometryCollection */
export type SingularGeometry = GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon;

/**
 * Any GeoJSON object (Feature, FeatureCollection, or Geometry).
 * Features allow null geometry for unlocated entities (e.g., changesets).
 * This union type allows TypeScript to narrow based on `type` property.
 */
export type GeoJSONObject =
  | GeoJSON.Feature<GeoJSON.Geometry | null>
  | GeoJSON.FeatureCollection<GeoJSON.Geometry | null>
  | GeoJSON.Geometry;


// ============================================================================
// Geometry / GeometryPart
// ============================================================================

/** Smallest Surrounding Rectangle data */
export interface SSRData {
  angle: number;
  poly: Vec2[];
}

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
  outer?: Vec2[];
  hull?: Vec2[];
  centroid?: Vec2;
  poi?: Vec2;
  area?: number;
  ssr?: SSRData;
}

/**
 * Scaled world coordinate data for GeometryPart (REF_Z=16 space).
 * Coordinates are world × 2^16, range 0..16,777,216.
 * Used by the Pixi render pipeline to avoid per-frame world→screen reprojection.
 * The group transform `scale = 2^(zoom - 16)` converts these back to screen pixels GPU-side.
 */
export interface GeometryPartWorldScaledData {
  /** Scaled coordinates: Vec2 for Point, Vec2[] for LineString, Vec2[][] for Polygon */
  coords: Vec2 | Vec2[] | Vec2[][];
  /** Scaled extent bounding box */
  extent: Extent;
  /** Pre-computed anchor = extent center, used for per-feature container positioning */
  anchor: Vec2;
  /** Outer ring only (LineString or Polygon outer), scaled */
  outer?: Vec2[];
  /** Convex hull, scaled */
  hull?: Vec2[];
  /** Centroid, scaled */
  centroid?: Vec2;
  /** Pole of inaccessibility (polygons), scaled */
  poi?: Vec2;
  /** SSR with scaled poly coords */
  ssr?: SSRData;
}

/** Original extent data in WGS84 for Geometry */
export interface GeometryOrigData {
  extent: Extent;
}

/** Projected extent data in world coordinates for Geometry */
export interface GeometryWorldData {
  extent: Extent;
}
