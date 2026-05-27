import { actionReverse } from '../actions/reverse.ts';

import { OsmNode } from '../data/OsmNode.ts';
import { OsmWay } from '../data/OsmWay.ts';

import type { Graph } from './Graph.ts';
import type { OsmRelationMember } from '../data/types.ts';
import type { Action } from '../actions/types.ts';


/**
 * A sequence of joined ways with their nodes.
 */
export interface JoinedWaySequence<T extends OsmRelationMember | OsmWay = OsmRelationMember | OsmWay> extends Array<T> {
  /** Ordered array of nodes after joining */
  nodes: OsmNode[];
}

/**
 * Result of osmJoinWays function.
 */
export interface JoinedWaysResult<T extends OsmRelationMember | OsmWay = OsmRelationMember | OsmWay> extends Array<JoinedWaySequence<T>> {
  /** Actions to apply to reverse ways if needed */
  actions: Action[];
}


/**
 * Joins an array of ways or relation members into sequences of connecting ways.
 *
 * Segments which share identical start/end nodes will, as much as possible,
 * be connected with each other.
 *
 * The return value is a nested array. Each constituent array contains elements
 * of `toJoin` which have been determined to connect.
 *
 * Each constituent array also has a `nodes` property whose value is an
 * ordered array of member nodes, with appropriate order reversal and
 * start/end coordinate de-duplication.
 *
 * Members of `toJoin` must have, at minimum, `type` and `id` properties.
 * Thus either an array of `OsmWay`s or a relation member array may be used.
 *
 * If a member is an `OsmWay`, its tags and child nodes may be reversed via
 * `actionReverse` in the output.
 *
 * The returned sequences array also has an `actions` array property, containing
 * any reversal actions that should be applied to the graph, should the calling
 * code attempt to actually join the given ways.
 *
 * Incomplete members (those for which `graph.hasEntity(element.id)` returns
 * false) and non-way members are ignored.
 *
 * @param toJoin - Array of ways or relation members to join
 * @param graph - The graph containing the entities
 * @returns Array of joined way sequences, each with a `nodes` property
 */
export function osmJoinWays<T extends OsmRelationMember | OsmWay>(toJoin: T[], graph: Graph): JoinedWaysResult<T> {
  function resolve(member: T): OsmNode[] {
    return graph.childNodes(graph.entity(member.id) as OsmWay);
  }

  function reverse(item: T): T {
    const action = actionReverse(item.id, { reverseOneway: true });
    sequences.actions.push(action);
    return (item instanceof OsmWay) ? action(graph).entity(item.id) as unknown as T : item;
  }

  // make a copy containing only the items to join
  const items: T[] = toJoin.filter((member): member is T => {
    return member.type === 'way' && graph.hasEntity(member.id) !== undefined;
  });

  // Make a copy of the graph before doing anything.
  // We don't want any reverses to actually be applied to the caller's graph.
  graph = graph.snapshot();

  // Are the things we are joining relation members or `OsmWays`?
  // If `OsmWays`, skip the "prefer a forward path" code below (see iD#4872)
  let joinAsMembers = true;
  for (const item of items) {
    if (item instanceof OsmWay) {
      joinAsMembers = false;
      break;
    }
  }

  const sequences = [] as unknown as JoinedWaysResult<T>;
  sequences.actions = [];

  while (items.length) {
    // start a new sequence
    let item = items.shift()!;
    const currWays = [item] as unknown as JoinedWaySequence<T>;
    const currNodes: OsmNode[] = resolve(item).slice();

    // add to it
    let i: number;
    while (items.length) {
      let start = currNodes[0];
      let end = currNodes[currNodes.length - 1];
      let joinAtEnd: boolean | null = null;
      let nodes: OsmNode[] | null = null;

      // Find the next way/member to join.
      for (i = 0; i < items.length; i++) {
        item = items[i];
        nodes = resolve(item);

        // (for member ordering only, not way ordering - see iD#4872)
        // Strongly prefer to generate a forward path that preserves the order
        // of the members array. For multipolygons and most relations, member
        // order does not matter - but for routes, it does. (see iD#4589)
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
