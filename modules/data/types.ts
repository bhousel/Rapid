/**
 * Type definitions for the data module.
 * These types represent OSM entities and related data structures.
 * @module
 */

import type { Context } from '../core/types.ts';
import type { Geometry } from '../lib/Geometry.ts';

/** 2D vector as [x, y], typically [longitude, latitude] in WGS84 for geographic coordinates */
export type Vec2 = [number, number];
/** OSM tags as key-value string pairs */
export type Tags = Record<string, string>;
/** Entity ID string (e.g. 'n123', 'w456', 'r789') */
export type EntityID = string;
/** Entity type discriminator */
export type EntityType = 'node' | 'way' | 'relation';

/**
 * Constructor type for AbstractData and subclasses.
 * Used for polymorphic copy-on-write update patterns.
 */
export type DataConstructor<T> = new (
  otherOrContext: T | Context,
  props?: Record<string, unknown>
) => T;


/**
 * Base interface for all data elements.
 * Implemented by AbstractData and its subclasses.
 */
export interface DataElement {
  /** Unique identifier for this data element */
  readonly id: string;
  /** The type of data element */
  readonly type: string;
  /** Geometry wrapper containing original and projected data */
  geoms: Geometry;
  /** Properties object */
  props: Record<string, unknown>;
}


/**
 * Base interface for OSM entities.
 * Extended by OsmNode, OsmWay, OsmRelation.
 */
export interface Entity extends DataElement {
  /** Entity type: 'node', 'way', or 'relation' */
  readonly type: EntityType;
  /** OSM tags */
  tags: Tags;
  /** OSM object version number */
  version?: number;
  /** Whether the entity is visible */
  visible?: boolean;
  /** Geographic location [lon, lat] - present on nodes only */
  loc?: Vec2;
  /** Get the geometry type of this entity */
  geometry(graph: unknown): string;
  /** Check if this entity has tags that are considered "interesting" */
  hasInterestingTags(): boolean;
  /** Check if this entity is a multipolygon relation */
  isMultipolygon(): boolean;
  /** Check if this entity is a turn restriction relation */
  isRestriction(): boolean;
  /** Check if this restriction relation is valid */
  isValidRestriction(graph: unknown): boolean;
  /** Check if all members of this entity are present in the graph */
  isComplete(graph: unknown): boolean;
  /** Get a relation member by role */
  memberByRole(role: string): RelationMember | undefined;
  /** Get all relation members with a given role */
  membersByRole(role: string): RelationMember[];
  /** Create a copy of this entity with updated properties */
  update(updates: Record<string, unknown>): Entity;
  /** Get the bounding extent of this entity */
  extent(graph: unknown): unknown;
}


/**
 * OSM Node entity interface.
 */
export interface NodeEntity extends Entity {
  readonly type: 'node';
  /** Geographic location [lon, lat] */
  loc: Vec2;
}


/**
 * OSM Way entity interface.
 */
export interface WayEntity extends Entity {
  readonly type: 'way';
  /** Ordered array of node IDs that make up this way */
  nodes: EntityID[];
  /** Check if this way is a oneway street */
  isOneWay(): boolean;
  /** Check if this way forms an area (closed polygon) */
  isArea(): boolean;
  /** Check if this way is degenerate (too few nodes) */
  isDegenerate(): boolean;
  /** Get the first node ID of this way */
  first(): EntityID;
  /** Get the last node ID of this way */
  last(): EntityID;
  /** Create a copy of this way with updated properties */
  update(updates: Record<string, unknown>): WayEntity;
  /** Update the geometry for this way based on the current graph */
  updateGeometry(graph: unknown): void;
}


/**
 * Member of an OSM Relation.
 */
export interface RelationMember {
  /** Entity ID of the member */
  id: EntityID;
  /** Type of the member entity */
  type: EntityType;
  /** Role of this member in the relation */
  role: string;
}


/**
 * OSM Relation entity interface.
 */
export interface RelationEntity extends Entity {
  readonly type: 'relation';
  /** Array of relation members */
  members: RelationMember[];
  /** Update the geometry for this relation based on the current graph */
  updateGeometry(graph: unknown): void;
}
