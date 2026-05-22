import { actionDeleteMultiple } from './delete_multiple.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { OsmRelation } from '../data/OsmRelation.ts';


/**
 * Deletes a relation and removes it from all parent relations.
 * Also deletes child members that are no longer needed.
 * If `doDeleteDegenerate` is true, also deletes any relations that
 * become degenerate as a result.
 * @param   relationID           - EntityID of the relation to delete
 * @param   doDeleteDegenerate   - Whether to delete degenerate parents (default: true)
 * @param   allowUntaggedMembers - Whether to preserve untagged members (default: false)
 * @return  An Action function that deletes the relation from the graph
 */
export function actionDeleteRelation(relationID: EntityID, doDeleteDegenerate: boolean = true, allowUntaggedMembers: boolean = false): Action {

  return (graph: Graph): Graph => {
    let relation = graph.entity(relationID) as OsmRelation;

    // remove this relation from its parents
    for (let parent of graph.parentRelations(relation)) {
      parent = parent.removeMembersWithID(relationID);
      graph.replace(parent);

      if (doDeleteDegenerate && parent.isDegenerate()) {
        graph = actionDeleteRelation(parent.id, doDeleteDegenerate, allowUntaggedMembers)(graph);
      }
    }

    // remove child members from this relation
    const memberIDs = new Set(relation.members.map(m => m.id));
    relation = relation.update({ members: [] });
    graph.replace(relation);

    for (const memberID of memberIDs) {
      const entity = graph.hasEntity(memberID);
      if (entity && canDeleteEntity(entity, graph)) {
        graph = actionDeleteMultiple([memberID], doDeleteDegenerate)(graph);
      }
    }

    // remove relation
    return graph.remove(relation).commit();
  };


  function canDeleteEntity(entity: OsmEntity, graph: Graph): boolean {
    return !graph.parentWays(entity).length &&
      !graph.parentRelations(entity).length &&
      (!entity.hasInterestingTags() && !allowUntaggedMembers);
  }
}
