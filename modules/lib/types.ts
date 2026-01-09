/**
 * Type definitions for the lib module.
 * These types support the library classes: Graph, Preset, Field, etc.
 * @module
 */

import { Extent } from '@rapid-sdk/math';

import type { Vec2 } from '../data/types.ts';
export type { Vec2 } from '../data/types.ts';

// Re-export Context for convenience (used by almost every class)
export type { Context } from '../core/types.ts';


// ============================================================================
// Action Types
// ============================================================================

import type { Graph } from './Graph.ts';

/**
 * Action
 * An action function that transforms a Graph and returns a new Graph.
 * Actions are the fundamental unit of graph modification in Rapid.
 */
export type Action = (graph: Graph) => Graph;


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

/** Original extent data in WGS84 for Geometry */
export interface GeometryOrigData {
  extent: Extent;
}

/** Projected extent data in world coordinates for Geometry */
export interface GeometryWorldData {
  extent: Extent;
}
