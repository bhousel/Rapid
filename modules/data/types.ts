/**
 * Type definitions for the data module.
 * These types represent OSM entities and related data structures.
 * @module
 */

import type { Context } from '../core/types.ts';

// Re-export Context for convenience (used by almost every class)
export type { Context } from '../core/types.ts';

// Re-export entity classes as types
export type { OsmEntity } from './OsmEntity.ts';
export type { OsmNode } from './OsmNode.ts';
export type { OsmRelation, OsmRelationMember } from './OsmRelation.ts';
export type { OsmWay } from './OsmWay.ts';

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

