/**
 * Type definitions for the data module.
 * These types represent OSM entities and related data structures.
 * @module
 */

import type { Geometry } from '../lib/Geometry.js';


/** 2D vector as [x, y], typically [longitude, latitude] in WGS84 for geographic coordinates */
export type Vec2 = [number, number];

/** OSM tags as key-value string pairs */
export type Tags = Record<string, string>;

/** Entity ID string (e.g. 'n123', 'w456', 'r789') */
export type EntityID = string;

/** Entity type discriminator */
export type EntityType = 'node' | 'way' | 'relation';


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
}
