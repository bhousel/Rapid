import { vecDot, vecInterp, vecLength } from '@rapid-sdk/math';
import { utilArrayDifference } from '@rapid-sdk/util';

import { actionDeleteNode } from './delete_node.js';


export function actionStraightenWay(selectedIDs, viewport) {

  function positionAlongWay(a, o, b) {
    return vecDot(a, b, o) / vecDot(b, b, o);
  }

  // Return all selected ways as a continuous, ordered array of nodes
  function allNodes(graph) {
    let nodes = [];
    let startNodes = [];
    let endNodes = [];
    let remainingWays = [];
    let selectedWays = selectedIDs.filter(id => graph.entity(id).type === 'way');
    let selectedNodes = selectedIDs.filter(id => graph.entity(id).type === 'node');

    for (let i = 0; i < selectedWays.length; i++) {
      const way = graph.entity(selectedWays[i]);
      nodes = way.nodes.slice(0);
      remainingWays.push(nodes);
      startNodes.push(nodes[0]);
      endNodes.push(nodes[nodes.length-1]);
    }

    // Remove duplicate end/startNodes (duplicate nodes cannot be at the line end,
    //   and need to be removed so currNode difference calculation below works)
    // i.e. ["n-1", "n-1", "n-2"] => ["n-2"]
    startNodes = startNodes.filter(n => startNodes.indexOf(n) === startNodes.lastIndexOf(n));
    endNodes = endNodes.filter(n => endNodes.indexOf(n) === endNodes.lastIndexOf(n));

    // Choose the initial endpoint to start from
    let currNode = utilArrayDifference(startNodes, endNodes)
        .concat(utilArrayDifference(endNodes, startNodes))[0];
    let nextWay = [];
    nodes = [];

    // Create nested function outside of loop to avoid "function in loop" lint error
    const getNextWay = function(currNode, remainingWays) {
      return remainingWays.filter(arr => {
        return arr[0] === currNode || arr[arr.length-1] === currNode;
      })[0];
    };

    // Add nodes to end of nodes array, until all ways are added
    while (remainingWays.length) {
      nextWay = getNextWay(currNode, remainingWays);
      remainingWays = utilArrayDifference(remainingWays, [nextWay]);

      if (nextWay[0] !== currNode) {
        nextWay.reverse();
      }
      nodes = nodes.concat(nextWay);
      currNode = nodes[nodes.length-1];
    }

    // If user selected 2 nodes to straighten between, then slice nodes array to those nodes
    if (selectedNodes.length === 2) {
      const startNodeIdx = nodes.indexOf(selectedNodes[0]);
      const endNodeIdx = nodes.indexOf(selectedNodes[1]);
      const sortedStartEnd = [startNodeIdx, endNodeIdx];

      sortedStartEnd.sort((a, b) => a - b);
      nodes = nodes.slice(sortedStartEnd[0], sortedStartEnd[1]+1);
    }

    return nodes.map(n => graph.entity(n));
  }


  function shouldKeepNode(node, graph) {
    return graph.parentWays(node).length > 1 ||
      graph.parentRelations(node).length ||
      node.hasInterestingTags();
  }


  const action = function(graph, t) {
    if (t === null || !isFinite(t)) t = 1;
    t = Math.min(Math.max(+t, 0), 1);

    const nodes = allNodes(graph);
    const points = nodes.map(n => viewport.project(n.loc));
    const startPoint = points.at(0);
    const endPoint = points.at(-1);
    const toDelete = new Set();

    for (let i = 1; i < points.length - 1; i++) {
      const node = nodes[i];
      const point = points[i];

      if (t < 1 || shouldKeepNode(node, graph)) {
        const u = positionAlongWay(point, startPoint, endPoint);
        const p = vecInterp(startPoint, endPoint, u);
        const loc2 = viewport.unproject(p);
        graph.replace(node.move(vecInterp(node.loc, loc2, t)));

      } else {
        // safe to delete
        toDelete.add(node);
      }
    }

    for (const node of toDelete) {
      graph = actionDeleteNode(node.id)(graph);
    }

    return graph.commit();
  };


  action.disabled = function(graph) {
    // check way isn't too bendy
    const nodes = allNodes(graph);
    const points = nodes.map(n => viewport.project(n.loc));
    const startPoint = points.at(0);
    const endPoint = points.at(-1);
    const threshold = 0.2 * vecLength(startPoint, endPoint);

    if (threshold === 0) {
      return 'too_bendy';
    }

    let maxDistance = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const point = points[i];
      const u = positionAlongWay(point, startPoint, endPoint);
      const p = vecInterp(startPoint, endPoint, u);
      const dist = vecLength(p, point);

      // to bendy if point is off by 20% of total start/end distance in projected space
      if (isNaN(dist) || dist > threshold) {
        return 'too_bendy';
      } else if (dist > maxDistance) {
        maxDistance = dist;
      }
    }

    const keepingAllNodes = nodes.every(function(node, i) {
      return i === 0 || i === nodes.length - 1 || shouldKeepNode(node, graph);
    });

    // Allow straightening even if already straight in order to remove extraneous nodes
    if (maxDistance < 0.0001 && keepingAllNodes) {
      return 'straight_enough';
    }
  };

  action.transitionable = true;


  return action;
}
