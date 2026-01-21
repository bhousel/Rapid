import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { Tags } from '../data/types.ts';


/**
 * actionChangeTags
 * Changes the tags on an entity.
 * @param entityID - The ID of the entity to modify
 * @param tags - The new tags to set
 * @return Action that replaces the entity's tags
 */
export function actionChangeTags(entityID: EntityID, tags: Tags): Action {
  return (graph: Graph): Graph => {
    return graph.replace(graph.entity(entityID).update({ tags: tags })).commit();
  };
}
