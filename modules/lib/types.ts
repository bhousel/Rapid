/**
 * Type definitions for the lib module.
 * These types support the library classes: Graph, Preset, Field, etc.
 * @module
 */

import { Extent } from '@rapid-sdk/math';

import type { Vec2 } from '../data/types.ts';

// Re-export commonly needed types from data module for convenience
export type { Entity, EntityID, EntityType, NodeEntity, WayEntity, RelationEntity, RelationMember, Vec2, Tags } from '../data/types.ts';

// Re-export Context for convenience (used by almost every class)
export type { Context } from '../core/types.ts';


// ============================================================================
// Utility Types
// ============================================================================

/**
 * OneOrMore<T>
 * Allows a single value or an array of values.
 * Used for functions that accept either one item or multiple items.
 */
export type OneOrMore<T> = T | T[];


// ============================================================================
// Action Types
// ============================================================================

// Forward declaration to avoid circular imports
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

/** GeoJSON geometry type for singular geometries */
export type SingularGeometryType = 'Point' | 'LineString' | 'Polygon';

/** GeoJSON Point geometry */
export interface PointGeometry {
  type: 'Point';
  coordinates: Vec2;
}

/** GeoJSON LineString geometry */
export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Vec2[];
}

/** GeoJSON Polygon geometry */
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Vec2[][];
}

/** Singular GeoJSON geometry types (Point, LineString, Polygon) */
export type SingularGeometry = PointGeometry | LineStringGeometry | PolygonGeometry;

/** GeoJSON MultiPoint geometry */
export interface MultiPointGeometry {
  type: 'MultiPoint';
  coordinates?: Vec2[];
}

/** GeoJSON MultiLineString geometry */
export interface MultiLineStringGeometry {
  type: 'MultiLineString';
  coordinates?: Vec2[][];
}

/** GeoJSON MultiPolygon geometry */
export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates?: Vec2[][][];
}

/** GeoJSON GeometryCollection */
export interface GeoJSONGeometryCollection {
  type: 'GeometryCollection';
  geometries?: GeoJSONGeometry[];
}

/** Any GeoJSON geometry type */
export type GeoJSONGeometry =
  | SingularGeometry
  | MultiPointGeometry
  | MultiLineStringGeometry
  | MultiPolygonGeometry
  | GeoJSONGeometryCollection;

/** GeoJSON Feature */
export interface GeoJSONFeature {
  type: 'Feature';
  geometry?: GeoJSONGeometry;
  properties?: Record<string, unknown>;
}

/** GeoJSON FeatureCollection */
export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features?: GeoJSONFeature[];
}

/** Any GeoJSON object (Feature, FeatureCollection, or Geometry) */
export type GeoJSONObject = GeoJSONFeature | GeoJSONFeatureCollection | GeoJSONGeometry;


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
  coords: Vec2 | Vec2[] | Vec2[][];
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
