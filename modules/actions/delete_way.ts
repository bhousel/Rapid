import { actionDeleteRelation } from './delete_relation.ts';
import { osmNodeGeometriesForTags } from '../lib/tags.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { OsmWay } from '../data/OsmWay.ts';


/**
 * actionDeleteWay
 * Deletes a way and removes it from all parent relations.
 * Also deletes child nodes that are no longer needed.
 * If doDeleteDegenerate is true, also deletes any relations that
 * become degenerate as a result.
 *
 * @param   wayID              - EntityID of the way to delete
 * @param   doDeleteDegenerate - Whether to delete degenerate parents (default: true)
 * @return  An Action function that deletes the way from the graph
 */
export function actionDeleteWay(wayID: EntityID, doDeleteDegenerate: boolean = true): Action {
  return (graph: Graph): Graph => {
    let way = graph.entity(wayID) as OsmWay;

    // remove way from parent relations
    for (let parent of graph.parentRelations(way)) {
      parent = parent.removeMembersWithID(wayID);
      graph.replace(parent);
      if (doDeleteDegenerate && parent.isDegenerate()) {
        actionDeleteRelation(parent.id, doDeleteDegenerate)(graph);
      }
    }

    // remove child nodes from this way
    const nodeIDs = new Set(way.nodes);
    way = way.update({ nodes: [] });
    graph.replace(way);

    for (const nodeID of nodeIDs) {
      const node = graph.entity(nodeID) as OsmNode;
      if (canDeleteNode(node, graph)) {
        graph.remove(node);
      }
    }

    // remove way
    return graph.remove(way).commit();
  };


  function canDeleteNode(node: OsmNode, graph: Graph): boolean {
    // Don't delete nodes still attached to ways or relations
    if (graph.parentWays(node).length || graph.parentRelations(node).length) return false;

    const geometries = osmNodeGeometriesForTags(node.tags);
    if (geometries.point) return false;    // don't delete if this node can be a standalone point
    if (geometries.vertex) return true;    // do delete if this node can only be a vertex

    // If not sure, only delete if there are no interesting tags
    return !node.hasInterestingTags();
  }

}
