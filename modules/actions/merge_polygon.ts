import { geomPolygonContainsPolygon } from '@rapid-sdk/math';

import type { Vec2 } from '@rapid-sdk/math';
import { OsmRelation } from '../data/OsmRelation.ts';
import { osmJoinWays } from '../lib/multipolygon.ts';
import { utilArrayGroupBy, utilArrayIntersection, utilObjectOmit } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { JoinedWaySequence } from '../lib/multipolygon.ts';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { OsmRelationMember } from '../data/OsmRelation.ts';
import type { OsmWay } from '../data/OsmWay.ts';


/** Data collected from gathering entities for merging */
interface EntityData {
  closedWay: OsmWay[];
  multipolygon: OsmRelation[];
  other: OsmEntity[];
}

/** Polygon representation with member array and nodes */
interface MergePolygon extends Array<OsmRelationMember | OsmWay> {
  nodes: OsmNode[];
}


/**
 * Merges multiple closed ways and/or multipolygon relations into a single
 * multipolygon relation, properly handling outer/inner roles based on containment.
 *
 * @param   ids            - Array of EntityIDs to merge (closed ways or multipolygons)
 * @param   newRelationID  - EntityID for the new relation if one needs to be created
 * @return  An Action function that merges the polygons
 */
export function actionMergePolygon(ids: EntityID[], newRelationID: EntityID): Action {

  function gatherEntityData(graph: Graph): EntityData {
    const entities = ids.map(id => graph.entity(id));

    const geometryGroups = utilArrayGroupBy(entities, (entity: OsmEntity) => {
      if (entity.type === 'way' && (entity as OsmWay).isClosed()) {
        return 'closedWay';
      } else if (entity.type === 'relation' && (entity as OsmRelation).isMultipolygon()) {
        return 'multipolygon';
      } else {
        return 'other';
      }
    }) as Partial<EntityData>;

    return Object.assign(
      { closedWay: [], multipolygon: [], other: [] },
      geometryGroups
    );
  }


  const action: Action = ((graph: Graph): Graph => {
    const entities = gatherEntityData(graph);

    // An array representing all the polygons that are part of the multipolygon.
    // Each element is itself an array of objects with an id property, and has a
    // locs property which is an array of the locations forming the polygon.
    let polygons: MergePolygon[] = (entities.multipolygon.reduce((polygons: JoinedWaySequence[], m: OsmRelation) => {
      return polygons.concat(osmJoinWays(m.members, graph));
    }, [] as JoinedWaySequence[]) as MergePolygon[])
    .concat(entities.closedWay.map((d: OsmWay): MergePolygon => {
      const member: MergePolygon = [{id: d.id, type: 'way', role: ''}] as unknown as MergePolygon;
      member.nodes = graph.childNodes(d);
      return member;
    }));

    // contained is an array of arrays of boolean values,
    // where contained[j][k] is true iff the jth way is
    // contained by the kth way.
    let contained: (boolean | null)[][] = polygons.map((w: MergePolygon, i: number) => {
      return polygons.map((d: MergePolygon, n: number): boolean | null => {
        if (i === n) return null;
        return geomPolygonContainsPolygon(
          d.nodes.map((node: OsmNode): Vec2 => node.loc!),
          w.nodes.map((node: OsmNode): Vec2 => node.loc!)
        );
      });
    });

    // Sort all polygons as either outer or inner ways
    const members: OsmRelationMember[] = [];
    let outer = true;

    while (polygons.length) {
      extractUncontained(polygons);
      polygons = polygons.filter(isContained);
      contained = contained.filter(isContained).map(filterContained);
    }

    function isContained(_d: unknown, i: number): boolean {
      return contained[i].some(Boolean);
    }

    function filterContained(d: (boolean | null)[]): (boolean | null)[] {
      return d.filter((_v: boolean | null, i: number) => isContained(null, i));
    }

    function extractUncontained(polygons: MergePolygon[]): void {
      polygons.forEach((d: MergePolygon, i: number) => {
        if (!isContained(d, i)) {
          for (const member of d) {
            members.push({
              type: 'way',
              id: member.id,
              role: outer ? 'outer' : 'inner'
            });
          }
        }
      });
      outer = !outer;
    }

    // Move all tags to one relation
    let relation = entities.multipolygon[0];
    if (!relation) {
      relation = new OsmRelation(graph.context, { id: newRelationID, tags: { type: 'multipolygon' }});
    }

    entities.multipolygon.slice(1).forEach((m: OsmRelation) => {
      relation = relation.mergeTags(m.tags);
      graph.remove(m);
    });

    entities.closedWay.forEach((way: OsmWay) => {
      function isThisOuter(m: OsmRelationMember): boolean {
        return m.id === way.id && m.role !== 'inner';
      }
      if (members.some(isThisOuter)) {
        relation = relation.mergeTags(way.tags);
        graph.replace(way.update({ tags: {} }));
      }
    });

    relation = relation.update({
      members: members,
      tags: utilObjectOmit(relation.tags, ['area'])
    });

    return graph.replace(relation).commit();
  }) as Action;


  action.disabled = function(graph: Graph): string | false {
    const entities = gatherEntityData(graph);
    if (entities.other.length > 0 ||
      entities.closedWay.length + entities.multipolygon.length < 2) {
      return 'not_eligible';
    }
    if (!entities.multipolygon.every(r => r.isComplete(graph))) {
      return 'incomplete_relation';
    }

    if (!entities.multipolygon.length) {
      let sharedMultipolygons: OsmRelation[] = [];
      entities.closedWay.forEach((way: OsmWay, i: number) => {
        const parentMultipolygons = graph.parentRelations(way).filter(r => r.isMultipolygon());

        if (i === 0) {
          sharedMultipolygons = parentMultipolygons;
        } else {
          sharedMultipolygons = utilArrayIntersection(sharedMultipolygons, parentMultipolygons);
        }
      });

      sharedMultipolygons = sharedMultipolygons.filter(r => r.members.length === entities.closedWay.length);

      if (sharedMultipolygons.length) {
        // don't create a new multipolygon if it'd be redundant
        return 'not_eligible';
      }

    } else if (entities.closedWay.some((way: OsmWay) => {
        const parentMultipolygons = graph.parentRelations(way).filter(r => r.isMultipolygon());
        return utilArrayIntersection(parentMultipolygons, entities.multipolygon).length;
      })) {
      // don't add a way to a multipolygon again if it's already a member
      return 'not_eligible';
    }
    return false;
  };


  return action;
}
