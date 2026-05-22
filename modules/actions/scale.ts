import { geomScale, projWorldToWgs84 } from '@rapid-sdk/math';
import { utilGetAllNodes } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Scales the given EntityIDs relative to a given origin point.
 * @param   entityIDs    - Array of EntityIDs to scale
 * @param   origin       - The origin point in world coordinates
 * @param   scaleFactor  - The scale factor (1.0 = no change)
 * @return  An Action function that scales the entities
 */
export function actionScale(entityIDs: EntityID[], origin: Vec2, scaleFactor: number): Action {

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

    // Scale the points
    const factor = 1 + t * (scaleFactor - 1);  // interpolate
    const scaled = geomScale(points, factor, origin);

    // Update the nodes
    for (let i = 0; i < nodes.length; i++) {
      let node = nodes[i];
      node = node.move(projWorldToWgs84(scaled[i]));
      graph.replace(node);
    }

    return graph.commit();
  };

  action.transitionable = true;

  return action;
}
