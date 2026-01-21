import { actionDeleteRelation } from './delete_relation.js';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { Turn } from '../lib/intersection.ts';


/**
 * actionUnrestrictTurn
 * Deletes a turn restriction relation.
 *
 * `turn` must be a Turn object with a `restrictionID` property.
 * see lib/intersection.ts, pathToTurn()
 *
 * @param   turn  - Turn object with restrictionID of the relation to delete
 * @return  An Action function that deletes the restriction from the graph
 */
export function actionUnrestrictTurn(turn: Turn): Action {
  return (graph: Graph): Graph => actionDeleteRelation(turn.restrictionID!)(graph);
}
