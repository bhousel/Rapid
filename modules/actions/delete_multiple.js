import { actionDeleteNode } from './delete_node.js';
import { actionDeleteRelation } from './delete_relation.js';
import { actionDeleteWay } from './delete_way.js';


export function actionDeleteMultiple(entityIDs, doDeleteDegenerate = true) {
  const actions = {
    way: actionDeleteWay,
    node: actionDeleteNode,
    relation: actionDeleteRelation
  };

  return graph => {
    for (const entityID of entityIDs) {
      const entity = graph.hasEntity(entityID);
      if (entity) {  // It may have been deleted already.
        graph = actions[entity.type](entityID, doDeleteDegenerate)(graph);
      }
    }
    return graph;
  };
}
