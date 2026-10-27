import { actionDeleteMultiple } from './delete_multiple.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmRelation, OsmWay } from '../data/types.ts';


/**
 * Reverts an entity to its base (original) state.
 * If the entity was created (doesn't exist in base) and is a node, deletes it.
 * Otherwise reverts the entity to its base state.
 * If that brings back a deleted way or relation, its deleted child nodes and members come back too,
 * so the restored entity is complete (deleting a way also deletes its untagged nodes).
 *
 * @param   entityID  - EntityID of the entity to revert
 * @return  An Action function that reverts the entity to its original state.
 */
export function actionRevert(entityID: EntityID): Action {
  return (graph: Graph): Graph => {
    const head = graph.hasEntity(entityID);
    const base = graph.base.entities.get(entityID);

    if (head && !base && head.type === 'node') {   // Entity didn't exist in base, delete it..
      return actionDeleteMultiple([entityID])(graph);
    }

    graph = graph.revert(entityID);

    // Restore any children that were deleted locally (in base, but not in the graph)..
    const queue = [graph.hasEntity(entityID)];
    while (queue.length) {
      const entity = queue.pop();
      const childIDs = (entity as OsmWay | undefined)?.nodes ?? (entity as OsmRelation | undefined)?.members?.map(m => m.id) ?? [];
      for (const childID of childIDs) {
        if (graph.base.entities.has(childID) && !graph.hasEntity(childID)) {
          graph = graph.revert(childID);
          queue.push(graph.hasEntity(childID));
        }
      }
    }

    return graph.commit();
  };
}
