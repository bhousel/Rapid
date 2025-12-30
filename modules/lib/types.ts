/**
 * Type definitions for the lib module.
 * These types support the library classes: Graph, Preset, Field, etc.
 * @module
 */

// Re-export commonly needed types from data module for convenience
export type { Entity, EntityID, EntityType, NodeEntity, WayEntity, RelationEntity, RelationMember, Vec2, Tags } from '../data/types.ts';

// Re-export Context for convenience (used by almost every class)
export type { Context } from '../core/types.ts';


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
