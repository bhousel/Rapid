import { utilGetAllNodes } from '@rapid-sdk/util';
import { vecRotate } from '@rapid-sdk/math';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


/**
 * actionRotate
 * Rotates entities around a pivot point by a given angle.
 *
 * @param   entityIDs  - Array of EntityIDs to rotate
 * @param   pivot      - The pivot point [x, y] in screen coordinates
 * @param   angle      - The rotation angle in radians
 * @param   viewport   - The Viewport for coordinate conversion
 * @return  An Action function that rotates the entities in the graph
 */
export function actionRotate(entityIDs: EntityID[], pivot: Vec2, angle: number, viewport: Viewport): Action {
  return (graph: Graph): Graph => {
    const nodes = utilGetAllNodes(entityIDs, graph) as OsmNode[];
    for (const node of nodes) {
      const point = vecRotate(viewport.project(node.loc!), angle, pivot);
      graph.replace(node.move(viewport.unproject(point)));
    }
    return graph.commit();
  };
}
