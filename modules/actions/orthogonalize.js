import {
  DEG2RAD, vecAdd, vecEqual, vecInterp, vecLength,
  vecNormalize, vecProject, vecScale, vecSubtract
} from '@rapid-sdk/math';

import { Graph } from '../data/lib/Graph.js';
import { actionDeleteNode } from './delete_node.js';
import { geoOrthoNormalizedDotProduct, geoOrthoCalcScore, geoOrthoCanOrthogonalize } from '../geo/index.js';


export function actionOrthogonalize(wayID, viewport, vertexID, degThresh, ep) {
  const epsilon = ep || 1e-4;
  const threshold = degThresh || 13;  // degrees within right or straight to alter

  // We test normalized dot products so we can compare as cos(angle)
  const lowerThreshold = Math.cos((90 - threshold) * DEG2RAD);
  const upperThreshold = Math.cos(threshold * DEG2RAD);


  var action = function(graph, t) {
    if (t === null || !isFinite(t)) t = 1;
    t = Math.min(Math.max(+t, 0), 1);

    let way = graph.entity(wayID);
    way = way.removeNode('');   // sanity check - remove any consecutive duplicates

    // since we're squaring, remove indication that this is physically unsquare
    if (way.tags.nonsquare) {
      const tags = Object.assign({}, way.tags);  // shallow copy
      delete tags.nonsquare;
      way = way.update({ tags: tags });
    }

    graph.replace(way);

    const isClosed = way.isClosed();
    let nodes = graph.childNodes(way).slice();  // shallow copy
    if (isClosed) nodes.pop();

    if (vertexID !== undefined) {
      nodes = nodeSubset(nodes, vertexID, isClosed);
      if (nodes.length !== 3) return graph.commit();
    }

    // note: all geometry functions here use the unclosed node/point/coord list
    let nodeCount = {};
    let points = [];
    let corner = { i: 0, dotp: 1 };
    let node, point, loc, score, motions, i, j;

    for (const node of nodes) {
      nodeCount[node.id] = (nodeCount[node.id] || 0) + 1;
      points.push({ id: node.id, coord: viewport.project(node.loc) });
    }

    if (points.length === 3) {   // move only one vertex for right triangle
      for (i = 0; i < 1000; i++) {
        motions = points.map(calcMotion);
        points[corner.i].coord = vecAdd(points[corner.i].coord, motions[corner.i]);
        score = corner.dotp;
        if (score < epsilon) break;
      }

      node = graph.entity(nodes[corner.i].id);
      loc = viewport.unproject(points[corner.i].coord);
      graph.replace(node.move(vecInterp(node.loc, loc, t)));

    } else {
      const straights = [];
      const simplified = [];

      // Remove points from nearly straight sections..
      // This produces a simplified shape to orthogonalize
      for (i = 0; i < points.length; i++) {
        point = points[i];
        let dotp = 0;
        if (isClosed || (i > 0 && i < points.length - 1)) {
          const a = points[(i - 1 + points.length) % points.length];
          const b = points[(i + 1) % points.length];
          dotp = Math.abs(geoOrthoNormalizedDotProduct(a.coord, b.coord, point.coord));
        }

        if (dotp > upperThreshold) {
          straights.push(point);
        } else {
          simplified.push(point);
        }
      }

      // Orthogonalize the simplified shape
      const originalPoints = clonePoints(simplified);
      let bestPoints = clonePoints(simplified);

      score = Infinity;
      for (i = 0; i < 1000; i++) {
        motions = simplified.map(calcMotion);

        for (j = 0; j < motions.length; j++) {
          simplified[j].coord = vecAdd(simplified[j].coord, motions[j]);
        }
        const newScore = geoOrthoCalcScore(simplified, isClosed, epsilon, threshold);
        if (newScore < score) {
          bestPoints = clonePoints(simplified);
          score = newScore;
        }
        if (score < epsilon) break;
      }

      const bestCoords = bestPoints.map(p => p.coord);
      if (isClosed) bestCoords.push(bestCoords[0]);

      // move the nodes that should move
      for (i = 0; i < bestPoints.length; i++) {
        point = bestPoints[i];
        if (!vecEqual(originalPoints[i].coord, point.coord)) {
          node = graph.entity(point.id);
          loc = viewport.unproject(point.coord);
          graph.replace(node.move(vecInterp(node.loc, loc, t)));
        }
      }

      // move the nodes along straight segments
      for (i = 0; i < straights.length; i++) {
        point = straights[i];
        if (nodeCount[point.id] > 1) continue;   // skip self-intersections

        node = graph.entity(point.id);

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
            graph.replace(node.move(vecInterp(node.loc, loc, t)));
          }
        }
      }
    }

    return graph.commit();


    function clonePoints(arr) {
      return arr.map(p => {
        return { id: p.id, coord: [p.coord[0], p.coord[1]] };
      });
    }


    function calcMotion(point, i, arr) {
      // don't try to move the endpoints of a non-closed way.
      if (!isClosed && (i === 0 || i === arr.length - 1)) return [0, 0];
      // don't try to move a node that appears more than once (self intersection)
      if (nodeCount[arr[i].id] > 1) return [0, 0];

      const a = arr[(i - 1 + arr.length) % arr.length].coord;
      const origin = point.coord;
      const b = arr[(i + 1) % arr.length].coord;
      let p = vecSubtract(a, origin);
      let q = vecSubtract(b, origin);

      const scale = 2 * Math.min(vecLength(p), vecLength(q));
      p = vecNormalize(p);
      q = vecNormalize(q);

      const dotp = (p[0] * q[0] + p[1] * q[1]);
      const val = Math.abs(dotp);

      if (val < lowerThreshold) {  // nearly orthogonal
        corner.i = i;
        corner.dotp = val;
        const vec = vecNormalize(vecAdd(p, q));
        return vecScale(vec, 0.1 * dotp * scale);
      }

      return [0, 0];   // do nothing
    }
  };


  // if we are only orthogonalizing one vertex,
  // get that vertex and the previous and next
  function nodeSubset(nodes, vertexID, isClosed) {
    const first = isClosed ? 0 : 1;
    const last = isClosed ? nodes.length : nodes.length - 1;

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


  action.disabled = function(graph) {
    let way = graph.entity(wayID);
    let g = new Graph(graph);    // make a copy
    way = way.removeNode('');    // sanity check - remove any consecutive duplicates
    g.replace(way);

    const isClosed = way.isClosed();
    let nodes = g.childNodes(way).slice();  // shallow copy
    if (isClosed) nodes.pop();

    let allowStraightAngles = false;
    if (vertexID !== undefined) {
      allowStraightAngles = true;
      nodes = nodeSubset(nodes, vertexID, isClosed);
      if (nodes.length !== 3) return 'end_vertex';
    }

    const coords = nodes.map(n => viewport.project(n.loc));
    const score = geoOrthoCanOrthogonalize(coords, isClosed, epsilon, threshold, allowStraightAngles);

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
