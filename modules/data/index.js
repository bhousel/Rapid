export * from './lib/index.js';
export * from './parsers/index.js';

import { AbstractData } from './AbstractData.js';
import { GeoJSON } from './GeoJSON.js';
import { Marker } from './Marker.js';  // was "QAItem"
import { OsmChangeset } from './OsmChangeset.js';
import { OsmEntity } from './OsmEntity.js';
import { OsmNode } from './OsmNode.js';
import { OsmRelation } from './OsmRelation.js';
import { OsmWay } from './OsmWay.js';

export {
  AbstractData,
  GeoJSON,
  Marker,
  OsmChangeset,
  OsmEntity,
  OsmNode,
  OsmRelation,
  OsmWay,
};

/**
 * createOsmEntity
 * This function allows us to construct the correct OSM Entity type.
 * If passed another OSM Entity, inspect its constructor.
 * If passed context and properties, inspect its `id` or `type` properties.
 * @param  {AbstractData|Context}  otherOrContext - copy another data element, or pass application context
 * @param  {Object}                props - Properties to assign to the data element
 */
export function createOsmEntity(otherOrContext, props = {}) {
  if (otherOrContext instanceof AbstractData) {  // copy other
    const Type = otherOrContext.constructor;
    return new Type(otherOrContext, props);

  } else {
    const context = otherOrContext;

    // Determine what type to create
    let type = props.type;
    if (!type) {
      const id = props.id;
      if (id) {
        type = OsmEntity.type(id);
      }
    }

    if (type === 'node') {
      return new OsmNode(context, props);
    } else if (type === 'way') {
      return new OsmWay(context, props);
    } else if (type === 'relation') {
      return new OsmRelation(context, props);
    } else if (type === 'changeset') {
      return new OsmChangeset(context, props);
    } else {
      return new OsmEntity(context, props);  // an untyped OsmEntity - avoid doing this.
    }
  }
}


/**
 *  Some type aliases - we sometimes refer to these in JSDoc throughout the code.
 *  For example, `Map<nodeID, Node>` should be valid and treated as `Map<string, OsmNode>`.
 *  (I don't know whether this really matters much - we don't actually parse the JSDoc.)
 *
 *  @typedef  {string}        dataID
 *  @typedef  {string}        entityID
 *  @typedef  {string}        nodeID
 *  @typedef  {string}        wayID
 *  @typedef  {string}        relationID
 *  @typedef  {string}        changesetID
 *  @typedef  {AbstractData}  Data
 *  @typedef  {OsmEntity}     Entity
 *  @typedef  {OsmNode}       Node
 *  @typedef  {OsmWay}        Way
 *  @typedef  {OsmRelation}   Relation
 *  @typedef  {OsmChagneset}  Changeset
 */
