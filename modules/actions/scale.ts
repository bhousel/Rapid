import { utilGetAllNodes } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2, Viewport } from '@rapid-sdk/math';


/**
 * Scales entities relative to a pivot location.
 *
 * @param   entityIDs    - Array of EntityIDs to scale
 * @param   pivotLoc     - The pivot point [x, y] in screen coordinates
 * @param   scaleFactor  - The scale factor (1.0 = no change)
 * @param   viewport     - The Viewport for coordinate conversion
 * @return  An Action function that scales the entities in the graph
 */
export function actionScale(entityIDs: EntityID[], pivotLoc: Vec2, scaleFactor: number, viewport: Viewport): Action {
  return (graph: Graph): Graph => {
    const nodes = utilGetAllNodes(entityIDs, graph) as OsmNode[];
    for (const node of nodes) {
      let point = viewport.project(node.loc!);
      const radial: Vec2 = [
        point[0] - pivotLoc[0],
        point[1] - pivotLoc[1]
      ];
      point = [
        pivotLoc[0] + (scaleFactor * radial[0]),
        pivotLoc[1] + (scaleFactor * radial[1])
      ];

      graph.replace(node.move(viewport.unproject(point)));
    }

    return graph.commit();
  };
}
