import { DEG2RAD, TAU, projWorldToWgs84, vecAdd, vecAngle, vecInterp, vecLength, vecLengthSquare, vecSubtract } from '@rapid-sdk/math';
import { OsmNode } from '../data/OsmNode.ts';
import { utilArrayUniq } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmWay } from '../data/OsmWay.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Circularizes a given closed way.
 *
 * The algorithm parameterizes the original boundary by arc length: each
 * original node gets a fraction t in [0, 1) of the way around the circle,
 * proportional to how far along the input perimeter it sits.  Because node
 * order on the circle is determined by boundary order (not by angle from the
 * centroid), arbitrarily concave inputs can't produce a self-intersecting
 * result.  Extra in-between nodes are then inserted into each arc so no two
 * adjacent nodes span more than `maxDegrees`.
 *
 * @param   wayID       - EntityID of the way to circularize
 * @param   maxDegrees  - Maximum angle between adjacent nodes (default: 20)
 * @return  An Action function that circularizes the given way
 */
export function actionCircularize(wayID: EntityID, maxDegrees: number = 20): Action {
  const maxAngle = maxDegrees * DEG2RAD;

  const action = ((graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);
    if (t === 0) return graph;

    let way = graph.entity(wayID) as OsmWay;

    // The way already has a world-space centroid precomputed; use it as the
    // local origin so the math stays away from huge EPSG:3857 magnitudes.
    const origin = way.geoms.parts[0]?.world?.centroid;
    if (!origin) return graph;

    // Gather the unique original nodes with their world coords (in local space).
    // Also pick out the "interesting" subset (members of other ways, members of
    // relations, or tagged) - the radius is biased toward these so the circle
    // stays close to nodes that other features depend on.
    const origNodes: OsmNode[] = [];
    const origPoints: Vec2[] = [];
    const interesting: Vec2[] = [];

    for (const node of utilArrayUniq(graph.childNodes(way))) {
      const coord = node.geoms.parts[0].world?.coords as Vec2 | undefined;
      if (!coord) continue;
      const point = vecSubtract(coord, origin);  // world -> local
      origNodes.push(node);
      origPoints.push(point);
      if (node.isInteresting(graph)) {
        interesting.push(point);
      }
    }
    const n = origNodes.length;
    if (n < 3) return graph;

    // Target radius: median distance from centroid, preferring interesting
    // points when there are any.
    const radius = median(interesting.length ? interesting : origPoints);
    if (!radius) return graph;

    // Winding direction: +1 = CCW, -1 = CW (in y-up math space).
    const sign = way.geoms.parts[0]?.local?.winding ?? 1;

    // Arc-length parameterize the original boundary: cumulativeDist[i] is the distance
    // walked from origPoints[0] to origPoints[i].  This is the key idea — node
    // order on the circle is determined by boundary order, not by angle from
    // the centroid, which means arbitrarily concave shapes can't self-intersect.
    const cumulativeDist: number[] = new Array(n);
    cumulativeDist[0] = 0;
    for (let i = 1; i < n; i++) {
      cumulativeDist[i] = cumulativeDist[i - 1] + vecLength(origPoints[i - 1], origPoints[i]);
    }
    const perimeter = cumulativeDist[n - 1] + vecLength(origPoints[n - 1], origPoints[0]);
    if (!perimeter) return graph;

    // Anchor node 0 at its original angle so the resulting circle's rotation
    // roughly matches the input.
    const theta0 = vecAngle([0, 0], origPoints[0]);
    const angleAt = (i: number): number => theta0 + sign * (cumulativeDist[i] / perimeter) * TAU;

    // Walk the original nodes, placing each on the circle and inserting any
    // needed in-between nodes between it and the next.  Remember each inserted
    // batch alongside the edge it belongs to, so we can mirror them into any
    // shared ways below.
    const newNodeIDs: EntityID[] = [];
    const gaps: Array<{ a: OsmNode; b: OsmNode; ids: EntityID[] }> = [];

    for (let i = 0; i < n; i++) {
      const inext = (i + 1) % n;

      // Place this original node on the circle (transitioned by t).
      const startAngle = angleAt(i);
      const targetA: Vec2 = [Math.cos(startAngle) * radius, Math.sin(startAngle) * radius];
      const movedA = origNodes[i].move(
        projWorldToWgs84(vecAdd(vecInterp(origPoints[i], targetA, t), origin))
      );
      graph.replace(movedA);
      newNodeIDs.push(movedA.id);

      // How many in-between nodes does this arc need?  The arc spans `gap`
      // radians in the winding direction; normalize to (0, TAU] so the wrap
      // around the closing edge is handled by the same formula.
      let gap = sign * (angleAt(inext) - startAngle);
      while (gap <= 0) gap += TAU;
      while (gap > TAU) gap -= TAU;

      const numNew = Math.max(0, Math.ceil(gap / maxAngle) - 1);
      const ids: EntityID[] = [];

      for (let j = 1; j <= numNew; j++) {
        const frac = j / (numNew + 1);
        const a = startAngle + sign * gap * frac;
        const targetNew: Vec2 = [Math.cos(a) * radius, Math.sin(a) * radius];
        // For a smooth t=0..1 transition, treat each new node's "original"
        // position as the linear interpolation between its bracketing nodes.
        const origInterp = vecInterp(origPoints[i], origPoints[inext], frac);
        const loc = projWorldToWgs84(vecAdd(vecInterp(origInterp, targetNew, t), origin));
        const newNode = new OsmNode(way.context, { loc });
        graph.replace(newNode);
        newNodeIDs.push(newNode.id);
        ids.push(newNode.id);
      }

      if (ids.length) {
        gaps.push({ a: origNodes[i], b: origNodes[inext], ids });
      }
    }

    // For each gap, mirror the inserted nodes into any other way that has the
    // same pair as adjacent nodes.  Walk the shared way's node list directly
    // to find the (a, b) edge - this is unambiguous about direction and wrap,
    // unlike comparing lastIndexOf positions.
    for (const { a, b, ids } of gaps) {
      const parentWays = graph.parentWays(a);
      for (let sharedWay of parentWays) {
        if (sharedWay.id === way.id) continue;
        const edge = findEdge(sharedWay, a.id, b.id);
        if (!edge) continue;
        const toInsert = edge.reversed ? ids.slice().reverse() : ids;
        for (let k = 0; k < toInsert.length; k++) {
          sharedWay = sharedWay.addNode(toInsert[k], edge.insertAt + k);
        }
        graph.replace(sharedWay);
      }
    }

    // Close the ring and replace the way.
    newNodeIDs.push(newNodeIDs[0]);
    way = way.update({ nodes: newNodeIDs });
    graph.replace(way);
    return graph.commit();
  }) as Action;


  /**
   * Returns a reason string if the circularize operation cannot be performed,
   * or `false` if it is allowed.
   * @param   graph - The current graph
   * @return  `'not_closed'` if the way is not a closed loop or its geometry is unavailable;
   *          `false` if the action is enabled
   */
  action.disabled = (graph: Graph): string | false => {
    const way = graph.entity(wayID) as OsmWay;
    const geom = way.geoms.parts[0]?.world;
    const points = geom?.outer;
    const hull = geom?.hull;
    const centroid = geom?.centroid;

    if (!way.isClosed() || !points || !hull || !centroid) {
      return 'not_closed';
    }

    const radiusSq = vecLengthSquare(centroid, points[0]);

    // compare distances between centroid and points
    for (const currPoint of hull) {
      const currDist = vecLengthSquare(currPoint, centroid);
      const diff = Math.abs(currDist - radiusSq);
      if (diff > 0.05 * radiusSq) {   // compare distances with epsilon-error (5%)
        return false;
      }
    }

    // check if central angles are smaller than maxAngle
    for (let i = 0; i < hull.length; i++) {
      const currPoint = hull[i];
      const nextPoint = hull[(i+1) % hull.length];
      const startAngle = vecAngle(centroid, currPoint);
      const endAngle = vecAngle(centroid, nextPoint);
      let angle = endAngle - startAngle;
      if (angle < 0) {
        angle = -angle;
      }
      if (angle > Math.PI) {
        angle = (TAU - angle);
      }

      if (angle > maxAngle + DEG2RAD) {
        return false;
      }
    }

    return 'already_circular';
  };


  /**
   * Find the directed edge (a -> b) in a way.  If the way has the pair in the
   * opposite order, returns `reversed: true`.  `insertAt` is the position to
   * insert new nodes that should sit between `a` and `b` in the way's
   * own (a, b) order — caller should reverse the list of new nodes if needed.
   */
  function findEdge(way: OsmWay, a: EntityID, b: EntityID): { insertAt: number; reversed: boolean } | null {
    const nodes = way.nodes;
    for (let i = 0; i < nodes.length - 1; i++) {
      if (nodes[i] === a && nodes[i + 1] === b) return { insertAt: i + 1, reversed: false };
      if (nodes[i] === b && nodes[i + 1] === a) return { insertAt: i + 1, reversed: true };
    }
    return null;
  }


  /**
   * Returns the median distance of an array of coordinates.
   * (i.e. the middle value when all distances are computed and sorted)
   * @param    coords - the coordinates to check
   * @returns  median distance
   */
  function median(coords: Vec2[]): number | undefined {
    if (!coords.length) return undefined;

    const sorted = coords.map(coord => vecLength(coord)).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 !== 0
      ? sorted[mid]                           // Odd length, use exact mid
      : (sorted[mid - 1] + sorted[mid]) / 2;  // Even length, take average
  };


  action.transitionable = true;


  return action;
}
