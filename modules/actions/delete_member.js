import { actionDeleteRelation } from './delete_relation.js';


export function actionDeleteMember(relationID, index) {
  return graph => {
    const relation = graph.entity(relationID).removeMember(index);
    graph.replace(relation);

    if (relation.isDegenerate()) {
      return actionDeleteRelation(relation.id)(graph);
    } else {
      return graph.commit();
    }
  };
}
