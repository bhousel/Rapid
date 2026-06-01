import { actionAddMember } from './add_member.ts';
import { geoSphericalDistance, numWrap } from '@rapid-sdk/math';
import { OsmRelation } from '../data/OsmRelation.ts';
import { OsmWay } from '../data/OsmWay.ts';
import { utilArrayIntersection, utilArrayUniq } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { OsmRelationMember } from '../data/OsmRelation.ts';


/** History preservation strategy for split action */
type KeepHistoryStrategy = 'longest' | 'first';


/**
 * Extended Action for split operations that includes additional methods.
 */
export interface SplitAction extends Action {
  /** Returns the IDs of ways created by the split action */
  getCreatedWayIDs(): EntityID[];
  /** Returns the ways that can be split at the given node */
  waysForNode(nodeID: EntityID, graph: Graph): OsmWay[];
  /** Returns all ways that would be affected by the split */
  ways(graph: Graph): OsmWay[];
  /** Gets or sets the ways to limit the split to */
  limitWays(): EntityID[] | undefined;
  limitWays(val: EntityID[]): SplitAction;
  /** Gets or sets the history preservation strategy */
  keepHistoryOn(): KeepHistoryStrategy;
  keepHistoryOn(val: KeepHistoryStrategy): SplitAction;
}


/**
 * Splits a way at the given node(s).
 * For closed ways, finds a partner node to split the area naturally.
 * Optionally, split only specific ways if multiple share the node.
 * This is the inverse of `actionJoin`.
 *
 * @param   nodeIDs    - EntityID or array of EntityIDs of nodes to split at
 * @param   newWayIDs  - Optional IDs to assign to new ways (for testing)
 * @return  An Action function that splits the way(s)
 */
