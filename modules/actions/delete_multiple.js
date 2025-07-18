import { actionDeleteNode } from './delete_node.js';
import { actionDeleteRelation } from './delete_relation.js';
import { actionDeleteWay } from './delete_way.js';


export function actionDeleteMultiple(ids) {
  const actions = {
    way: actionDeleteWay,
    node: actionDeleteNode,
    relation: actionDeleteRelation
  };

  return graph => {
    ids.forEach(function(id) {
      if (graph.hasEntity(id)) { // It may have been deleted already.
        graph = actions[graph.entity(id).type](id)(graph);
      }
    });

    return graph;
  };
}
