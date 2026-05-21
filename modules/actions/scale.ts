import { geomScale, projWorldToWgs84, projWgs84ToWorld, vecAdd, vecInterp, vecSubtract } from '@rapid-sdk/math';
import { utilGetAllNodes } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Scales the given EntityIDs relative to a given origin point.
 * @param   entityIDs    - Array of EntityIDs to scale
 * @param   originLoc    - The origin point in WGS84 (lon,lat)
 * @param   scaleFactor  - The scale factor (1.0 = no change)
 * @return  An Action function that scales the entities in the graph
 */
export function actionScale(entityIDs: EntityID[], originLoc: Vec2, scaleFactor: number): Action {

  const action = (graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);

    const collection = utilGetAllNodes(entityIDs, graph) as OsmNode[];
    const nodes: OsmNode[] = [];
    const points: Vec2[] = [];
    const origin = projWgs84ToWorld(originLoc);

     // Gather all the nodes and their world coordinates, localize to origin for floating point stability
    for (const node of collection) {
      const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
      if (!coord)  continue;
      nodes.push(node);
      points.push(vecSubtract(coord, origin));  // world -> local
    }
    if (!points.length) return graph;

    // Scale the points
    const scaled = geomScale(points, scaleFactor, [0, 0]);

    // Update the nodes
    for (let i = 0; i < nodes.length; i++) {
      let node = nodes[i];
      const coord = vecAdd(scaled[i], origin);  // local -> world
      const loc2 = projWorldToWgs84(coord);
      node = node.move(vecInterp(node.loc!, loc2, t));
      graph.replace(node);
    }

    return graph.commit();
  };

  action.transitionable = true;

  return action;
}
