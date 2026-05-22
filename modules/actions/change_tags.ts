import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmTags } from '../data/types.ts';


/**
 * Changes the tags on an entity.
 * @param   entityID - The ID of the entity to modify
 * @param   tags - The new tags to set
 * @return  An Action function that replaces the entity's tags
 */
export function actionChangeTags(entityID: EntityID, tags: OsmTags): Action {
  return (graph: Graph): Graph => {
    return graph.replace(graph.entity(entityID).update({ tags: tags })).commit();
  };
}
