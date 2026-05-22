import { utilArrayGroupBy, utilArrayUniq } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { EntityType } from '../data/types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { OsmWay } from '../data/OsmWay.ts';


/** Geometry grouping result */
interface GeometryGroups {
  point: OsmEntity[];
  area: OsmEntity[];
  line: OsmEntity[];
  relation: OsmEntity[];
}


/**
 * Merges point features onto a single way or area.
 * @param   entityIDs  - Array of EntityIDs to merge
 * @return  An Action function that merges the entities
 */
export function actionMerge(entityIDs: EntityID[]): Action {

  function groupEntitiesByGeometry(graph: Graph): GeometryGroups {
    const entities = entityIDs.map(id => graph.entity(id));
    const grouped = utilArrayGroupBy(entities, entity => entity.geometry(graph));
    return Object.assign(
      { point: [], area: [], line: [], relation: [] },
      grouped
    );
  }


  const action = ((graph: Graph): Graph => {
    const geometries = groupEntitiesByGeometry(graph);
    const points = geometries.point as OsmNode[];
    let target = (geometries.area[0] || geometries.line[0]) as OsmWay;

    points.forEach(point => {
      target = target.mergeTags(point.tags);
      graph.replace(target);

      graph.parentRelations(point).forEach(parent => {
        graph.replace(parent.replaceMember(point, { id: target.id, type: target.type as EntityType }));
      });

      const nodes = utilArrayUniq(graph.childNodes(target));
      let removeNode: OsmNode = point;

      for (const node of nodes) {
        if (graph.parentWays(node).length > 1 ||
          graph.parentRelations(node).length ||
          node.hasInterestingTags()) {
          continue;
        }

        // Found an uninteresting child node on the target way.
        // Move orig point into its place to preserve point's history. iD#3683
        graph.replace(point.update({ tags: {}, loc: node.loc }));
        target = target.replaceNode(node.id, point.id);
        graph.replace(target);
        removeNode = node;
        break;
      }

      graph.remove(removeNode);
    });

    if (target.tags.area === 'yes') {
      const tags = { ...target.tags };  // shallow copy
      delete tags.area;
      if (target.tagSuggestingArea(tags)) {
        // remove the `area` tag if area geometry is now implied - iD#3851
        target = target.update({ tags: tags });
        graph.replace(target);
      }
    }

    return graph.commit();
  }) as Action;


  action.disabled = function(graph: Graph): string | false {
    const geometries = groupEntitiesByGeometry(graph);
    if (geometries.point.length === 0 ||
      (geometries.area.length + geometries.line.length) !== 1 ||
      geometries.relation.length !== 0) {
      return 'not_eligible';
    }
    return false;
  };


  return action;
}
