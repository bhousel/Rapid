/**
 * Type definitions for the lib module.
 * These types support the library classes: Graph, Preset, Field, etc.
 * @module
 */


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
