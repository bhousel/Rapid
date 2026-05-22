import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { Action } from './types.ts';


/** Interface for an Action that returns copies of entities */
export interface CopyEntitiesAction extends Action {
  copies(): Record<EntityID, OsmEntity>;
}


/**
 * Creates copies of entities from one graph to another.
 * The copies mapping can be retrieved via the `copies()` method.
 * @param   entityIDs  - Array of EntityIDs to copy
 * @param   fromGraph  - The source Graph containing the entities
 * @return  An Action function that copies entities to the target graph
 */
export function actionCopyEntities(entityIDs: EntityID[], fromGraph: Graph): CopyEntitiesAction {
  const _copies: Record<EntityID, OsmEntity> = {};

  const action = ((graph: Graph): Graph => {
    for (const id of entityIDs) {
      fromGraph.entity(id).copy(fromGraph, _copies);
    }

    graph.replace(Object.values(_copies));
    return graph.commit();
  }) as CopyEntitiesAction;


  action.copies = (): Record<EntityID, OsmEntity> => _copies;

  return action;
}
