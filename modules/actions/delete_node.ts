import { actionDeleteRelation } from './delete_relation.ts';
import { actionDeleteWay } from './delete_way.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';


/**
 * actionDeleteNode
 * Deletes a node and removes it from all parent ways and relations.
 * If doDeleteDegenerate is true, also deletes any ways or relations that
 * become degenerate as a result.
 *
 * @param   nodeID             - EntityID of the node to delete
 * @param   doDeleteDegenerate - Whether to delete degenerate parents (default: true)
 * @return  An Action function that deletes the node from the graph
 */
export function actionDeleteNode(nodeID: EntityID, doDeleteDegenerate: boolean = true): Action {

  return (graph: Graph): Graph => {
    const node = graph.entity(nodeID) as OsmNode;

    // remove node from parent relations
    for (let relation of graph.parentRelations(node)) {
      relation = relation.removeMembersWithID(nodeID);
      graph.replace(relation);

      if (doDeleteDegenerate && relation.isDegenerate()) {
        graph = actionDeleteRelation(relation.id, doDeleteDegenerate)(graph);
      }
    }

    // remove node from parent ways
    for (let way of graph.parentWays(node)) {
      way = way.removeNode(nodeID);
      graph.replace(way);

      if (doDeleteDegenerate && way.isDegenerate()) {
        graph = actionDeleteWay(way.id, doDeleteDegenerate)(graph);
      }
    }

    // remove node
    return graph.remove(node).commit();
  };
}
