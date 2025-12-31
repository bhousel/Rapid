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


// ============================================================================
// ValidationFix
// ============================================================================

/**
 * Properties for creating a ValidationFix.
 */
export interface ValidationFixProps {
  /** Localized title describing the fix */
  title: string;

  /** Function to execute when the fix is applied */
  onClick?: () => void;

  /** If set, explains why the fix is currently unavailable */
  disabledReason?: string;

  /** Icon identifier (defaults to 'rapid-icon-wrench') */
  icon?: string;

  /** Entity IDs involved in this fix (for hover highlighting) */
  entityIds?: string[];
}


// ============================================================================
// ValidationIssue
// ============================================================================

/** Severity levels for validation issues */
export type ValidationSeverity = 'warning' | 'error' | 'suggestion';

/**
 * Properties for creating a ValidationIssue.
 */
export interface ValidationIssueProps {
  /** Name of the validation rule that created this issue */
  type: string;

  /** Subcategory within the type (e.g. 'relation_type' under 'missing_tag') */
  subtype?: string;

  /** Issue severity level */
  severity: ValidationSeverity;

  /** IDs of entities involved in the issue */
  entityIds: string[];

  /** Location [lon, lat] to zoom to for viewing the issue */
  loc?: [number, number];

  /** Additional data needed by fixes */
  data?: Record<string, unknown>;

  /** String to further differentiate this issue */
  hash?: string;

  /** Arguments for auto-fixing this issue, if supported */
  autoArgs?: unknown;

  /** Function returning the localized issue message */
  message?: () => string;

  /** Function to render reference information */
  reference?: (selection: unknown) => void;

  /** Function returning available fixes for this issue */
  dynamicFixes?: () => unknown[];
}


// ============================================================================
// Difference
// ============================================================================

import type { Entity as EntityInterface } from '../data/types.ts';

/**
 * Represents a change to a single entity between two graphs.
 */
export interface DifferenceChange {
  /** The entity in the base graph (undefined if added) */
  base: EntityInterface | undefined;

  /** The entity in the head graph (undefined if deleted) */
  head: EntityInterface | undefined;
}

/**
 * Flags indicating what types of changes occurred.
 */
export interface DifferenceFlags {
  /** An entity was added */
  addition?: boolean;

  /** An entity was deleted */
  deletion?: boolean;

  /** An entity's geometry changed */
  geometry?: boolean;

  /** An entity's properties/tags changed */
  properties?: boolean;
}


// ============================================================================
// Graph
// ============================================================================

/**
 * Properties for creating a Graph.
 */
export interface GraphProps {
  /** Unique identifier for this graph */
  id?: string;
}

/**
 * Internal cache structure used by Graph.
 */
export interface GraphCache {
  /** Map of entity ID to Entity */
  entities: Map<string, EntityInterface>;

  /** Map of entity ID to Set of parent way IDs */
  parentWays: Map<string, Set<string>>;

  /** Map of entity ID to Set of parent relation IDs */
  parentRels: Map<string, Set<string>>;
}


// ============================================================================
// RapidDataset
// ============================================================================

/**
 * Properties for creating a RapidDataset.
 */
export interface RapidDatasetProps {
  /** Unique identifier */
  id: string;

  /** Service providing the data: 'esri', 'mapwithai', 'overture' */
  serviceID?: string;

  /** Categories this dataset belongs to (e.g. 'buildings', 'addresses') */
  categories?: Set<string>;

  /** Tags/flags for the dataset (e.g. 'opendata') */
  tags?: Set<string>;

  /** Display color for this dataset */
  color?: string;

  /** Attribution/source information */
  dataUsed?: unknown[];

  /** Geographic extent of the dataset */
  extent?: unknown;

  /** Overlay configuration */
  overlay?: unknown;

  /** URL to the item page */
  itemUrl?: string;

  /** URL to the license */
  licenseUrl?: string;

  /** URL to a thumbnail image */
  thumbnailUrl?: string;

  /** Whether this dataset appears in the list */
  added?: boolean;

  /** Whether this is a beta/preview dataset */
  beta?: boolean;

  /** Whether the user has enabled this dataset */
  enabled?: boolean;

  /** Whether this dataset is featured */
  featured?: boolean;

  /** Whether this dataset is filtered from display */
  filtered?: boolean;

  /** Whether this dataset is hidden from the catalog */
  hidden?: boolean;

  /** Whether this dataset is conflated */
  conflated?: boolean;

  /** Localization string ID for the label */
  labelStringID?: string;

  /** Localization string ID for the description */
  descriptionStringID?: string;

  /** Fallback label if localization unavailable */
  label?: string;

  /** Fallback description if localization unavailable */
  description?: string;
}
