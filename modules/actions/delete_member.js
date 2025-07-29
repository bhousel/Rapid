import { actionDeleteRelation } from './delete_relation.js';


export function actionDeleteMember(relationID, index, doDeleteDegenerate = true) {
  return graph => {
    const relation = graph.entity(relationID).removeMember(index);
    graph.replace(relation);

    if (doDeleteDegenerate && relation.isDegenerate()) {
      return actionDeleteRelation(relation.id, doDeleteDegenerate)(graph);
    } else {
      return graph.commit();
    }
  };
}
