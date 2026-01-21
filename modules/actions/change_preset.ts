import { actionSyncCrossingTags } from './sync_crossing_tags.js';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { Preset } from '../lib/Preset.ts';


/**
 * actionChangePreset
 * Changes an entity's tags from one preset to another.
 * Handles tag cleanup and crossing tag synchronization.
 *
 * @param   entityID          - EntityID of the entity to change
 * @param   oldPreset         - The old Preset (or null)
 * @param   newPreset         - The new Preset to apply (or null)
 * @param   skipFieldDefaults - Whether to skip applying field defaults
 * @return  An Action function that changes the preset in the graph
 */
export function actionChangePreset(entityID: EntityID, oldPreset: Preset | null, newPreset: Preset | null, skipFieldDefaults?: boolean): Action {
  return (graph: Graph): Graph => {
    const entity = graph.entity(entityID) as OsmEntity;
    const geometry = entity.geometry(graph);
    const origTags = Object.assign({}, entity.tags);
    let tags = entity.tags;

    // preserve tags that the new preset might care about, if any
    const preserveKeys = newPreset?.addTags && Object.keys(newPreset.addTags);
    if (oldPreset) tags = oldPreset.unsetTags(tags, geometry, preserveKeys);
    if (newPreset) tags = newPreset.setTags(tags, geometry, skipFieldDefaults);

    graph.replace(entity.update({ tags: tags }));

    const crossingKeys = ['crossing', 'crossing_ref', 'crossing:continuous', 'crossing:island', 'crossing:markings', 'crossing:signals'];
    if (crossingKeys.some(k => tags[k] !== origTags[k])) {  // `crossing` tag changed?
      graph = actionSyncCrossingTags(entityID)(graph);      // more updates may be necessary..
    }

    return graph.commit();
  };
}
