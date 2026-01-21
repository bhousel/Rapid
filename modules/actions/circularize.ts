import { DEG2RAD, vecAngle, vecInterp, vecLength, vecLengthSquare } from '@rapid-sdk/math';
import { median } from 'd3-array';
import { OsmNode } from '../data/OsmNode.ts';
import { utilArrayUniq } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmWay } from '../data/OsmWay.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


/**
 * actionCircularize
 * Circularizes a closed way to form a circle.
 *
 * @param   wayID       - EntityID of the way to circularize
 * @param   viewport    - The Viewport for coordinate conversion
 * @param   maxDegrees  - Maximum angle between adjacent nodes (default: 20)
 * @return  An Action that circularizes the way
 */
export function actionCircularize(wayID: EntityID, viewport: Viewport, maxDegrees: number = 20): Action {
  const maxAngle = maxDegrees * DEG2RAD;

  const action = ((graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);

    let way = graph.entity(wayID) as OsmWay;

    const origNodes = new Map<EntityID, OsmNode>();
    for (const node of graph.childNodes(way)) {
      origNodes.set(node.id, node);
    }

    // Before starting, make sure the shape is convex. see iD#2194
    // What we probably really want to do is return a collection
    //  of where the nodes want to move to, rather than moving them.
    if (!way.isConvex(graph)) {
      graph = _makeConvex(graph);
      way = graph.entity(wayID) as OsmWay;
    }

    // we already have the shape projected to world coordinates..
    // we can do less work here.
    const geom = way.geoms.parts[0]?.world;
    const centroidW = geom?.centroid;
    if (!centroidW) return graph;
    const centroid = viewport.worldToScreen(centroidW);

    const nodes = utilArrayUniq(graph.childNodes(way));
    let keyNodes = nodes.filter(n => graph.parentWays(n).length > 1);
    const points = nodes.map(n => viewport.project(n.loc!));
    let keyPoints = keyNodes.map(n => viewport.project(n.loc!));
    const radius = median(points, p => vecLength(centroid, p))!;
    const sign = geom.area! > 0 ? 1 : -1;
    let i: number, j: number, k: number;

    // we need at least two key nodes for the algorithm to work
    if (!keyNodes.length) {
      keyNodes = [nodes[0]];
      keyPoints = [points[0]];
    }

    if (keyNodes.length === 1) {
      const index = nodes.indexOf(keyNodes[0]);
      const oppositeIndex = Math.floor((index + nodes.length / 2) % nodes.length);

      keyNodes.push(nodes[oppositeIndex]);
      keyPoints.push(points[oppositeIndex]);
    }

    // key points and nodes are those connected to the ways,
    // they are projected onto the circle, in between nodes are moved
    // to constant intervals between key nodes, extra in between nodes are
    // added if necessary.
    for (i = 0; i < keyPoints.length; i++) {
      const nextKeyNodeIndex = (i + 1) % keyNodes.length;
      const startNode = keyNodes[i];
      const endNode = keyNodes[nextKeyNodeIndex];
      const startNodeIndex = nodes.indexOf(startNode);
      const endNodeIndex = nodes.indexOf(endNode);
      let numberNewPoints = -1;
      let indexRange = endNodeIndex - startNodeIndex;
      const nearNodes: Record<EntityID, number> = {};
      const inBetweenNodes: EntityID[] = [];
      let totalAngle: number;
      let eachAngle: number;
      let angle: number;
      let loc: Vec2;
      let node: OsmNode;
      let origNode: OsmNode;

      if (indexRange < 0) {
        indexRange += nodes.length;
      }

      // position this key node
      const distance = vecLength(centroid, keyPoints[i]) || 1e-4;
      keyPoints[i] = [
        centroid[0] + (keyPoints[i][0] - centroid[0]) / distance * radius,
        centroid[1] + (keyPoints[i][1] - centroid[1]) / distance * radius
      ];
      loc = viewport.unproject(keyPoints[i]);
      node = keyNodes[i];
      origNode = origNodes.get(node.id)!;
      node = node.move(vecInterp(origNode.loc!, loc, t));
      graph = graph.replace(node).commit();

      // figure out the between delta angle we want to match to
      const startAngle = Math.atan2(keyPoints[i][1] - centroid[1], keyPoints[i][0] - centroid[0]);
      const endAngle = Math.atan2(keyPoints[nextKeyNodeIndex][1] - centroid[1], keyPoints[nextKeyNodeIndex][0] - centroid[0]);
      totalAngle = endAngle - startAngle;

      // detects looping around -pi/pi
      if (totalAngle * sign > 0) {
        totalAngle = -sign * (2 * Math.PI - Math.abs(totalAngle));
      }

      do {
        numberNewPoints++;
        eachAngle = totalAngle / (indexRange + numberNewPoints);
      } while (Math.abs(eachAngle) > maxAngle);


      // move existing nodes
      for (j = 1; j < indexRange; j++) {
        angle = startAngle + j * eachAngle;
        loc = viewport.unproject([
          centroid[0] + Math.cos(angle) * radius,
          centroid[1] + Math.sin(angle) * radius
        ]);

        node = nodes[(j + startNodeIndex) % nodes.length];
        origNode = origNodes.get(node.id)!;
        nearNodes[node.id] = angle;

        node = node.move(vecInterp(origNode.loc!, loc, t));
        graph = graph.replace(node).commit();
      }

      // add new in between nodes if necessary
      for (j = 0; j < numberNewPoints; j++) {
        angle = startAngle + (indexRange + j) * eachAngle;
        loc = viewport.unproject([
          centroid[0] + Math.cos(angle) * radius,
          centroid[1] + Math.sin(angle) * radius
        ]);

        // choose a nearnode to use as the original
        let min = Infinity;
        for (const nodeID in nearNodes) {
          const nearAngle = nearNodes[nodeID];
          const dist = Math.abs(nearAngle - angle);
          if (dist < min) {
            min = dist;
            origNode = origNodes.get(nodeID)!;
          }
        }

        node = new OsmNode(way.context, { loc: vecInterp(origNode!.loc!, loc, t) });
        graph = graph.replace(node).commit();

        nodes.splice(endNodeIndex + j, 0, node);
        inBetweenNodes.push(node.id);
      }

      // Check for other ways that share these keyNodes..
      // If keyNodes are adjacent in both ways,
      // we can add inBetweenNodes to that shared way too..
      if (indexRange === 1 && inBetweenNodes.length) {
        const startIndex1 = way.nodes.lastIndexOf(startNode.id);
        const endIndex1 = way.nodes.lastIndexOf(endNode.id);
        let wayDirection1 = (endIndex1 - startIndex1);
        if (wayDirection1 < -1) wayDirection1 = 1;

        const parentWays = graph.parentWays(keyNodes[i]);
        for (j = 0; j < parentWays.length; j++) {
          let sharedWay = parentWays[j];
          if (sharedWay === way) continue;

          if (sharedWay.isAdjacent(startNode.id, endNode.id)) {
            const startIndex2 = sharedWay.nodes.lastIndexOf(startNode.id);
            const endIndex2 = sharedWay.nodes.lastIndexOf(endNode.id);
            let wayDirection2 = (endIndex2 - startIndex2);
            let insertAt = endIndex2;
            if (wayDirection2 < -1) wayDirection2 = 1;

            if (wayDirection1 !== wayDirection2) {
              inBetweenNodes.reverse();
              insertAt = startIndex2;
            }
            for (k = 0; k < inBetweenNodes.length; k++) {
              sharedWay = sharedWay.addNode(inBetweenNodes[k], insertAt + k);
            }
            graph = graph.replace(sharedWay).commit();
          }
        }
      }
    }

    // update the way to have all the new nodes
    const ids = nodes.map(n => n.id);
    ids.push(ids[0]);

    way = way.update({ nodes: ids });
    return graph.replace(way).commit();
  }) as Action;


  action.disabled = (graph: Graph): string | false => {
    const way = graph.entity(wayID) as OsmWay;
    const geom = way.geoms.parts[0]?.world;
    const points = geom?.outer;
    const hull = geom?.hull;
    const centroid = geom?.centroid;

    if (!way.isClosed() || !points || !hull || !centroid) {
      return 'not_closed';
    }

    const radius = vecLengthSquare(centroid, points[0]);

    // compare distances between centroid and points
    for (const currPoint of hull) {
      const currDist = vecLengthSquare(currPoint, centroid);
      const diff = Math.abs(currDist - radius);
      if (diff > 0.05 * radius) {   // compare distances with epsilon-error (5%)
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
        angle = (2 * Math.PI - angle);
      }

      if (angle > maxAngle + (Math.PI / 180)) {
        return false;
      }
    }

    return 'already_circular';
  };


  action.transitionable = true;



  /**
   * _makeConvex
   * This makes the given way convex.
   * @param  graph  starting graph
   * @return ending graph
   */
  function _makeConvex(graph: Graph): Graph {
    const way = graph.entity(wayID) as OsmWay;
    const geom = way.geoms.parts[0]?.world;
    const points = geom?.outer;
    const hull = geom?.hull;
    if (!points || !hull) return graph;

    const nodes = utilArrayUniq(graph.childNodes(way));

    for (let i = 0; i < hull.length - 1; i++) {
      const startIndex = points.indexOf(hull[i]);
      const endIndex = points.indexOf(hull[i+1]);
      let indexRange = (endIndex - startIndex);
      if (indexRange < 0) {
        indexRange += nodes.length;
      }
      // move interior nodes to the surface of the convex hull..
      for (let j = 1; j < indexRange; j++) {
        const point = vecInterp(hull[i], hull[i+1], j / indexRange);
        const node = nodes[(j + startIndex) % nodes.length].move(viewport.worldToWgs84(point));
        graph.replace(node);
      }
    }

    return graph.commit();
  }


  return action;
}
