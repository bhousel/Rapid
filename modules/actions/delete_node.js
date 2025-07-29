import { actionDeleteRelation } from './delete_relation.js';
import { actionDeleteWay } from './delete_way.js';


export function actionDeleteNode(nodeID, doDeleteDegenerate = true) {

  return graph => {
    const node = graph.entity(nodeID);

    // remove node from parent relations
    for (let relation of graph.parentRelations(node)) {
      relation = relation.removeMembersWithID(nodeID);
      graph.replace(relation);

      if (doDeleteDegenerate && relation.isDegenerate()) {
        graph = actionDeleteRelation(relation.id, doDeleteDegenerate)(graph);
      }
    }

    // remove node from parent ways
    for (let way of graph.parentWays(node)) {
      way = way.removeNode(nodeID);
      graph.replace(way);

      if (doDeleteDegenerate && way.isDegenerate()) {
        graph = actionDeleteWay(way.id, doDeleteDegenerate)(graph);
      }
    }

    // remove node
    return graph.remove(node).commit();
  };
}
