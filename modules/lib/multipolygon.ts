import { actionReverse } from '../actions/reverse.js';
import { osmIsInterestingTag } from './tags.js';
import { OsmWay } from '../data/OsmWay.js';

import type { Graph } from './Graph.ts';
import type { Action, Entity, NodeEntity, RelationEntity, RelationMember, WayEntity } from './types.ts';


/**
 * A sequence of joined ways with their nodes.
 */
export interface JoinedWaySequence extends Array<RelationMember | WayEntity> {
  /** Ordered array of nodes after joining */
  nodes: NodeEntity[];
}

/**
 * Result of osmJoinWays function.
 */
export interface JoinedWaysResult extends Array<JoinedWaySequence> {
  /** Actions to apply to reverse ways if needed */
  actions: Action[];
}


// "Old" multipolyons, previously known as "simple" multipolygons, are as follows:
//
// 1. Relation tagged with `type=multipolygon` and no interesting tags.
// 2. One and only one member with the `outer` role. Must be a way with interesting tags.
// 3. No members without a role.
//
// Old multipolygons are no longer recommended but are still rendered as areas.

export function osmOldMultipolygonOuterMemberOfRelation(entity: Entity, graph: Graph): WayEntity | false {
  if (entity.type !== 'relation' ||
    !entity.isMultipolygon()
    || Object.keys(entity.tags).filter(osmIsInterestingTag).length > 1) {
    return false;
  }

  let outerMember: WayEntity | undefined;
  for (const member of (entity as RelationEntity).members) {
    if (!member.role || member.role === 'outer') {
      if (outerMember) return false;
      if (member.type !== 'way') return false;
      if (!graph.hasEntity(member.id)) return false;

      outerMember = graph.entity(member.id) as WayEntity;

      if (Object.keys(outerMember.tags).filter(osmIsInterestingTag).length === 0) {
        return false;
      }
    }
  }

  return outerMember || false;
}


// For fixing up rendering of multipolygons with tags on the outer member.
// https://github.com/openstreetmap/iD/issues/613
export function osmIsOldMultipolygonOuterMember(entity: Entity, graph: Graph): RelationEntity | false {
  if (entity.type !== 'way' ||
    Object.keys(entity.tags).filter(osmIsInterestingTag).length === 0) {
    return false;
  }

  const parents = graph.parentRelations(entity);
  if (parents.length !== 1) return false;

  const parent = parents[0];
  if (!parent.isMultipolygon() ||
    Object.keys(parent.tags).filter(osmIsInterestingTag).length > 1) {
    return false;
  }

  for (const member of parent.members) {
    if (member.id === entity.id && member.role && member.role !== 'outer') {
      // Not outer member
      return false;
    }
    if (member.id !== entity.id && (!member.role || member.role === 'outer')) {
      // Not a simple multipolygon
      return false;
    }
  }

  return parent;
}


export function osmOldMultipolygonOuterMember(entity: Entity, graph: Graph): WayEntity | false {
  if (entity.type !== 'way') return false;

  const parents = graph.parentRelations(entity);
  if (parents.length !== 1) return false;

  const parent = parents[0];
  if (!parent.isMultipolygon() ||
    Object.keys(parent.tags).filter(osmIsInterestingTag).length > 1) {
    return false;
  }

  let outerMember: RelationMember | undefined;
  for (const member of parent.members) {
    if (!member.role || member.role === 'outer') {
      if (outerMember) return false; // Not a simple multipolygon
      outerMember = member;
    }
  }

  if (!outerMember) return false;

  const outerEntity = graph.hasEntity(outerMember.id) as WayEntity | undefined;
  if (!outerEntity ||
    !Object.keys(outerEntity.tags).filter(osmIsInterestingTag).length) {
    return false;
  }

  return outerEntity;
}


// Join `toJoin` array into sequences of connecting ways.

