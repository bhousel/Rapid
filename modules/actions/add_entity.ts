import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';


/**
 * Adds an entity to the graph.
 * @param entity - The entity to add
 * @return Action that adds the entity to the graph
 */
export function actionAddEntity(entity: OsmEntity): Action {
  return (graph: Graph): Graph => {
    return graph.replace(entity).commit();
  };
}
