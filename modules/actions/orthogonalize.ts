import { actionDeleteNode } from './delete_node.js';
import {
  DEG2RAD, vecAdd, vecEqual, vecInterp, vecLength,
  vecNormalize, vecProject, vecScale, vecSubtract
} from '@rapid-sdk/math';
import { geoOrthoCalcScore, geoOrthoCanOrthogonalize, geoOrthoNormalizedDotProduct } from '../geo/ortho.ts';
import { Graph } from '../lib/Graph.ts';
import { OsmNode } from '../data/OsmNode.ts';
import { OsmWay } from '../data/OsmWay.ts';

import type { Action } from './types.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


/** Point with ID and coordinate for orthogonalization */
interface OrthoPoint {
  id: EntityID;
  coord: Vec2;
}

/** Corner tracking for triangle orthogonalization */
interface Corner {
  i: number;
  dotp: number;
}


/**
 * actionOrthogonalize
 * Attempts to orthogonalize a way by making its angles closer to 90°.
 * For ways with 3 nodes, adjusts only the corner vertex.
 * For larger polygons, iteratively adjusts vertices to achieve right angles.
 *
 * @param   wayID      - EntityID of the way to orthogonalize
 * @param   viewport   - The Viewport for coordinate conversion
 * @param   vertexID   - Optional specific vertex to orthogonalize
 * @param   degThresh  - Degree threshold for angle adjustment (default: 13)
 * @param   ep         - Epsilon for convergence testing (default: 1e-4)
 * @return  An Action that orthogonalizes the way
 */
