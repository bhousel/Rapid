export function actionCopyEntities(ids, fromGraph) {
  const _copies = {};

  const action = (graph) => {
    for (const id of ids) {
      fromGraph.entity(id).copy(fromGraph, _copies);
    }

    graph.replace(Object.values(_copies));
    return graph.commit();
  };


  action.copies = () => _copies;

  return action;
}
