import { median } from 'd3-array';
import { polygonArea, polygonHull, polygonCentroid } from 'd3-polygon';
import { DEG2RAD, vecInterp, vecLength, vecLengthSquare } from '@rapid-sdk/math';
import { utilArrayUniq } from '@rapid-sdk/util';

import { OsmNode } from '../models/OsmNode.js';


export function actionCircularize(wayID, viewport, maxAngle) {
  maxAngle = (maxAngle || 20) * DEG2RAD;


  const action = (graph, t) => {
    if (t === null || !isFinite(t)) t = 1;
    t = Math.min(Math.max(+t, 0), 1);

    var way = graph.entity(wayID);
    var origNodes = {};

    graph.childNodes(way).forEach(function(node) {
      if (!origNodes[node.id]) origNodes[node.id] = node;
    });

    if (!way.isConvex(graph)) {
      graph = action.makeConvex(graph);
    }

    const nodes = utilArrayUniq(graph.childNodes(way));
    let keyNodes = nodes.filter(n => graph.parentWays(n).length > 1);
    let points = nodes.map(n => viewport.project(n.loc));
    let keyPoints = keyNodes.map(n => viewport.project(n.loc));
    const centroid = (points.length === 2) ? vecInterp(points[0], points[1], 0.5) : polygonCentroid(points);
    const radius = median(points, p => vecLength(centroid, p));
    const sign = polygonArea(points) > 0 ? 1 : -1;
    var ids, i, j, k;

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
      let nearNodes = {};
      let inBetweenNodes = [];
      let startAngle, endAngle, totalAngle, eachAngle;
      let angle, loc, node, origNode;

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
      origNode = origNodes[node.id];
      node = node.move(vecInterp(origNode.loc, loc, t));
      graph = graph.replace(node).commit();

      // figure out the between delta angle we want to match to
      startAngle = Math.atan2(keyPoints[i][1] - centroid[1], keyPoints[i][0] - centroid[0]);
      endAngle = Math.atan2(keyPoints[nextKeyNodeIndex][1] - centroid[1], keyPoints[nextKeyNodeIndex][0] - centroid[0]);
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
        origNode = origNodes[node.id];
        nearNodes[node.id] = angle;

        node = node.move(vecInterp(origNode.loc, loc, t));
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
            origNode = origNodes[nodeID];
          }
        }

        node = new OsmNode(way.context, { loc: vecInterp(origNode.loc, loc, t) });
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

          if (sharedWay.areAdjacent(startNode.id, endNode.id)) {
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
    ids = nodes.map(n => n.id);
    ids.push(ids[0]);

    way = way.update({ nodes: ids });
    return graph.replace(way).commit();
  };


  action.makeConvex = graph => {
    const way = graph.entity(wayID);
    const nodes = utilArrayUniq(graph.childNodes(way));
    const points = nodes.map(n => viewport.project(n.loc));
    const sign = polygonArea(points) > 0 ? 1 : -1;
    const hull = polygonHull(points);

    // D3 convex hulls go counterclockwise..
    if (sign === -1) {
      nodes.reverse();
      points.reverse();
    }

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
        const node = nodes[(j + startIndex) % nodes.length].move(viewport.unproject(point));
        graph.replace(node);
      }
    }

    return graph.commit();
  };


  action.disabled = graph => {
    const way = graph.entity(wayID);

    if (!way.isClosed()) {
      return 'not_closed';
    }

    // disable when already circular
    const nodes = utilArrayUniq(graph.childNodes(way));
    const points = nodes.map(n => viewport.project(n.loc));
    const hull = polygonHull(points);
    const epsilonAngle =  Math.PI / 180;
    if (hull.length !== points.length || hull.length < 3) {
      return false;
    }
    const centroid = polygonCentroid(points);
    const radius = vecLengthSquare(centroid, points[0]);

    let i, actualPoint;

    // compare distances between centroid and points
    for (i = 0; i < hull.length; i++){
      actualPoint = hull[i];
      const actualDist = vecLengthSquare(actualPoint, centroid);
      const diff = Math.abs(actualDist - radius);
      //compare distances with epsilon-error (5%)
      if (diff > 0.05 * radius) {
        return false;
      }
    }

    //check if central angles are smaller than maxAngle
    for (i = 0; i < hull.length; i++){
      actualPoint = hull[i];
      const nextPoint = hull[(i+1) % hull.length];
      const startAngle = Math.atan2(actualPoint[1] - centroid[1], actualPoint[0] - centroid[0]);
      const endAngle = Math.atan2(nextPoint[1] - centroid[1], nextPoint[0] - centroid[0]);
      let angle = endAngle - startAngle;
      if (angle < 0) {
        angle = -angle;
      }
      if (angle > Math.PI){
        angle = (2 * Math.PI - angle);
      }

      if (angle > maxAngle + epsilonAngle) {
        return false;
      }
    }
    return 'already_circular';
  };


  action.transitionable = true;


  return action;
}
