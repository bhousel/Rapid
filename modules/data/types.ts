/**
 * Type definitions for the data module.
 * These types represent OSM entities and related data structures.
 * @module
 */

// Re-export Context for convenience (used by almost every class)
import type { Context } from '../Context.ts';
export type { Context } from '../Context.ts';

// Re-export entity classes as types
export type { AbstractData } from './AbstractData.ts';
export type { OsmEntity, OsmEntityProps } from './OsmEntity.ts';
export type { OsmNode, OsmNodeProps } from './OsmNode.ts';
export type { OsmRelation, OsmRelationProps, OsmRelationMember } from './OsmRelation.ts';
export type { OsmWay, OsmWayProps } from './OsmWay.ts';
/** OSM tags as key-value string pairs */
export type Tags = Record<string, string>;


/** 2D vector as [x, y], typically [longitude, latitude] in WGS84 for geographic coordinates */
export type Vec2 = [number, number];
/** 3D vector as [x, y, z] */
export type Vec3 = [number, number, number];
/** 4D vector as [x, y, z, w], also used for bounding boxes [minX, minY, maxX, maxY] */
export type Vec4 = [number, number, number, number];

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

