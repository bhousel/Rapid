import { actionDeleteRelation } from './delete_relation.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { Turn } from '../lib/intersection.ts';


/**
 * Deletes a turn restriction relation.
 *
 * `turn` must be a Turn object with a `restrictionID` property.
 * see lib/intersection.ts, pathToTurn()
 *
 * @param   turn  - Turn object with restrictionID of the relation to delete
 * @return  An Action function that deletes the given turn restriction
 */
export function actionUnrestrictTurn(turn: Turn): Action {
  return (graph: Graph): Graph => actionDeleteRelation(turn.restrictionID!)(graph);
}
