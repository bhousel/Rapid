import { utilGetAllNodes } from '@rapid-sdk/util';


export function actionScale(entityIDs, pivotLoc, scaleFactor, viewport) {
  return graph => {
    const nodes = utilGetAllNodes(entityIDs, graph);
    for (const node of nodes) {
      let point = viewport.project(node.loc);
      let radial = [
        point[0] - pivotLoc[0],
        point[1] - pivotLoc[1]
      ];
      point = [
        pivotLoc[0] + (scaleFactor * radial[0]),
        pivotLoc[1] + (scaleFactor * radial[1])
      ];

      graph.replace(node.move(viewport.unproject(point)));
    }

    return graph.commit();
  };
}
