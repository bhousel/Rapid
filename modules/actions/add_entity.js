export function actionAddEntity(entity) {
  return graph => {
    return graph.replace(entity).commit();
  };
}
