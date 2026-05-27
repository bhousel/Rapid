import type { Action } from './types.ts';
import type { Difference } from '../lib/Difference.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmTags } from '../data/types.ts';


/**
 * Removes specified tags from entities that were modified or created.
 * @param   difference - The Difference object containing modified/created entities
 * @param   discardTags - Object with tag keys to discard (values are ignored, just checking key existence)
 * @return  An Action function that removes the specified tags
 */
export function actionDiscardTags(difference: Difference, discardTags: Record<string, unknown> = {}): Action {
  return (graph: Graph): Graph => {
    difference.modified().forEach(checkTags);
    difference.created().forEach(checkTags);
    return graph.commit();


    /**
     * Removes discardable and empty-valued tags from one entity and writes the
     * updated entity back into the graph.
     * @param   entity - The entity whose tags should be cleaned
     */
    function checkTags(entity: OsmEntity): void {
      const keys = Object.keys(entity.tags);
      let didDiscard = false;
      const tags: OsmTags = {};

      for (const k of keys) {
        if (discardTags[k] || !entity.tags[k]) {
          didDiscard = true;
        } else {
          tags[k] = entity.tags[k];
        }
      }
      if (didDiscard) {
        graph.replace(entity.update({ tags: tags }));
      }
    }

  };
}