export function actionSplit(nodeIDs: EntityID | EntityID[], newWayIDs?: EntityID[]): SplitAction {
  // accept single ID for backwards-compatibility
  const nodeIDsArray: EntityID[] = typeof nodeIDs === 'string' ? [nodeIDs] : nodeIDs;

  let _wayIDs: EntityID[] | undefined;
  // the strategy for picking which way will have a new version and which way is newly created
  let _keepHistoryOn: KeepHistoryStrategy = 'longest'; // 'longest', 'first'

  // The IDs of the ways actually created by running this action
  let _createdWayIDs: EntityID[] = [];

  /**
   * Returns the great-circle distance in metres between two nodes.
   * Falls back to a small epsilon value if either node lacks a location.
   * @param   graph - The current graph
   * @param   nA    - EntityID of the first node
   * @param   nB    - EntityID of the second node
   * @return  Distance in metres, or a small epsilon if locations are unavailable
   */
  function dist(graph: Graph, nA: EntityID, nB: EntityID): number {
    const locA = (graph.entity(nA) as OsmNode).loc;
    const locB = (graph.entity(nB) as OsmNode).loc;
    const epsilon = 1e-6;
    return (locA && locB) ? geoSphericalDistance(locA, locB) : epsilon;
  }

  /**
   * For a closed way, finds the best partner index to split across from `idxA`.
   * The "best" node is the one that maximizes `pathLength / beelineDistance`,
   * which picks a split that is both far along the perimeter and close as the
   * crow flies — e.g. splitting a bone shape at its waist or a circle at its
   * diameter.
   * @param   nodes - Node ID array (without the repeated closing node)
   * @param   idxA  - Index of the split node in `nodes`
   * @param   graph - The current graph
   * @return  Index of the best partner node, or `undefined` if none found
   */
  function splitArea(nodes: EntityID[], idxA: number, graph: Graph): number | undefined {
    const lengths = new Array<number>(nodes.length);
    let length: number;
    let i: number;
    let best = 0;
    let idxB: number | undefined;

    /**
     * Wraps an index to stay within `[0, nodes.length)` using modular arithmetic.
     * @param   index - The raw index to wrap
     * @return  Wrapped index in range `[0, nodes.length)`
     */
    function wrap(index: number): number {
      return numWrap(index, 0, nodes.length);
    }

    // calculate lengths
    length = 0;
    for (i = wrap(idxA + 1); i !== idxA; i = wrap(i + 1)) {
      length += dist(graph, nodes[i], nodes[wrap(i - 1)]);
      lengths[i] = length;
    }

    length = 0;
    for (i = wrap(idxA - 1); i !== idxA; i = wrap(i - 1)) {
      length += dist(graph, nodes[i], nodes[wrap(i + 1)]);
      if (length < lengths[i]) {
        lengths[i] = length;
      }
    }

    // determine best opposite node to split
    for (i = 0; i < nodes.length; i++) {
      const cost = lengths[i] / dist(graph, nodes[idxA], nodes[i]);
      if (cost > best) {
        idxB = i;
        best = cost;
      }
    }

    return idxB;
  }


  /**
   * Computes the total great-circle path length along a sequence of nodes.
   * @param   graph - The current graph
   * @param   nodes - Ordered array of node EntityIDs
   * @return  Total path length in metres
   */
  function totalLengthBetweenNodes(graph: Graph, nodes: EntityID[]): number {
    let totalLength = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      totalLength += dist(graph, nodes[i], nodes[i + 1]);
    }
    return totalLength;
  }


  /**
   * Splits a single way `wayA` at `nodeID`, creating `wayB` as the new way.
   * For closed ways, `splitArea` picks the best partner index.  For open ways,
   * the node's first occurrence after index 0 is used as the split point.
   * Proportionally distributes `step_count` tags between the two halves.
   * Updates all parent relations (turn restrictions, routes, multipolygons)
   * to include both resulting ways at the correct positions.
   * @param   graph    - The current graph
   * @param   nodeID   - EntityID of the node to split at
   * @param   wayA     - The way to split (retains its ID)
   * @param   newWayId - Optional EntityID to assign to the new way
   * @return  Updated graph
   */
  function split(graph: Graph, nodeID: EntityID, wayA: OsmWay, newWayId: EntityID | undefined): Graph {
    let wayB = new OsmWay(wayA.context, { id: newWayId, tags: wayA.tags });   // `wayB` is the NEW way
    const origNodes: EntityID[] = wayA.nodes.slice();
    let nodesA: EntityID[];
    let nodesB: EntityID[];
    const isArea = wayA.isArea();

    if (wayA.isClosed()) {
      const nodes: EntityID[] = wayA.nodes.slice(0, -1);
      const idxA = nodes.indexOf(nodeID);
      const idxB = splitArea(nodes, idxA, graph)!;
      if (idxB < idxA) {
        nodesA = nodes.slice(idxA).concat(nodes.slice(0, idxB + 1));
        nodesB = nodes.slice(idxB, idxA + 1);
      } else {
        nodesA = nodes.slice(idxA, idxB + 1);
        nodesB = nodes.slice(idxB).concat(nodes.slice(0, idxA + 1));
      }

    } else {
      const idx = wayA.nodes.indexOf(nodeID, 1);
      nodesA = wayA.nodes.slice(0, idx + 1);
      nodesB = wayA.nodes.slice(idx);
    }

    let lengthA = totalLengthBetweenNodes(graph, nodesA);
    let lengthB = totalLengthBetweenNodes(graph, nodesB);

    if (_keepHistoryOn === 'longest' && lengthB > lengthA) {
      // keep the history on the longer way, regardless of the node count
      wayA = wayA.update({ nodes: nodesB });
      wayB = wayB.update({ nodes: nodesA });

      const temp = lengthA;
      lengthA = lengthB;
      lengthB = temp;
    } else {
      wayA = wayA.update({ nodes: nodesA });
      wayB = wayB.update({ nodes: nodesB });
    }

    // Split the step_count - see iD#8069
    // divide up the the step count proportionally between the two ways
    if (wayA.tags.step_count) {
      const stepCount = parseFloat(wayA.tags.step_count);
      if (stepCount && isFinite(stepCount) && stepCount > 0 && Math.round(stepCount) === stepCount) {
        const tagsA = { ...wayA.tags };  // shallow copy
        const tagsB = { ...wayB.tags };  // shallow copy

        const ratioA = lengthA / (lengthA + lengthB);
        const countA = Math.round(stepCount * ratioA);

        tagsA.step_count = countA.toString();
        tagsB.step_count = (stepCount - countA).toString();

        wayA = wayA.update({ tags: tagsA });
        wayB = wayB.update({ tags: tagsB });
      }
    }


    graph.replace(wayA);
    graph.replace(wayB);

    for (const relation of graph.parentRelations(wayA)) {
      let member: OsmRelationMember;
      let rel: OsmRelation = relation;

      // Turn restrictions - make sure:
      // 1. Splitting a FROM/TO way - only `wayA` OR `wayB` remains in relation
      //    (whichever one is connected to the VIA node/ways)
      // 2. Splitting a VIA way - `wayB` remains in relation as a VIA way
      if (rel.hasFromViaTo()) {
        const f = rel.memberByRole('from')!;
        const v = rel.membersByRole('via');
        const t = rel.memberByRole('to')!;

        // 1. split a FROM/TO
        if (f.id === wayA.id || t.id === wayA.id) {
          let keepB = false;
          if (v.length === 1 && v[0].type === 'node') {   // check via node
            keepB = wayB.contains(v[0].id);
          } else {                                        // check via way(s)
            for (const via of v) {
              if (via.type !== 'way') continue;
              const wayV = graph.hasEntity(via.id) as OsmWay | undefined;
              if (wayV && utilArrayIntersection(wayB.nodes, wayV.nodes).length) {
                keepB = true;
                break;
              }
            }
          }

          if (keepB) {
            rel = rel.replaceMember({ id: wayA.id }, { id: wayB.id, type: 'way' });
            graph.replace(rel);
          }

        // 2. split a VIA
        } else {
          for (const via of v) {
            if (via.type === 'way' && via.id === wayA.id) {
              member = { id: wayB.id, type: 'way', role: 'via' };
              graph = actionAddMember(rel.id, member, via.index + 1)(graph);
              break;
            }
          }
        }

      // All other relations (Routes, Multipolygons, etc):
      // 1. Both `wayA` and `wayB` remain in the relation
      // 2. But must be inserted as a pair (see `actionAddMember` for details)
      } else {
        member = { id: wayB.id, type: 'way', role: rel.memberById(wayA.id)!.role };
        const insertPair = { originalID: wayA.id, insertedID: wayB.id, nodes: origNodes };
        graph = actionAddMember(rel.id, member, undefined, insertPair)(graph);
      }
    }

    if (isArea) {
      // If the way is already in a multipolygon relation, move its tags
      // to that relation instead of creating a new one.
      const parentMP = graph.parentRelations(wayA).find(r => r.isMultipolygon());
      if (parentMP) {
        graph.replace(parentMP.mergeTags(wayA.tags));
      } else {
        const multipolygon = new OsmRelation(wayA.context, {
          tags: Object.assign({}, wayA.tags, { type: 'multipolygon' }),
          members: [
            { id: wayA.id, role: 'outer', type: 'way' },
            { id: wayB.id, role: 'outer', type: 'way' }
          ]
        });
        graph.replace(multipolygon);
      }

      graph.replace(wayA.update({ tags: {} }));
      graph.replace(wayB.update({ tags: {} }));
    }

    _createdWayIDs.push(wayB.id);

    return graph.commit();
  }


  const action = ((graph: Graph): Graph => {
    _createdWayIDs = [];
    let newWayIndex = 0;
    for (const nodeID of nodeIDsArray) {
      const candidates = action.waysForNode(nodeID, graph);
      for (const candidate of candidates) {
        graph = split(graph, nodeID, candidate, newWayIDs && newWayIDs[newWayIndex]);
        newWayIndex += 1;
      }
    }

    return graph;
  }) as SplitAction;


  action.getCreatedWayIDs = function(): EntityID[] {
    return _createdWayIDs;
  };


  action.waysForNode = function(nodeID: EntityID, graph: Graph): OsmWay[] {
    const node = graph.entity(nodeID) as OsmNode;
    const splittableParents = graph.parentWays(node).filter(isSplittable);

    if (!_wayIDs) {
      // If the ways to split aren't specified, only split the lines.
      // If there are no lines to split, split the areas.
      const hasLine = splittableParents.some(parent => parent.geometry(graph) === 'line');
      if (hasLine) {
        return splittableParents.filter(parent => parent.geometry(graph) === 'line');
      }
    }
    return splittableParents;

    /**
     *
     * @param parent
     */
    function isSplittable(parent: OsmWay): boolean {
      // If the ways to split are specified, ignore everything else.
      if (_wayIDs && !_wayIDs.includes(parent.id)) return false;

      // We can fake splitting closed ways at their endpoints...
      if (parent.isClosed()) return true;

      // otherwise, we can't split nodes at their endpoints.
      for (let i = 1; i < parent.nodes.length - 1; i++) {
        if (parent.nodes[i] === nodeID) return true;
      }

      return false;
    }
  };


  action.ways = function(graph: Graph): OsmWay[] {
    const allWays: OsmWay[] = nodeIDsArray.flatMap(nodeID => action.waysForNode(nodeID, graph));
    return utilArrayUniq(allWays);
  };


  /**
   * Returns a reason string if the split operation cannot be performed,
   * or `false` if it is allowed.
   * @param   graph - The current graph
   * @return  `'not_eligible'` if any split node has no candidate ways, or if the number of
   *          candidate ways does not match the `limitWays` filter;
   *          `false` if the action is enabled
   */
  action.disabled = function(graph: Graph): string | false {
    for (const nodeID of nodeIDsArray) {
      const candidates = action.waysForNode(nodeID, graph);
      if (candidates.length === 0 || (_wayIDs && _wayIDs.length !== candidates.length)) {
        return 'not_eligible';
      }
    }
    return false;
  };


  action.limitWays = function(val?: EntityID[]): EntityID[] | undefined | SplitAction {
    if (!arguments.length) return _wayIDs;
    _wayIDs = val;
    return action;
  } as SplitAction['limitWays'];


  action.keepHistoryOn = function(val?: KeepHistoryStrategy): KeepHistoryStrategy | SplitAction {
    if (!arguments.length) return _keepHistoryOn;
    _keepHistoryOn = val!;
    return action;
  } as SplitAction['keepHistoryOn'];


  return action;
}
