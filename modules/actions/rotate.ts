import { geomRotate, projWorldToWgs84 } from '@rapid-sdk/math';
import { utilGetAllNodes } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';

/**
 * Rotates the given EntityIDs around a pivot point.
 * @param   entityIDs  - Array of EntityIDs to rotate
 * @param   pivot      - The pivot point in world coordinates
 * @param   angle      - The rotation angle in radians
 * @return  An Action function that rotates the entities in the graph
 */
export function actionRotate(entityIDs: EntityID[], pivot: Vec2, angle: number): Action {
  const action = (graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);
    if (t === 0) return graph;

    const collection = utilGetAllNodes(entityIDs, graph) as OsmNode[];
    const nodes: OsmNode[] = [];
    const points: Vec2[] = [];

     // Gather all the nodes and their world coordinates
    for (const node of collection) {
      const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
      if (!coord)  continue;
      nodes.push(node);
      points.push(coord);
    }
    if (!points.length) return graph;

    // Rotate the points
    const rotated = geomRotate(points, angle * t, pivot);

    // Update the nodes
    for (let i = 0; i < nodes.length; i++) {
      let node = nodes[i];
      node = node.move(projWorldToWgs84(rotated[i]));
      graph.replace(node);
    }

    return graph.commit();
  };

  action.transitionable = true;

  return action;
}
