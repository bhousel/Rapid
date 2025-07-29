import { actionDeleteMultiple } from './delete_multiple.js';


export function actionDeleteRelation(relationID, doDeleteDegenerate = true, allowUntaggedMembers = false) {

  return graph => {
    let relation = graph.entity(relationID);

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


  function canDeleteEntity(entity, graph) {
    return !graph.parentWays(entity).length &&
      !graph.parentRelations(entity).length &&
      (!entity.hasInterestingTags() && !allowUntaggedMembers);
  }
}
