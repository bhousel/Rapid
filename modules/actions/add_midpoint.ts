import { OsmWay } from '../data/OsmWay.ts';
import { utilArrayIntersection } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** Midpoint data passed to actionAddMidpoint */
export interface Midpoint {
  loc: Vec2;
  edge: [EntityID, EntityID];
}


/**
 * Adds a node at the midpoint of an edge (shared between ways).
 *
 * @param   midpoint  - Object with loc and edge properties
 * @param   node      - The OsmNode to insert at the midpoint
 * @return  An Action function that adds the midpoint to the graph
 */
export function actionAddMidpoint(midpoint: Midpoint, node: OsmNode): Action {
  return (graph: Graph): Graph => {
    graph.replace(node.move(midpoint.loc)).commit();

    const parents = utilArrayIntersection(
      graph.parentWays(graph.entity(midpoint.edge[0])),
      graph.parentWays(graph.entity(midpoint.edge[1]))
    ) as OsmWay[];

    parents.forEach(way => {
      for (let i = 0; i < way.nodes.length - 1; i++) {
        const a = way.nodes[i];
        const b = way.nodes[i + 1];
        const edgeA = midpoint.edge[0];
        const edgeB = midpoint.edge[1];
        // Check if edges match in either direction
        if ((a === edgeA && b === edgeB) || (a === edgeB && b === edgeA)) {
          graph.replace((graph.entity(way.id) as OsmWay).addNode(node.id, i + 1));

          // Add only one midpoint on doubled-back segments,
          // turning them into self-intersections.
          return;
        }
      }
    });

    return graph.commit();
  };
}
