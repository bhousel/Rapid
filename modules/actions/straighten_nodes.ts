import {
  geomGetSmallestSurroundingRectangle, projWorldToWgs84, Vec2,
  vecAdd, vecDot, vecInterp, vecLength, vecSubtract
} from '@rapid-sdk/math';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';


/**
 * Aligns selected nodes along their common axis of symmetry.
 * Projects nodes onto the long axis of the smallest surrounding rectangle.
 * @param   nodeIDs   - Array of EntityIDs of nodes to straighten
 * @return  An Action function that straightens the given nodes
 */
export function actionStraightenNodes(nodeIDs: EntityID[]): Action {

  function positionAlongWay(a: Vec2, o: Vec2, b: Vec2): number {
    return vecDot(a, b, o) / vecDot(b, b, o);
  }

  // returns the endpoints of the long axis of symmetry of the `points` bounding rect
  function getEndpoints(points: Vec2[]): [Vec2, Vec2] {
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


    const [startPoint, endPoint] = getEndpoints(points);

    // Move points onto the line connecting the endpoints
    for (let i = 0; i < points.length; i++) {
      const node = nodes[i];
      const point = points[i];
      const u = positionAlongWay(point, startPoint, endPoint);
      const final = vecInterp(startPoint, endPoint, u);
      const coord = vecAdd(final, origin);  // local -> world
      const loc2 = projWorldToWgs84(coord);
      graph.replace(node.move(vecInterp(node.loc!, loc2, t)));
    }

    return graph.commit();
  }) as Action;


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

    const [startPoint, endPoint] = getEndpoints(points);
    let maxDistance = 0;

    for (const point of points) {
      const u = positionAlongWay(point, startPoint, endPoint);
      const p = vecInterp(startPoint, endPoint, u);
      const dist = vecLength(p, point);

      if (!isNaN(dist) && dist > maxDistance) {
        maxDistance = dist;
      }
    }

    if (maxDistance < 0.0001) {
      return 'straight_enough';
    }
    return false;
  };


  action.transitionable = true;

  return action;
}
