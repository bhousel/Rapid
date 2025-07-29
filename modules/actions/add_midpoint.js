import { geomEdgeEqual } from '@rapid-sdk/math';
import { utilArrayIntersection } from '@rapid-sdk/util';


export function actionAddMidpoint(midpoint, node) {
  return graph => {
    graph.replace(node.move(midpoint.loc)).commit();

    const parents = utilArrayIntersection(
      graph.parentWays(graph.entity(midpoint.edge[0])),
      graph.parentWays(graph.entity(midpoint.edge[1]))
    );

    parents.forEach(way => {
      for (let i = 0; i < way.nodes.length - 1; i++) {
        if (geomEdgeEqual([way.nodes[i], way.nodes[i + 1]], midpoint.edge)) {
          graph.replace(graph.entity(way.id).addNode(node.id, i + 1));

          // Add only one midpoint on doubled-back segments,
          // turning them into self-intersections.
          return;
        }
      }
    });

    return graph.commit();
  };
}