export function actionOrthogonalize(
  wayID: EntityID,
  viewport: Viewport,
  vertexID?: EntityID,
  degThresh?: number,
  ep?: number
): Action {
  const epsilon: number = ep || 1e-4;
  const threshold: number = degThresh || 13;  // degrees within right or straight to alter

  // We test normalized dot products so we can compare as cos(angle)
  const lowerThreshold: number = Math.cos((90 - threshold) * DEG2RAD);
  const upperThreshold: number = Math.cos(threshold * DEG2RAD);


  const action = function(graph: Graph, t?: number): Graph {
    if (t === null || t === undefined || !isFinite(t)) t = 1;
    t = Math.min(Math.max(+t, 0), 1);

    let way = graph.entity(wayID) as OsmWay;
    way = way.removeNode('');   // sanity check - remove any consecutive duplicates

    // since we're squaring, remove indication that this is physically unsquare
    if (way.tags.nonsquare) {
      const tags = Object.assign({}, way.tags);  // shallow copy
      delete tags.nonsquare;
      way = way.update({ tags: tags });
    }

    graph.replace(way);

    const isClosed: boolean = way.isClosed();
    let nodes: OsmNode[] = graph.childNodes(way).slice();  // shallow copy
    if (isClosed) nodes.pop();

    if (vertexID !== undefined) {
      nodes = nodeSubset(nodes, vertexID, isClosed);
      if (nodes.length !== 3) return graph.commit();
    }

    // note: all geometry functions here use the unclosed node/point/coord list
    const nodeCount: Record<EntityID, number> = {};
    const points: OrthoPoint[] = [];
    const corner: Corner = { i: 0, dotp: 1 };
    let node: OsmNode;
    let point: OrthoPoint;
    let loc: Vec2;
    let score: number;
    let motions: Vec2[];
    let i: number;
    let j: number;

    for (const n of nodes) {
      nodeCount[n.id] = (nodeCount[n.id] || 0) + 1;
      points.push({ id: n.id, coord: viewport.project(n.loc!) });
    }

    if (points.length === 3) {   // move only one vertex for right triangle
      for (i = 0; i < 1000; i++) {
        motions = points.map(calcMotion);
        points[corner.i].coord = vecAdd(points[corner.i].coord, motions[corner.i]);
        score = corner.dotp;
        if (score < epsilon) break;
      }

      node = graph.entity(nodes[corner.i].id) as OsmNode;
      loc = viewport.unproject(points[corner.i].coord);
      graph.replace(node.move(vecInterp(node.loc!, loc, t)));

    } else {
      const straights: OrthoPoint[] = [];
      const simplified: OrthoPoint[] = [];

      // Remove points from nearly straight sections..
      // This produces a simplified shape to orthogonalize
      for (i = 0; i < points.length; i++) {
        point = points[i];
        let dotp = 0;
        if (isClosed || (i > 0 && i < points.length - 1)) {
          const a: OrthoPoint = points[(i - 1 + points.length) % points.length];
          const b: OrthoPoint = points[(i + 1) % points.length];
          dotp = Math.abs(geoOrthoNormalizedDotProduct(a.coord, b.coord, point.coord));
        }

        if (dotp > upperThreshold) {
          straights.push(point);
        } else {
          simplified.push(point);
        }
      }

      // Orthogonalize the simplified shape
      const originalPoints: OrthoPoint[] = clonePoints(simplified);
      let bestPoints: OrthoPoint[] = clonePoints(simplified);

      score = Infinity;
      for (i = 0; i < 1000; i++) {
        motions = simplified.map(calcMotion);

        for (j = 0; j < motions.length; j++) {
          simplified[j].coord = vecAdd(simplified[j].coord, motions[j]);
        }
        const newScore: number = geoOrthoCalcScore(simplified, isClosed, epsilon, threshold);
        if (newScore < score) {
          bestPoints = clonePoints(simplified);
          score = newScore;
        }
        if (score < epsilon) break;
      }

      const bestCoords: Vec2[] = bestPoints.map(p => p.coord);
      if (isClosed) bestCoords.push(bestCoords[0]);

      // move the nodes that should move
      for (i = 0; i < bestPoints.length; i++) {
        point = bestPoints[i];
        if (!vecEqual(originalPoints[i].coord, point.coord)) {
          node = graph.entity(point.id) as OsmNode;
          loc = viewport.unproject(point.coord);
          graph.replace(node.move(vecInterp(node.loc!, loc, t)));
        }
      }

      // move the nodes along straight segments
      for (i = 0; i < straights.length; i++) {
        point = straights[i];
        if (nodeCount[point.id] > 1) continue;   // skip self-intersections

        node = graph.entity(point.id) as OsmNode;

        if (t === 1 &&
          graph.parentWays(node).length === 1 &&
          graph.parentRelations(node).length === 0 &&
          !node.hasInterestingTags()
        ) {
          // remove uninteresting points..
          graph = actionDeleteNode(node.id)(graph);

        } else {
          // move interesting points to the nearest edge..
          const choice = vecProject(point.coord, bestCoords);
          if (choice) {
            loc = viewport.unproject(choice.target);
            graph.replace(node.move(vecInterp(node.loc!, loc, t)));
          }
        }
      }
    }

    return graph.commit();


    function clonePoints(arr: OrthoPoint[]): OrthoPoint[] {
      return arr.map((p: OrthoPoint): OrthoPoint => {
        return { id: p.id, coord: [p.coord[0], p.coord[1]] };
      });
    }


    function calcMotion(point: OrthoPoint, i: number, arr: OrthoPoint[]): Vec2 {
      // don't try to move the endpoints of a non-closed way.
      if (!isClosed && (i === 0 || i === arr.length - 1)) return [0, 0];
      // don't try to move a node that appears more than once (self intersection)
      if (nodeCount[arr[i].id] > 1) return [0, 0];

      const a: Vec2 = arr[(i - 1 + arr.length) % arr.length].coord;
      const origin: Vec2 = point.coord;
      const b: Vec2 = arr[(i + 1) % arr.length].coord;
      let p: Vec2 = vecSubtract(a, origin);
      let q: Vec2 = vecSubtract(b, origin);

      const scale: number = 2 * Math.min(vecLength(p), vecLength(q));
      p = vecNormalize(p);
      q = vecNormalize(q);

      const dotp: number = (p[0] * q[0] + p[1] * q[1]);
      const val: number = Math.abs(dotp);

      if (val < lowerThreshold) {  // nearly orthogonal
        corner.i = i;
        corner.dotp = val;
        const vec: Vec2 = vecNormalize(vecAdd(p, q));
        return vecScale(vec, 0.1 * dotp * scale);
      }

      return [0, 0];   // do nothing
    }
  } as Action;


  // if we are only orthogonalizing one vertex,
  // get that vertex and the previous and next
  function nodeSubset(nodes: OsmNode[], vertexID: EntityID, isClosed: boolean): OsmNode[] {
    const first: number = isClosed ? 0 : 1;
    const last: number = isClosed ? nodes.length : nodes.length - 1;

    for (let i = first; i < last; i++) {
      if (nodes[i].id === vertexID) {
        return [
          nodes[(i - 1 + nodes.length) % nodes.length],
          nodes[i],
          nodes[(i + 1) % nodes.length]
        ];
      }
    }

    return [];
  }


  action.disabled = function(graph: Graph): string | false {
    let way = graph.entity(wayID) as OsmWay;
    const g: Graph = new Graph(graph);    // make a copy
    way = way.removeNode('');    // sanity check - remove any consecutive duplicates
    g.replace(way);

    const isClosed: boolean = way.isClosed();
    let nodes: OsmNode[] = g.childNodes(way).slice();  // shallow copy
    if (isClosed) nodes.pop();

    let allowStraightAngles = false;
    if (vertexID !== undefined) {
      allowStraightAngles = true;
      nodes = nodeSubset(nodes, vertexID, isClosed);
      if (nodes.length !== 3) return 'end_vertex';
    }

    const coords: Vec2[] = nodes.map((n: OsmNode): Vec2 => viewport.project(n.loc!));
    const score: number | null = geoOrthoCanOrthogonalize(coords, isClosed, epsilon, threshold, allowStraightAngles);

    if (score === null) {
      return 'not_squarish';
    } else if (score === 0) {
      return 'square_enough';
    } else {
      return false;
    }
  };


  action.transitionable = true;

  return action;
}
