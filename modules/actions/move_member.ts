import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmRelation } from '../data/OsmRelation.ts';


/**
 * actionMoveMember
 * Moves a member within a relation from one index to another.
 * @param relationID - The ID of the relation to modify
 * @param fromIndex - The current index of the member
 * @param toIndex - The destination index for the member
 * @return Action that reorders the relation member
 */
export function actionMoveMember(relationID: EntityID, fromIndex: number, toIndex: number): Action {
  return (graph: Graph): Graph => {
    return graph.replace((graph.entity(relationID) as OsmRelation).moveMember(fromIndex, toIndex)).commit();
  };
}
