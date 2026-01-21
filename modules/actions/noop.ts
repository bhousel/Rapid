import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';


/**
 * actionNoop
 * A no-operation action that returns the graph unchanged.
 * Useful as a placeholder or for testing.
 * @return Action that returns the graph unchanged
 */
export function actionNoop(): Action {
  return (graph: Graph): Graph => graph;
}
