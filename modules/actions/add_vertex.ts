import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmWay } from '../data/OsmWay.ts';


/**
 * Adds a node to a way at a specified index.
 *
 * @param   wayID   - EntityID of the way to modify
 * @param   nodeID  - EntityID of the node to add
 * @param   index   - Position in the way's node list to insert at (appends if omitted)
 * @return  An Action function that adds the vertex to the graph
 */
export function actionAddVertex(wayID: EntityID, nodeID: EntityID, index?: number): Action {
  return (graph: Graph): Graph => {
    return graph.replace((graph.entity(wayID) as OsmWay).addNode(nodeID, index)).commit();
  };
}
