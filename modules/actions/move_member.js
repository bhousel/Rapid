export function actionMoveMember(relationID, fromIndex, toIndex) {
  return graph => {
    return graph.replace(graph.entity(relationID).moveMember(fromIndex, toIndex)).commit();
  };
}
