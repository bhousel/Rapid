import { vecRotate } from '@rapid-sdk/math';
import { utilGetAllNodes } from '@rapid-sdk/util';


export function actionRotate(entityIDs, pivot, angle, viewport) {
  return function(graph) {
    const nodes = utilGetAllNodes(entityIDs, graph);
    for (const node of utilGetAllNodes(entityIDs, graph)) {
      const point = vecRotate(viewport.project(node.loc), angle, pivot);
      graph = graph.replace(node.move(viewport.unproject(point)));
    }
    return graph;
  };
}
