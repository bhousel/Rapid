import { actionDeleteMultiple } from './delete_multiple.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';


/**
 * Reverts an entity to its base (original) state.
 * If the entity was created (doesn't exist in base) and is a node, deletes it.
 * Otherwise reverts the entity to its base state.
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
    } else {
      return graph.revert(entityID).commit();
    }
  };
}
