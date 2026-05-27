import { projWorldToWgs84 } from '@rapid-sdk/math';
import { OsmNode } from '../data/OsmNode.ts';

import type { Action } from './types.ts';
import type { EntityType, OsmRelation, OsmTags, OsmWay } from '../data/types.ts';
import type { Graph } from '../lib/Graph.ts';


/** Interface for extract action with getExtractedNodeID method */
export interface ExtractAction extends Action {
  getExtractedNodeID(): EntityID | undefined;
}


/**
 * Extracts a point of interest (POI) node from a node, way, or relation.
 * For nodes, creates a replacement node and detaches the original.
 * For ways/relations, extracts tags to a new point at the centroid.
 *
 * @param   entityID  - EntityID of the entity to extract from
 * @return  An Action function that extracts a new POI node from another entity
 */
export function actionExtract(entityID: EntityID): ExtractAction {
  let _extractedNodeID: EntityID | undefined;

  const action = ((graph: Graph): Graph => {
    const entity = graph.entity(entityID);
    if (entity.type === 'node') {
      return _extractFromNode(entity as OsmNode, graph);
    } else {
      return _extractFromWayOrRelation(entity as OsmWay | OsmRelation, graph);
    }
  }) as ExtractAction;


  /**
   * Extracts a node from another node: creates a new replacement node that takes
   * the original node's place in all parent ways and relations, leaving the
   * original as a free-standing POI.
   * @param   node  - The node to extract from
   * @param   graph - The current graph
   * @return  Updated graph
   */
  function _extractFromNode(node: OsmNode, graph: Graph): Graph {
    _extractedNodeID = node.id;

    // Create a new node to replace the one we will detach
    const replacement = new OsmNode(node.context, { loc: node.loc });
    graph.replace(replacement);

    for (const parentWay of graph.parentWays(node)) {
      graph.replace(parentWay.replaceNode(entityID, replacement.id));
    }
    for (const parentRelation of graph.parentRelations(node)) {
      graph.replace(parentRelation.replaceMember(node, { id: replacement.id, type: replacement.type as EntityType }));
    }
    return graph.commit();
  }


  /**
   * Extracts a POI from a way or relation by copying its "interesting" tags to a
   * new node placed at the entity's pre-calculated pole of inaccessibility.
   * Tags that identify the building, indoor area, addresses, and a few others are retained on
   * both the original entity and the new point.
   * @param   entity - The way or relation to extract from
   * @param   graph  - The current graph
   * @return  Updated graph
   */
  function _extractFromWayOrRelation(entity: OsmWay | OsmRelation, graph: Graph): Graph {
    const keysToCopyAndRetain = ['source', 'wheelchair'];
    const keysToRetain = ['area'];
    const buildingKeysToRetain = /architect|building|height|layer|nycdoitt:bin|roof/i;

    const poi = entity.geoms.parts[0]?.world?.poi;  // Pole of Inaccessability (in world coords)
    if (!poi) return graph;

    const extractLoc = projWorldToWgs84(poi);

    const indoorAreaValues: Record<string, boolean> = {
      area: true,
      corridor: true,
      elevator: true,
      level: true,
      room: true
    };

    const isArea = (entity.geometry(graph) === 'area');
    const isIndoorArea = isArea && entity.tags.indoor && indoorAreaValues[entity.tags.indoor];
    const isBuilding = (entity.tags.building && entity.tags.building !== 'no') ||
      (entity.tags['building:part'] && entity.tags['building:part'] !== 'no');

    const entityTags: OsmTags = { ...entity.tags };  // shallow copy
    const extractTags: OsmTags = {};

    for (const key in entityTags) {
      if (entity.type === 'relation' && key === 'type') continue;
      if (keysToRetain.indexOf(key) !== -1) continue;
      if (isIndoorArea && key === 'indoor') continue;   // leave `indoor` tag on the area
      if (isBuilding && buildingKeysToRetain.test(key)) continue;

      // Copy the tag from the entity to the extracted point
      extractTags[key] = entityTags[key]!;

      // Keep addresses, level, and some other tags on both features
      if (keysToCopyAndRetain.indexOf(key) !== -1 || key.match(/^addr:.{1,}/)) continue;
      if (isIndoorArea && key === 'level') continue;

      // Remove the tag from the entity
      delete entityTags[key];
    }

    if (isArea && !isBuilding && !isIndoorArea) {
      entityTags.area = 'yes';  // ensure that areas keep area geometry
    }

    const replacement = new OsmNode(entity.context, { loc: extractLoc, tags: extractTags });
    graph.replace(replacement);
    _extractedNodeID = replacement.id;

    graph.replace(entity.update({ tags: entityTags }));
    return graph.commit();
  }


  /**
   * Returns the EntityID of the node created by the most recent call to this
   * action, or `undefined` if the action has not yet been run.
   * @return  The extracted node's EntityID, or `undefined`
   */
  action.getExtractedNodeID = function(): EntityID | undefined {
    return _extractedNodeID;
  };

  return action;
}
