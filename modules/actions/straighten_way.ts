import { actionDeleteNode } from './delete_node.js';
import { utilArrayDifference } from '@rapid-sdk/util';
import { Vec2, vecDot, vecInterp, vecLength, Viewport } from '@rapid-sdk/math';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { OsmWay } from '../data/OsmWay.ts';


/**
 * actionStraightenWay
 * Straightens selected ways by aligning interior nodes along a line
 * between the first and last nodes. Removes nodes that become unnecessary.
 *
 * @param   selectedIDs  - Array of EntityIDs (ways and optionally nodes) to straighten
 * @param   viewport     - The Viewport for coordinate conversion
 * @return  An Action that straightens the ways
 */
export function actionStraightenWay(selectedIDs: EntityID[], viewport: Viewport): Action {

  function positionAlongWay(a: Vec2, o: Vec2, b: Vec2): number {
    return vecDot(a, b, o) / vecDot(b, b, o);
  }

  // Return all selected ways as a continuous, ordered array of nodes
  function allNodes(graph: Graph): OsmNode[] {
    let startNodes: EntityID[] = [];
    let endNodes: EntityID[] = [];
    let remainingWays: EntityID[][] = [];
    const selectedWays: EntityID[] = selectedIDs.filter(id => graph.entity(id).type === 'way');
    const selectedNodes: EntityID[] = selectedIDs.filter(id => graph.entity(id).type === 'node');

    for (const wayID of selectedWays) {
      const way = graph.entity(wayID) as OsmWay;
      const wayNodes = way.nodes.slice(0);
      remainingWays.push(wayNodes);
      startNodes.push(wayNodes[0]);
      endNodes.push(wayNodes[wayNodes.length-1]);
    }

    // Remove duplicate end/startNodes (duplicate nodes cannot be at the line end,
    //   and need to be removed so currNode difference calculation below works)
    // i.e. ["n-1", "n-1", "n-2"] => ["n-2"]
    startNodes = startNodes.filter(n => startNodes.indexOf(n) === startNodes.lastIndexOf(n));
    endNodes = endNodes.filter(n => endNodes.indexOf(n) === endNodes.lastIndexOf(n));

    // Choose the initial endpoint to start from
    let currNode: EntityID | undefined = utilArrayDifference(startNodes, endNodes)
        .concat(utilArrayDifference(endNodes, startNodes))[0];
    let nextWay: EntityID[];
    let nodes: EntityID[] = [];

    // Create nested function outside of loop to avoid "function in loop" lint error
    const getNextWay = function(currNode: EntityID | undefined, remainingWays: EntityID[][]): EntityID[] | undefined {
      return remainingWays.filter((arr: EntityID[]) => {
        return arr[0] === currNode || arr[arr.length-1] === currNode;
      })[0];
    };

    // Add nodes to end of nodes array, until all ways are added
    while (remainingWays.length) {
      nextWay = getNextWay(currNode, remainingWays) || [];
      remainingWays = utilArrayDifference(remainingWays, [nextWay]);

      if (nextWay[0] !== currNode) {
        nextWay.reverse();
      }
      nodes = nodes.concat(nextWay);
      currNode = nodes[nodes.length-1];
    }

    // If user selected 2 nodes to straighten between, then slice nodes array to those nodes
    if (selectedNodes.length === 2) {
      const startNodeIdx: number = nodes.indexOf(selectedNodes[0]);
      const endNodeIdx: number = nodes.indexOf(selectedNodes[1]);
      const sortedStartEnd: number[] = [startNodeIdx, endNodeIdx];

      sortedStartEnd.sort((a: number, b: number) => a - b);
      nodes = nodes.slice(sortedStartEnd[0], sortedStartEnd[1]+1);
    }

    return nodes.map(n => graph.entity(n) as OsmNode);
  }


  function shouldKeepNode(node: OsmNode, graph: Graph): boolean {
    return graph.parentWays(node).length > 1 ||
      graph.parentRelations(node).length > 0 ||
      node.hasInterestingTags();
  }


  const action: Action = ((graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);

    const nodes: OsmNode[] = allNodes(graph);
    const points: Vec2[] = nodes.map(n => viewport.project(n.loc!));
    const startPoint: Vec2 = points.at(0)!;
    const endPoint: Vec2 = points.at(-1)!;
    const toDelete = new Set<OsmNode>();

    for (let i = 1; i < points.length - 1; i++) {
      const node = nodes[i];
      const point = points[i];

      if (t < 1 || shouldKeepNode(node, graph)) {
        const u = positionAlongWay(point, startPoint, endPoint);
        const p = vecInterp(startPoint, endPoint, u);
        const loc2 = viewport.unproject(p);
        graph.replace(node.move(vecInterp(node.loc!, loc2, t)));

      } else {
        // safe to delete
        toDelete.add(node);
      }
    }

    for (const node of toDelete) {
      graph = actionDeleteNode(node.id)(graph);
    }

    return graph.commit();
  }) as Action;


  action.disabled = function(graph: Graph): string | false {
    // check way isn't too bendy
    const nodes: OsmNode[] = allNodes(graph);
    const points: Vec2[] = nodes.map(n => viewport.project(n.loc!));
    const startPoint: Vec2 = points.at(0)!;
    const endPoint: Vec2 = points.at(-1)!;
    const threshold: number = 0.2 * vecLength(startPoint, endPoint);

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

    const keepingAllNodes = nodes.every((node: OsmNode, i: number) => {
      return i === 0 || i === nodes.length - 1 || shouldKeepNode(node, graph);
    });

    // Allow straightening even if already straight in order to remove extraneous nodes
    if (maxDistance < 0.0001 && keepingAllNodes) {
      return 'straight_enough';
    }
    return false;
  };

  action.transitionable = true;


  return action;
}
