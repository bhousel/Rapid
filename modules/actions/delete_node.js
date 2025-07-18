import { actionDeleteRelation } from './delete_relation.js';
import { actionDeleteWay } from './delete_way.js';


export function actionDeleteNode(nodeID) {

  return graph => {
    var node = graph.entity(nodeID);

    graph.parentWays(node)
      .forEach(parent => {
        parent = parent.removeNode(nodeID);
        graph.replace(parent);

        if (parent.isDegenerate()) {
          graph = actionDeleteWay(parent.id)(graph);
        }
      });

    graph.parentRelations(node)
      .forEach(parent => {
        parent = parent.removeMembersWithID(nodeID);
        graph.replace(parent);

        if (parent.isDegenerate()) {
          graph = actionDeleteRelation(parent.id)(graph);
        }
      });

    return graph.remove(node).commit();
  };
}
