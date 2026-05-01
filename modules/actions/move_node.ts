import { vecInterp } from '@rapid-sdk/math';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { Vec2 } from '@rapid-sdk/math';


/**
 * Moves a node to a new location, with optional transition support.
 *
 * @param   nodeID  - EntityID of the node to move
 * @param   toLoc   - The target location [lon, lat]
 * @return  An Action that moves the node in the graph
 */
export function actionMoveNode(nodeID: EntityID, toLoc: Vec2): Action {

  const action = ((graph: Graph, t?: number): Graph => {
    if (t === null || !isFinite(t!)) t = 1;
    t = Math.min(Math.max(+t!, 0), 1);

    let node = graph.entity(nodeID) as OsmNode;
    node = node.move(vecInterp(node.loc!, toLoc, t));

    return graph.replace(node).commit();
  }) as Action;

  action.transitionable = true;

  return action;
}
