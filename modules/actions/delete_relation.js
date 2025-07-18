import { utilArrayUniq } from '@rapid-sdk/util';

import { actionDeleteMultiple } from './delete_multiple.js';


export function actionDeleteRelation(relationID, allowUntaggedMembers) {

  return graph => {
    const relation = graph.entity(relationID);

    graph.parentRelations(relation)
      .forEach(parent => {
        parent = parent.removeMembersWithID(relationID);
        graph.replace(parent);

        if (parent.isDegenerate()) {
          graph = actionDeleteRelation(parent.id)(graph);
        }
      });

    const memberIDs = utilArrayUniq(relation.members.map(m => m.id));
    memberIDs.forEach(memberID => {
      graph.replace(relation.removeMembersWithID(memberID));

      const entity = graph.entity(memberID);
      if (canDeleteEntity(entity, graph)) {
        graph = actionDeleteMultiple([memberID])(graph);
      }
    });

    return graph.remove(relation).commit();
  };


  function canDeleteEntity(entity, graph) {
    return !graph.parentWays(entity).length &&
      !graph.parentRelations(entity).length &&
      (!entity.hasInterestingTags() && !allowUntaggedMembers);
  }
}
