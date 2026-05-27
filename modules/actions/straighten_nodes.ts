import { geomGetSmallestSurroundingRectangle, projWorldToWgs84, vecAdd, vecInterp, vecProject, vecSubtract } from '@rapid-sdk/math';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Aligns selected nodes along their common axis of symmetry.
 * Projects nodes onto the long axis of the smallest surrounding rectangle.
 * @param   nodeIDs   - Array of EntityIDs of nodes to straighten
 * @return  An Action function that straightens the given nodes
 */
export function actionStraightenNodes(nodeIDs: EntityID[]): Action {

  /**
   * Returns a target line to snap the points to.
   * We use the long axis of the smallest surrounding rectangle.
   * @param    points - The points to consider
   * @returns  Target line, defined as [startPoint, endPoint]
   */
  function getTargetLine(points: Vec2[]): [Vec2, Vec2] {
    const surround = geomGetSmallestSurroundingRectangle(points);
    if (surround) {
      return surround.longAxis;
    } else {
      return [points[0], points[points.length - 1]];   // fallback: use first and last points
    }
  }


  const action: Action = ((graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);
    if (t === 0) return graph;

    const nodes: OsmNode[] = [];
    const points: Vec2[] = [];
    let origin: Vec2 | undefined;

    // Gather all the nodes and their world coordinates, choose a local origin for floating point stability
    for (const nodeID of nodeIDs) {
      const node = graph.hasEntity(nodeID) as OsmNode;
      if (!node) continue;

      const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
      if (!coord) continue;
      if (!origin) origin = coord;
      nodes.push(node);
      points.push(vecSubtract(coord, origin));  // world -> local
    }
    if (!origin || !points.length) return graph;

    // Move points onto the target line.
    const line = getTargetLine(points);
    for (let i = 0; i < points.length; i++) {
      const closest = vecProject(points[i], line);
      if (!closest) continue;

      const node = nodes[i];
      const coord = vecAdd(closest.point, origin);  // local -> world
      const loc2 = projWorldToWgs84(coord);
      graph.replace(node.move(vecInterp(node.loc!, loc2, t)));
    }

    return graph.commit();
  }) as Action;


  /**
   * Returns a reason string if the straighten-nodes operation cannot be performed,
   * or `false` if it is allowed.
   * @param   graph - The current graph
   * @return  `'straight_enough'` if the selected nodes are already collinear within tolerance;
   *          `false` if the action is enabled
   */
  action.disabled = function(graph: Graph): string | false {
    const points: Vec2[] = [];
    let origin: Vec2 | undefined;

     // Gather all the nodes and their world coordinates, choose a local origin for floating point stability
    for (const nodeID of nodeIDs) {
      const node = graph.hasEntity(nodeID) as OsmNode;
      if (!node) continue;

      const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
      if (!coord)  continue;
      if (!origin) origin = coord;
      points.push(vecSubtract(coord, origin));  // world -> local
    }
    if (!origin || !points.length) return 'straight_enough';

    const line = getTargetLine(points);
    let maxDistance = 0;

    // Move points onto the line connecting the endpoints
    for (const point of points) {
      const closest = vecProject(point, line);
      if (!closest) continue;

      if (closest.distance > maxDistance) {
        maxDistance = closest.distance;
      }
    }

    if (maxDistance < 0.0001) {   // in world units
      return 'straight_enough';
    }
    return false;
  };


  action.transitionable = true;

  return action;
}
