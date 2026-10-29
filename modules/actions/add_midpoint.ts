import { geoMetersToWorld } from '../geo/geom.ts';
import { OsmWay } from '../data/OsmWay.ts';
import { projWgs84ToWorld, vecProject } from '@rapid-sdk/math';
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
 * If no way has the edge anymore because it was split since it was found (for example, by an
 * earlier fix in the same action), the node goes into the piece of the edge that `loc` lies on.
 *
 * @param   midpoint  - Object with loc and edge properties
 * @param   node      - The OsmNode to insert at the midpoint
 * @return  An Action function that adds the midpoint to the graph
 */
export function actionAddMidpoint(midpoint: Midpoint, node: OsmNode): Action {
  return (graph: Graph): Graph => {
    graph.replace(node.move(midpoint.loc)).commit();

    const [edgeA, edgeB] = midpoint.edge;
    const nodeA = graph.hasEntity(edgeA);
    const nodeB = graph.hasEntity(edgeB);
    if (!nodeA || !nodeB) return graph;   // the edge is gone

    const parents = utilArrayIntersection(graph.parentWays(nodeA), graph.parentWays(nodeB)) as OsmWay[];

    let inserted = false;
    parents.forEach(way => {
      for (let i = 0; i < way.nodes.length - 1; i++) {
        const a = way.nodes[i];
        const b = way.nodes[i + 1];
        // Check if edges match in either direction
        if ((a === edgeA && b === edgeB) || (a === edgeB && b === edgeA)) {
          graph.replace((graph.entity(way.id) as OsmWay).addNode(node.id, i + 1));
          inserted = true;

          // Add only one midpoint on doubled-back segments,
          // turning them into self-intersections.
          return;
        }
      }
    });

    if (!inserted) {
      for (const way of parents) {
        const index = splitEdgeIndex(graph, way);
        if (index !== undefined) {
          graph.replace((graph.entity(way.id) as OsmWay).addNode(node.id, index + 1));
        }
      }
    }

    return graph.commit();
  };


  /**
   * Finds where the edge used to be in a way that has both its nodes, but not next to each other:
   * the segment between them that `loc` lies on (within 1 m).
   * @param  graph - The current graph
   * @param  way - A way with both of the edge's nodes
   * @return The index of the segment's first node, or `undefined` if `loc` isn't on any of them
   */
  function splitEdgeIndex(graph: Graph, way: OsmWay): number | undefined {
    const i = way.nodes.indexOf(midpoint.edge[0]);
    const j = way.nodes.indexOf(midpoint.edge[1]);
    if (i === -1 || j === -1) return undefined;

    const point = projWgs84ToWorld(midpoint.loc);
    const tolerance = geoMetersToWorld(1, midpoint.loc[1]);
    let best: number | undefined;
    let bestDistance = Infinity;

    for (let k = Math.min(i, j); k < Math.max(i, j); k++) {
      if (way.nodes[k] === node.id || way.nodes[k + 1] === node.id) return undefined;   // it's in there already
      const a = graph.hasEntity(way.nodes[k]) as OsmNode | undefined;
      const b = graph.hasEntity(way.nodes[k + 1]) as OsmNode | undefined;
      if (!a?.loc || !b?.loc) continue;

      const closest = vecProject(point, [projWgs84ToWorld(a.loc), projWgs84ToWorld(b.loc)]);
      if (closest && closest.distance <= tolerance && closest.distance < bestDistance) {
        best = k;
        bestDistance = closest.distance;
      }
    }
    return best;
  }
}
