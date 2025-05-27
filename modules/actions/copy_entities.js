export function actionCopyEntities(ids, fromGraph) {
  const _copies = {};

  const action = (graph) => {
    for (const id of ids) {
      fromGraph.entity(id).copy(fromGraph, _copies);
    }

    for (var id in _copies) {
      graph = graph.replace(_copies[id]);
    }

    return graph;
  };


  action.copies = () => _copies;

  return action;
}