// Segments which share identical start/end nodes will, as much as possible,
// be connected with each other.
//
// The return value is a nested array. Each constituent array contains elements
// of `toJoin` which have been determined to connect.
//
// Each consitituent array also has a `nodes` property whose value is an
// ordered array of member nodes, with appropriate order reversal and
// start/end coordinate de-duplication.
//
// Members of `toJoin` must have, at minimum, `type` and `id` properties.
// Thus either an array of `OsmWay`s or a relation member array may be used.
//
// If an member is an `OsmWay`, its tags and childnodes may be reversed via
// `actionReverse` in the output.
//
// The returned sequences array also has an `actions` array property, containing
// any reversal actions that should be applied to the graph, should the calling
// code attempt to actually join the given ways.
//
// Incomplete members (those for which `graph.hasEntity(element.id)` returns
// false) and non-way members are ignored.
//
export function osmJoinWays(toJoin: (RelationMember | WayEntity)[], graph: Graph): JoinedWaysResult {
  type JoinableItem = RelationMember | WayEntity;

  function resolve(member: JoinableItem): NodeEntity[] {
    return graph.childNodes(graph.entity(member.id) as WayEntity);
  }

  function reverse(item: JoinableItem): JoinableItem {
    const action = actionReverse(item.id, { reverseOneway: true }) as Action;
    sequences.actions.push(action);
    return (item instanceof OsmWay) ? action(graph).entity(item.id) as WayEntity : item;
  }

  // make a copy containing only the items to join
  let items: JoinableItem[] = toJoin.filter((member): member is JoinableItem => {
    return member.type === 'way' && graph.hasEntity(member.id) !== undefined;
  });

  // Are the things we are joining relation members or `OsmWays`?
  // If `OsmWays`, skip the "prefer a forward path" code below (see iD#4872)
  let joinAsMembers = true;
  for (let i = 0; i < items.length; i++) {
    if (items[i] instanceof OsmWay) {
      joinAsMembers = false;
      break;
    }
  }

  const sequences = [] as unknown as JoinedWaysResult;
  sequences.actions = [];

  while (items.length) {
    // start a new sequence
    let item = items.shift()!;
    const currWays = [item] as unknown as JoinedWaySequence;
    const currNodes: NodeEntity[] = resolve(item).slice();

    // add to it
    let i: number;
    while (items.length) {
      let start = currNodes[0];
      let end = currNodes[currNodes.length - 1];
      let joinAtEnd: boolean | null = null;
      let nodes: NodeEntity[] | null = null;

      // Find the next way/member to join.
      for (i = 0; i < items.length; i++) {
        item = items[i];
        nodes = resolve(item);

        // (for member ordering only, not way ordering - see #4872)
        // Strongly prefer to generate a forward path that preserves the order
        // of the members array. For multipolygons and most relations, member
        // order does not matter - but for routes, it does. (see #4589)
        // If we started this sequence backwards (i.e. next member way attaches to
        // the start node and not the end node), reverse the initial way before continuing.
        if (joinAsMembers && currWays.length === 1 && nodes[0] !== end && nodes[nodes.length - 1] !== end &&
          (nodes[nodes.length - 1] === start || nodes[0] === start)
        ) {
          currWays[0] = reverse(currWays[0]);
          currNodes.reverse();
          start = currNodes[0];
          end = currNodes[currNodes.length - 1];
        }

        if (nodes[0] === end) {
          joinAtEnd = true;                          // join to end
          nodes = nodes.slice(1);
          break;
        } else if (nodes[nodes.length - 1] === end) {
          joinAtEnd = true;                          // join to end
          nodes = nodes.slice(0, -1).reverse();
          item = reverse(item);
          break;
        } else if (nodes[nodes.length - 1] === start) {
          joinAtEnd = false;                         // join to beginning
          nodes = nodes.slice(0, -1);
          break;
        } else if (nodes[0] === start) {
          joinAtEnd = false;                         // join to beginning
          nodes = nodes.slice(1).reverse();
          item = reverse(item);
          break;
        } else {
          joinAtEnd = nodes = null;
        }
      }

      if (!nodes) {     // couldn't find a joinable way/member
        break;
      }

      if (joinAtEnd) {
        currWays.push(item);
        currNodes.push(...nodes);
      } else {
        currWays.unshift(item);
        currNodes.unshift(...nodes);
      }

      items.splice(i, 1);
    }

    currWays.nodes = currNodes;
    sequences.push(currWays);
  }

  return sequences;
}
