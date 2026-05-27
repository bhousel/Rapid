import { osmJoinWays } from '../lib/multipolygon.ts';
import { OsmWay } from '../data/OsmWay.ts';
import { utilArrayGroupBy, utilObjectOmit } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmRelation, OsmRelationMember, IndexedMember } from '../data/OsmRelation.ts';


/** InsertPair data for paired member insertion */
export interface InsertPair {
  originalID: EntityID;
  insertedID: EntityID;
  nodes: EntityID[];
}

/**
 * An `IndexedMember` that may have been decorated with a `pair` property
 * during way-member ordering.  The `pair` holds the two real members that
 * replace a temporary "wTemp" way once ordering is complete.
 */
type PairedMember = IndexedMember & { pair?: OsmRelationMember[] };


/**
 * Adds a member to a relation, with special handling for way members
 * to insert them in sensible positions based on how ways connect.
 *
 * @param   relationID   - EntityID of the relation to add to
 * @param   member       - The member to add
 * @param   memberIndex  - Optional index position (if missing, code will choose)
 * @param   insertPair   - Optional InsertPair for paired insertions (used by actionSplit)
 * @return  An Action function that adds the member to the graph
 */
export function actionAddMember(relationID: EntityID, member: OsmRelationMember, memberIndex?: number, insertPair?: InsertPair): Action {

  return function action(graph: Graph): Graph {
    const relation = graph.entity(relationID) as OsmRelation;

    // There are some special rules for Public Transport v2 routes.
    const isPTv2 = /stop|platform/.test(member.role || '');

    if ((memberIndex === undefined || isNaN(memberIndex) || insertPair) && member.type === 'way' && !isPTv2) {
      // Try to perform sensible inserts based on how the ways join together
      addWayMember(relation, graph);

    } else {
      // see https://wiki.openstreetmap.org/wiki/Public_transport#Service_routes
      // Stops and Platforms for PTv2 should be ordered first.
      // hack: We do not currently have the ability to place them in the exactly correct order.
      if (isPTv2 && (memberIndex === undefined || isNaN(memberIndex))) {
        memberIndex = 0;
      }

      graph.replace(relation.addMember(member, memberIndex));
    }

    return graph.commit();
  };


  /**
   * Adds a way member to the relation at the most sensible position by using
   * `osmJoinWays` to determine how the existing members connect together.
   * @param   relation - The relation to add the way to
   * @param   graph    - The current graph
   */
  function addWayMember(relation: OsmRelation, graph: Graph): void {
    let groups: Record<string, any[]>;
    let tempWay: OsmWay | undefined;

    // remove PTv2 stops and platforms before doing anything.
    const PTv2members: OsmRelationMember[] = [];
    const members: OsmRelationMember[] = [];
    for (const member of relation.members) {
      if (/stop|platform/.test(member.role || '')) {
        PTv2members.push(member);
      } else {
        members.push(member);
      }
    }
    relation = relation.update({ members: members });


    if (insertPair) {
      // We're adding a member that must stay paired with an existing member.
      // (This feature is used by `actionSplit`)
      //
      // This is tricky because the members may exist multiple times in the
      // member list, and with different A-B/B-A ordering and different roles.
      // (e.g. a bus route that loops out and back - iD#4589).
      //
      // Replace the existing member with a temporary way,
      // so that `osmJoinWays` can treat the pair like a single way.
      tempWay = new OsmWay(relation.context, { id: 'wTemp', nodes: insertPair.nodes });
      graph.replace(tempWay);
      const tempMember: OsmRelationMember = { id: tempWay.id, type: 'way', role: member.role };
      const tempRelation = relation.replaceMember({ id: insertPair.originalID }, tempMember, true);
      groups = utilArrayGroupBy(tempRelation.members, 'type');
      groups.way = groups.way || [];

    } else {
      // Add the member anywhere, one time. Just push and let `osmJoinWays` decide where to put it.
      groups = utilArrayGroupBy(relation.members, 'type');
      groups.way = groups.way || [];
      groups.way.push(member);
    }

    const indexedMembers: PairedMember[] = withIndex(groups.way);
    const joined = osmJoinWays(indexedMembers, graph);

    // `joined` might not contain all of the way members,
    // But will contain only the completed (downloaded) members
    for (const segment of joined) {
      const nodes = segment.nodes.slice();
      const startIndex = segment[0].index;
      let j: number, k: number;

      // j = array index in `members` where this segment starts
      for (j = 0; j < indexedMembers.length; j++) {
        if (indexedMembers[j].index === startIndex) {
          break;
        }
      }

      // k = each member in segment
      for (k = 0; k < segment.length; k++) {
        const item = segment[k];
        const way = graph.entity(item.id) as OsmWay;

        // If this is a paired item, generate members in correct order and role
        if (insertPair && tempWay && item.id === tempWay.id) {
          if (nodes[0].id === insertPair.nodes[0]) {
            item.pair = [
              { id: insertPair.originalID, type: 'way', role: item.role },
              { id: insertPair.insertedID, type: 'way', role: item.role }
            ];
          } else {
            item.pair = [
              { id: insertPair.insertedID, type: 'way', role: item.role },
              { id: insertPair.originalID, type: 'way', role: item.role }
            ];
          }
        }

        // reorder `members` if necessary
        if (k > 0) {
          if (j+k >= indexedMembers.length || item.index !== indexedMembers[j+k].index) {
            moveMember(indexedMembers, item.index, j+k);
          }
        }

        nodes.splice(0, way.nodes.length - 1);
      }
    }

    if (tempWay) {
      graph.remove(tempWay);
    }

    // Final pass: skip dead items, split pairs, remove index properties
    const wayMembers: OsmRelationMember[] = [];
    for (const item of indexedMembers) {
      if (item.index === -1) continue;

      if (item.pair) {
        wayMembers.push(item.pair[0]);
        wayMembers.push(item.pair[1]);
      } else {
        wayMembers.push(utilObjectOmit(item, ['index']) as OsmRelationMember);
      }
    }

    // Put stops and platforms first, then nodes, ways, relations
    // This is recommended for Public Transport v2 routes:
    // see https://wiki.openstreetmap.org/wiki/Public_transport#Service_routes
    const newMembers = PTv2members.concat( (groups.node || []), wayMembers, (groups.relation || []) );

    graph.replace(relation.update({ members: newMembers }));


    /**
     * Changes the `members` array in place by splicing
     * the item with `.index = findIndex` to where it belongs,
     * and marking the old position as "dead" with `.index = -1`
     * ```
     * j=5, k=0                jk
     * segment                 5 4 7 6
     * members       0 1 2 3 4 5 6 7 8 9        keep 5 in j+k
     *
     * j=5, k=1                j k
     * segment                 5 4 7 6
     * members       0 1 2 3 4 5 6 7 8 9        move 4 to j+k
     * members       0 1 2 3 x 5 4 6 7 8 9      moved
     *
     * j=5, k=2                j   k
     * segment                 5 4 7 6
     * members       0 1 2 3 x 5 4 6 7 8 9      move 7 to j+k
     * members       0 1 2 3 x 5 4 7 6 x 8 9    moved
     *
     * j=5, k=3                j     k
     * segment                 5 4 7 6
     * members       0 1 2 3 x 5 4 7 6 x 8 9    keep 6 in j+k
     * ```
     */
    function moveMember(arr: IndexedMember[], findIndex: number, toIndex: number): void {
      let i: number;
      for (i = 0; i < arr.length; i++) {
        if (arr[i].index === findIndex) {
          break;
        }
      }

      const item = { ...arr[i] };   // shallow copy
      arr[i].index = -1;   // mark as dead
      item.index = toIndex;
      arr.splice(toIndex, 0, item);
    }


    /**
     * Shallow-copies each element of `arr` and attaches an `.index` property
     * equal to its array position.  Equivalent to `Relation.indexedMembers`
     * but scoped only to the way-member subset.
     * @param   arr - Array of relation member objects
     * @return  The same members with an added `.index` property
     */
    function withIndex(arr: any[]): IndexedMember[] {
      const result = new Array(arr.length);
      for (let i = 0; i < arr.length; i++) {
        result[i] = { ...arr[i] };   // shallow copy
        result[i].index = i;
      }
      return result;
    }
  }
}
