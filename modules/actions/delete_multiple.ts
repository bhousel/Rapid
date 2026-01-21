import { actionDeleteNode } from './delete_node.ts';
import { actionDeleteRelation } from './delete_relation.ts';
import { actionDeleteWay } from './delete_way.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';


/**
 * actionDeleteMultiple
 * Deletes multiple entities by dispatching to the appropriate delete action
 * based on entity type.
 *
 * @param   entityIDs          - Array of EntityIDs to delete
 * @param   doDeleteDegenerate - Whether to delete degenerate parents (default: true)
 * @return  An Action function that deletes the entities from the graph
 */
export function actionDeleteMultiple(entityIDs: EntityID[], doDeleteDegenerate: boolean = true): Action {
  const actions: Record<string, (id: EntityID, doDeleteDegenerate: boolean) => Action> = {
    way: actionDeleteWay,
    node: actionDeleteNode,
    relation: actionDeleteRelation
  };

  return (graph: Graph): Graph => {
    for (const entityID of entityIDs) {
      const entity = graph.hasEntity(entityID);
      if (entity) {  // It may have been deleted already.
        graph = actions[entity.type](entityID, doDeleteDegenerate)(graph);
      }
    }
    return graph;
  };
}
