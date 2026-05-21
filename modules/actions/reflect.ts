import { geomGetDominantSurroundingRectangle, geomReflect, projWorldToWgs84, vecAdd, vecInterp, vecSubtract } from '@rapid-sdk/math';
import { utilGetAllNodes } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** Interface for reflect action with useLongAxis setter/getter */
export interface ReflectAction extends Action {
  useLongAxis(): boolean;
  useLongAxis(val: boolean): ReflectAction;
}


/**
 * Reflects the given EntityIDs around their shared axis of symmetry.
 * @param   entityIDs  - Array of EntityIDs to reflect
 * @return  A ReflectAction that reflects the entities in the graph
 */
export function actionReflect(entityIDs: EntityID[]): ReflectAction {
  let _useLongAxis = true;


  const action = ((graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);

    const collection = utilGetAllNodes(entityIDs, graph) as OsmNode[];
    const nodes: OsmNode[] = [];
    const points: Vec2[] = [];
    let origin: Vec2 | undefined;

     // Gather all the nodes and their world coordinates, choose a local origin for floating point stability
    for (const node of collection) {
      const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
      if (!coord)  continue;
      if (!origin) origin = coord;
      nodes.push(node);
      points.push(vecSubtract(coord, origin));  // world -> local
    }
    if (!origin || !points.length) return graph;

    // Generate a surrounding rectangle
    const surround = geomGetDominantSurroundingRectangle(points);
    if (!surround) return graph;

    // Reflect the points
    const reflected = geomReflect(points, (_useLongAxis ? surround.longAxis : surround.shortAxis));

    // Update the nodes
    for (let i = 0; i < nodes.length; i++) {
      let node = nodes[i];
      const coord = vecAdd(reflected[i], origin);  // local -> world
      const loc2 = projWorldToWgs84(coord);
      node = node.move(vecInterp(node.loc!, loc2, t));
      graph.replace(node);
    }

    return graph.commit();

  }) as ReflectAction;


  action.useLongAxis = function(val?: boolean): any {
    if (!arguments.length) return _useLongAxis;
    _useLongAxis = val!;
    return action;
  };

  action.transitionable = true;

  return action;
}
