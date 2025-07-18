
export function actionAddVertex(wayID, nodeID, index) {
  return graph => {
    return graph.replace(graph.entity(wayID).addNode(nodeID, index)).commit();
  };
}
