import { actionDeleteRelation } from './delete_relation.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmRelation } from '../data/OsmRelation.ts';


/**
 * actionDeleteMember
 * Removes a member from a relation at the specified index.
 * @param relationID - The ID of the relation to modify
 * @param index - The index of the member to remove
 * @param doDeleteDegenerate - Whether to delete the relation if it becomes degenerate (default: true)
 * @return Action that removes the member from the relation
 */
export function actionDeleteMember(relationID: EntityID, index: number, doDeleteDegenerate: boolean = true): Action {
  return (graph: Graph): Graph => {
    const relation = (graph.entity(relationID) as OsmRelation).removeMember(index);
    graph.replace(relation);

    if (doDeleteDegenerate && relation.isDegenerate()) {
      return actionDeleteRelation(relation.id, doDeleteDegenerate)(graph);
    } else {
      return graph.commit();
    }
  };
}
