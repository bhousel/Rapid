import { geomRotate } from '@rapid-sdk/math';
import { utilGetAllNodes } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';

/**
 * Rotates entities around a pivot point by a given angle.
 *
 * @param   entityIDs  - Array of EntityIDs to rotate
 * @param   pivot      - The pivot point [x, y] in world coordinates
 * @param   angle      - The rotation angle in radians
 * @param   viewport   - The Viewport for coordinate conversion
 * @return  An Action function that rotates the entities in the graph
 */
export function actionRotate(entityIDs: EntityID[], pivot: Vec2, angle: number, viewport: Viewport): Action {
  return (graph: Graph): Graph => {
    const nodes = utilGetAllNodes(entityIDs, graph) as OsmNode[];
    const rotNodes: OsmNode[] = [];
    const points: Vec2[] = [];

    for (const node of nodes) {
      const coords = node.geoms.parts[0]?.world?.coords;
      if (!coords) continue;

      rotNodes.push(node);
      points.push(coords as Vec2);
    }

    const rotated = geomRotate(points, angle, pivot);
    for (let i = 0; i < rotNodes.length; ++i) {
      graph.replace(rotNodes[i].move(viewport.worldToWgs84(rotated[i])));
    }

    return graph.commit();
  };
}
