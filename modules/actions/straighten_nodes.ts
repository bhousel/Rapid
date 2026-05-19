import { geomGetDominantSurroundingRectangle, Vec2, vecDot, vecInterp, vecLength, Viewport } from '@rapid-sdk/math';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';


/**
 * Aligns selected nodes along their common axis of symmetry.
 * Projects nodes onto the long axis of the dominant surrounding rectangle.
 *
 * @param   nodeIDs   - Array of EntityIDs of nodes to straighten
 * @param   viewport  - The Viewport for coordinate conversion
 * @return  An Action that straightens the nodes
 */
export function actionStraightenNodes(nodeIDs: EntityID[], viewport: Viewport): Action {

  function positionAlongWay(a: Vec2, o: Vec2, b: Vec2): number {
    return vecDot(a, b, o) / vecDot(b, b, o);
  }

  // returns the endpoints of the long axis of symmetry of the `points` bounding rect
  function getEndpoints(points: Vec2[]): [Vec2, Vec2] {
    const surround = geomGetDominantSurroundingRectangle(points);
    if (!surround) {
      // fallback: use first and last points
      return [points[0], points[points.length - 1]];
    }

    // Choose line pq = axis of symmetry.
    // The shape's surrounding rectangle has 2 axes of symmetry.
    // Snap points to the long axis
    const p1: Vec2 = [(surround.polygon[0][0] + surround.polygon[1][0]) / 2, (surround.polygon[0][1] + surround.polygon[1][1]) / 2 ];
    const q1: Vec2 = [(surround.polygon[2][0] + surround.polygon[3][0]) / 2, (surround.polygon[2][1] + surround.polygon[3][1]) / 2 ];
    const p2: Vec2 = [(surround.polygon[3][0] + surround.polygon[4][0]) / 2, (surround.polygon[3][1] + surround.polygon[4][1]) / 2 ];
    const q2: Vec2 = [(surround.polygon[1][0] + surround.polygon[2][0]) / 2, (surround.polygon[1][1] + surround.polygon[2][1]) / 2 ];

    const isLong = (vecLength(p1, q1) > vecLength(p2, q2));
    return isLong ? [p1, q1] : [p2, q2];
  }


  const action: Action = ((graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);

    const nodes: OsmNode[] = nodeIDs.map(id => graph.entity(id) as OsmNode);
    const points: Vec2[] = nodes.map(n => viewport.project(n.loc!));
    const endpoints = getEndpoints(points);
    const startPoint: Vec2 = endpoints[0];
    const endPoint: Vec2 = endpoints[1];

    // Move points onto the line connecting the endpoints
    for (let i = 0; i < points.length; i++) {
      const node = nodes[i];
      const point = points[i];
      const u = positionAlongWay(point, startPoint, endPoint);
      const point2 = vecInterp(startPoint, endPoint, u);
      const loc2 = viewport.unproject(point2);
      graph.replace(node.move(vecInterp(node.loc!, loc2, t)));
    }

    return graph.commit();
  }) as Action;


  action.disabled = function(graph: Graph): string | false {
    const nodes: OsmNode[] = nodeIDs.map(id => graph.entity(id) as OsmNode);
    const points: Vec2[] = nodes.map(n => viewport.project(n.loc!));
    const endpoints = getEndpoints(points);
    const startPoint: Vec2 = endpoints[0];
    const endPoint: Vec2 = endpoints[1];
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
