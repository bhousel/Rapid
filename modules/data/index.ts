export * from './parsers/index.ts';

import { AbstractData } from './AbstractData.ts';
import { GeoJSONData } from './GeoJSONData.ts';
import { MarkerData } from './MarkerData.ts';  // was "QAItem"
import { OsmChangeset } from './OsmChangeset.ts';
import { OsmEntity } from './OsmEntity.ts';
import { OsmNode } from './OsmNode.ts';
import { OsmRelation } from './OsmRelation.ts';
import { OsmWay } from './OsmWay.ts';
import type { Context } from '../Context.ts';

export {
  AbstractData,
  GeoJSONData,
  MarkerData,
  OsmChangeset,
  OsmEntity,
  OsmNode,
  OsmRelation,
  OsmWay,
};

// Re-export types
export type { AbstractDataProps } from './AbstractData.ts';
export type { GeoJSONProps } from './GeoJSONData.ts';
export type { MarkerProps } from './MarkerData.ts';
export type { OsmChangesetProps, OsmChanges } from './OsmChangeset.ts';
export type { OsmEntityProps } from './OsmEntity.ts';
export type { OsmNodeProps } from './OsmNode.ts';
export type { OsmRelationProps, IndexedMember } from './OsmRelation.ts';
export type { OsmWayProps, Segment } from './OsmWay.ts';
export type * from './types.ts';


/**
 * createOsmEntity
 * This function allows us to construct the correct OSM Entity type.
 * If passed another OSM Entity, inspect its constructor.
 * If passed context and properties, inspect its `id` or `type` properties.
 * @param otherOrContext - copy another data element, or pass application context
 * @param props - Properties to assign to the data element
 */
export function createOsmEntity(
  otherOrContext: AbstractData | Context,
  props: Record<string, unknown> = {}
): OsmEntity {
  if (otherOrContext instanceof AbstractData) {  // copy other
    const Type = otherOrContext.constructor as new (other: AbstractData, props: Record<string, unknown>) => OsmEntity;
    return new Type(otherOrContext, props);

  } else {
    const context = otherOrContext;

    // Determine what type to create
    let type = props.type as string | undefined;
    if (!type) {
      const id = props.id as string | undefined;
      if (id) {
        type = OsmEntity.type(id);
      }
    }

    if (type === 'node') {
      return new OsmNode(context, props as any);
    } else if (type === 'way') {
      return new OsmWay(context, props as any);
    } else if (type === 'relation') {
      return new OsmRelation(context, props as any);
    } else if (type === 'changeset') {
      return new OsmChangeset(context, props as any);
    } else {
      return new OsmEntity(context, props as any);  // an untyped OsmEntity - avoid doing this.
    }
  }
}
