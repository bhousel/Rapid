import { actionDeleteMember } from './delete_member.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';


/**
 * Removes multiple members from a relation by their indexes.
 * @param   relationID - The ID of the relation to modify
 * @param   memberIndexes - Array of indexes of members to remove
 * @param   doDeleteDegenerate - Whether to delete the relation if it becomes degenerate (default: true)
 * @return  An Action function that removes the members from the relation
 */
export function actionDeleteMembers(relationID: EntityID, memberIndexes: number[], doDeleteDegenerate: boolean = true): Action {
  return (graph: Graph): Graph => {
    // Remove the members in descending order so removals won't shift what members are at the remaining indexes
    memberIndexes.sort((a, b) => b - a);
    for (const i in memberIndexes) {
      graph = actionDeleteMember(relationID, memberIndexes[i], doDeleteDegenerate)(graph);
    }
    return graph;
  };
}
