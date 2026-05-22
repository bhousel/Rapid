import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmRelation, OsmRelationMember } from '../data/OsmRelation.ts';


/**
 * Updates a member in a relation at the specified index.
 * @param   relationID - The ID of the relation to modify
 * @param   member - The new member data
 * @param   index - The index of the member to update
 * @return  An Action function that updates the relation member
 */
export function actionChangeMember(relationID: EntityID, member: OsmRelationMember, index: number): Action {
  return (graph: Graph): Graph => {
    return graph.replace((graph.entity(relationID) as OsmRelation).updateMember(member, index)).commit();
  };
}
