export function actionChangeTags(entityID, tags) {
  return graph => {
    return graph.replace(graph.entity(entityID).update({ tags: tags })).commit();
  };
}
