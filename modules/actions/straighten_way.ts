import { actionDeleteNode } from './delete_node.js';
import { osmJoinWays } from '../lib/multipolygon.ts';
import { projWorldToWgs84, vecAdd, vecInterp, vecLength, vecProject, vecSubtract } from '@rapid-sdk/math';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { OsmWay } from '../data/OsmWay.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Straightens selected ways by aligning interior nodes along a line
 * between the first and last nodes. Removes nodes that become unnecessary.
 * @param   selectedIDs  - Array of EntityIDs (ways and optionally nodes) to straighten
 * @return  An Action function that straightens the given ways
 */
export function actionStraightenWay(selectedIDs: EntityID[]): Action {

  // Return all selected ways as a continuous, ordered array of nodes
  function allNodes(graph: Graph): OsmNode[] {
    const selectedWays: OsmWay[] = [];
    const selectedNodes: OsmNode[] = [];

    for (const entityID of selectedIDs) {
      const entity = graph.hasEntity(entityID);
      if (entity?.type === 'way') {
        selectedWays.push(entity as OsmWay);
      } else if (entity?.type === 'node') {
        selectedNodes.push(entity as OsmNode);
      }
    }

    const joined = osmJoinWays(selectedWays, graph);
    if (joined.length !== 1) return [];   // ways are disjoint

    let nodes = joined[0].nodes;

    // If selection includes 2 nodes, include only the nodes between them.
    if (selectedNodes.length === 2) {
      const a = nodes.indexOf(selectedNodes[0]);
      const b = nodes.indexOf(selectedNodes[1]);
      if (a !== -1 && b !== -1) {
        const [start, end] = (a < b) ? [a, b] : [b, a];
        nodes = nodes.slice(start, end + 1);
      }
    }

    return nodes;
  }


  function isInteresting(node: OsmNode, graph: Graph): boolean {
    return graph.parentWays(node).length > 1 ||
      graph.parentRelations(node).length > 0 ||
      node.hasInterestingTags();
  }


  const action: Action = ((graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);
    if (t === 0) return graph;

    const collection = allNodes(graph);
    const nodes: OsmNode[] = [];
    const points: Vec2[] = [];
    let origin: Vec2 | undefined;
    const toDelete = new Set<OsmNode>();

    // Gather all the nodes and their world coordinates, choose a local origin for floating point stability
    for (const node of collection) {
      const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
      if (!coord) continue;
      if (!origin) origin = coord;
      nodes.push(node);
      points.push(vecSubtract(coord, origin));  // world -> local
    }
    if (!origin || !points.length) return graph;

    // Move points onto the target line, or delete if uninteresting.
    const line = [points.at(0)!, points.at(-1)!];
    for (let i = 1; i < points.length -1; i++) {    // skip first/last
      const node = nodes[i];
      const point = points[i];

      if (t === 1 && !isInteresting(node, graph)) {
        toDelete.add(node);
      } else {
        const closest = vecProject(point, line);
        if (!closest) continue;

        const coord = vecAdd(closest.point, origin);  // local -> world
        const loc2 = projWorldToWgs84(coord);
        graph.replace(node.move(vecInterp(node.loc!, loc2, t)));
      }
    }

    for (const node of toDelete) {
      graph = actionDeleteNode(node.id)(graph);
    }

    return graph.commit();
  }) as Action;


  action.disabled = function(graph: Graph): string | false {
    const collection = allNodes(graph);
    const nodes: OsmNode[] = [];
    const points: Vec2[] = [];
    let origin: Vec2 | undefined;

    // Gather all the nodes and their world coordinates, choose a local origin for floating point stability
    for (const node of collection) {
      const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
      if (!coord) continue;
      if (!origin) origin = coord;
      nodes.push(node);
      points.push(vecSubtract(coord, origin));  // world -> local
    }
    if (!origin || !points.length) return 'straight_enough';

    const line = [points.at(0)!, points.at(-1)!];

    // too bendy if:
    // - start and end are the same point, or
    // - any point is off by 20% of total line distance in projected space
     const threshold: number = 0.2 * vecLength(line[0], line[1]);
    if (threshold === 0) {
      return 'too_bendy';
    }

    // Move points onto the target line, or delete if uninteresting.
    let maxDistance = 0;
    let keepAllNodes = true;
    for (let i = 1; i < points.length - 1; i++) {    // skip first/last
      const node = nodes[i];
      const point = points[i];

      if (!isInteresting(node, graph)) {
        keepAllNodes = false;
      }
      const closest = vecProject(point, line);
      if (!closest) continue;

      if (closest.distance > threshold) {
        return 'too_bendy';
      } else if (closest.distance > maxDistance) {
        maxDistance = closest.distance;
      }
    }

    // Allow straightening even if already straight in order to remove extraneous nodes
    if (maxDistance < 0.0001 && keepAllNodes) {
      return 'straight_enough';
    }

    return false;
  };


  action.transitionable = true;

  return action;
}
