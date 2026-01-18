import { RAD2DEG, geoSphericalDistance, vecAngle } from '@rapid-sdk/math';
import { utilArrayDifference, utilArrayUniq } from '@rapid-sdk/util';

import { actionDeleteRelation } from '../actions/delete_relation.js';
import { actionReverse } from '../actions/reverse.js';
import { actionSplit } from '../actions/split.js';
import { Graph } from './Graph.ts';

import type { Context, OsmEntity, OsmNode, OsmRelation, OsmWay, Vec2 } from '../data/types.ts';
import type { Action } from './types.ts';


/**
 * Endpoint of a turn (from or to).
 */
export interface TurnEndpoint {
  node: EntityID;
  way: EntityID;
  vertex: EntityID;
}

/**
 * Via part of a turn.
 */
export interface TurnVia {
  node?: EntityID;
  ways?: EntityID[];
}

/**
 * Turn data structure representing a possible turn through an intersection.
 */
export interface Turn {
  key: string;
  path: EntityID[];
  from: TurnEndpoint;
  via: TurnVia;
  to: TurnEndpoint;
  u: boolean;
  restrictionID?: string;
  no?: boolean;
  only?: boolean;
  direct?: boolean;
}

/**
 * Intersection data structure.
 */
export interface Intersection {
  graph: Graph;
  actions: Array<Action>;
  vertices: OsmNode[];
  ways: OsmWay[];
  turns: (fromWayID: EntityID, maxViaWay?: number) => osmTurn[];
}


/**
 * osmTurn
 * Class representing a turn through an intersection.
 * Properties are assigned directly to the instance for backward compatibility.
 */
export class osmTurn implements Turn {
  key!: string;
  path!: EntityID[];
  from!: TurnEndpoint;
  via!: TurnVia;
  to!: TurnEndpoint;
  u!: boolean;
  restrictionID?: string;
  no?: boolean;
  only?: boolean;
  direct?: boolean;

  constructor(turn: Partial<Turn>) {
    Object.assign(this, turn);
  }
}


export function osmIntersection(
  context: Context,
  graph: Graph,
  startvertexID: EntityID,
  maxDistance: number = 30
): Intersection | null {


  function memberOfRestriction(entity: OsmEntity): boolean {
    return graph.parentRelations(entity).some((r: OsmRelation) => r.isRestriction());
  }

  function isRoad(way: OsmWay): boolean {
    if (way.isArea() || way.isDegenerate()) return false;
    const roads: Record<string, boolean> = {
      'motorway': true,
      'motorway_link': true,
      'trunk': true,
      'trunk_link': true,
      'primary': true,
      'primary_link': true,
      'secondary': true,
      'secondary_link': true,
      'tertiary': true,
      'tertiary_link': true,
      'residential': true,
      'unclassified': true,
      'living_street': true,
      'service': true,
      'busway': true,
      'road': true,
      'track': true
    };
    return !!roads[way.tags.highway];
  }


  const startNode = graph.entity(startvertexID) as OsmNode;
  if (!startNode || !startNode.loc) return null;

  const checkVertices: OsmNode[] = [startNode];
  let vertices: OsmNode[] = [];
  let ways: OsmWay[] = [];
  let parents: OsmWay[] = [];

  // `actions` will store whatever actions must be performed to satisfy
  // preconditions for adding a turn restriction to this intersection.
  //  - Remove any existing degenerate turn restrictions (missing from/to, etc)
  //  - Reverse oneways so that they are drawn in the forward direction
  //  - Split ways on key vertices
  const actions: Array<Action> = [];


  // STEP 1:  walk the graph outwards from starting vertex to search
  //  for more key vertices and ways to include in the intersection..
  while (checkVertices.length) {
    const vertex = checkVertices.pop()!;

    // check this vertex for parent ways that are roads
    const checkWays = graph.parentWays(vertex);
    let hasWays = false;
    for (const way of checkWays) {
      if (!isRoad(way) && !memberOfRestriction(way)) continue;

      ways.push(way);   // it's a road, or it's already in a turn restriction
      hasWays = true;

      // check the way's children for more key vertices
      const nodes = utilArrayUniq(graph.childNodes(way));
      for (const node of nodes) {
        if (!node.loc) continue;
        if (node === vertex) continue;                                               // same thing
        if (vertices.includes(node)) continue;                                       // seen it already
        if (geoSphericalDistance(node.loc, startNode.loc) > maxDistance) continue;   // too far from start

        // a key vertex will have parents that are also roads
        let hasParents = false;
        const nodeParents = graph.parentWays(node);
        for (const parent of nodeParents) {
          if (parent === way) continue;          // same thing
          if (ways.includes(parent)) continue;   // seen it already
          if (!isRoad(parent)) continue;         // not a road
          hasParents = true;
          break;
        }

        if (hasParents) {
          checkVertices.push(node);
        }
      }
    }

    if (hasWays) {
      vertices.push(vertex);
    }
  }

  vertices = utilArrayUniq(vertices);
  ways = utilArrayUniq(ways);


  // STEP 2:  Build a virtual graph containing only the entities in the intersection..
  // Everything done after this step should act on the virtual graph
  // Any actions that must be performed later to the main graph go in `actions` array
  const vbase = new Graph(context);
  let vgraph = new Graph(vbase);   // virtual graph
  for (const way of ways) {
    for (const node of graph.childNodes(way)) {
      vgraph.replace(node);
    }
    vgraph.replace(way);
  }
  for (const way of ways) {
    for (const relation of graph.parentRelations(way)) {
      if (!relation.isRestriction()) continue;
      if (relation.isValidRestriction()) {
        vgraph.replace(relation);
      } else if (relation.isComplete(graph)) {
        actions.push(actionDeleteRelation(relation.id));
      }
    }
  }


  // STEP 3:  Force all oneways to be drawn in the forward direction
  for (const w of ways) {
    const way = vgraph.entity(w.id);
    if (way.tags.oneway === '-1') {
      const action = actionReverse(way.id, { reverseOneway: true });
      actions.push(action);
      vgraph = action(vgraph);
    }
  }


  // STEP 4:  Split ways on key vertices
  const origCount = context.sequences.way || 0;
  for (const v of vertices) {
    // This is an odd way to do it, but we need to find all the ways that
    // will be split here, then split them one at a time to ensure that these
    // actions can be replayed on the main graph exactly in the same order.
    // (It is unintuitive, but the order of ways returned from graph.parentWays()
    // is arbitrary, depending on how the main graph and vgraph were built)
    const splitAll = actionSplit([v.id]).keepHistoryOn('first') as any;
    if (!splitAll.disabled(vgraph)) {
      for (const way of splitAll.ways(vgraph) as OsmWay[]) {
        const splitOne = actionSplit([v.id]).limitWays([way.id]).keepHistoryOn('first') as Action;
        actions.push(splitOne);
        vgraph = splitOne(vgraph);
      }
    }
  }

  // In here is where we should also split the intersection at nearby junction.
  //   for https://github.com/mapbox/iD-internal/issues/31
  // nearbyVertices.forEach(function(v) {
  // });

  // Reasons why we reset the way id count here:
  //  1. Continuity with way ids created by the splits so that we can replay
  //     these actions later if the user decides to create a turn restriction
  //  2. Avoids churning way ids just by hovering over a vertex
  //     and displaying the turn restriction editor
  context.sequences.way = origCount;


  // STEP 5:  Update arrays to point to vgraph entities
  let vertexIDs: EntityID[] = vertices.map(v => v.id);
  vertices = [];
  ways = [];

  for (const vertexID of vertexIDs) {
    const vertex = vgraph.entity(vertexID) as OsmNode;
    const vparents = vgraph.parentWays(vertex);
    vertices.push(vertex);
    ways = ways.concat(vparents);
  }

  vertices = utilArrayUniq(vertices);
  ways = utilArrayUniq(ways);

  vertexIDs = vertices.map(v => v.id);
  const wayIDs = ways.map(w => w.id);


  // STEP 6:  Update the ways with some metadata that will be useful for
  // walking the intersection graph later and rendering turn arrows.

  function withMetadata(way: OsmWay, vertexIDs: EntityID[]): OsmWay {
    const __oneWay = way.isOneWay();

    // which affixes are key vertices?
    const __first = (vertexIDs.includes(way.first() || ''));
    const __last = (vertexIDs.includes(way.last() || ''));

    // what roles is this way eligible for?
    const __via = (__first && __last);
    const __from = ((__first && !__oneWay) || __last);
    const __to = (__first || (__last && !__oneWay));

    return way.update({
      __first:  __first,
      __last:  __last,
      __from:  __from,
      __via: __via,
      __to:  __to,
      __oneWay:  __oneWay
    });
  }

  ways = [];
  for (const wayID of wayIDs) {
    const way = withMetadata(vgraph.entity(wayID) as OsmWay, vertexIDs);
    vgraph.replace(way);
    ways.push(way);
  }


  // STEP 7:  Simplify - This is an iterative process where we:
  //  1. Find trivial vertices with only 2 parents
  //  2. trim off the leaf way from those vertices and remove from vgraph

  let keepGoing: boolean;
  const removeWayIDs: EntityID[] = [];
  const removeVertexIDs: EntityID[] = [];

  do {
    keepGoing = false;
    const checkIDs = vertexIDs.slice();

    for (const vertexID of checkIDs) {
      const vertex = vgraph.hasEntity(vertexID) as OsmNode | undefined;

      if (!vertex) {
        if (vertexIDs.includes(vertexID)) {
          vertexIDs.splice(vertexIDs.indexOf(vertexID), 1);   // stop checking this one
        }
        removeVertexIDs.push(vertexID);
        continue;
      }

      parents = vgraph.parentWays(vertex);
      if (parents.length < 3) {
        if (vertexIDs.includes(vertexID)) {
          vertexIDs.splice(vertexIDs.indexOf(vertexID), 1);   // stop checking this one
        }
      }

      if (parents.length === 2) {     // vertex with 2 parents is trivial
        const a = parents[0];
        const b = parents[1];
        const aIsLeaf = a && !a.props.__via;
        const bIsLeaf = b && !b.props.__via;
        let leaf: OsmWay | undefined;
        let survivor: OsmWay | undefined;

        if (aIsLeaf && !bIsLeaf) {
          leaf = a;
          survivor = b;
        } else if (!aIsLeaf && bIsLeaf) {
          leaf = b;
          survivor = a;
        }

        if (leaf && survivor) {
          survivor = withMetadata(survivor, vertexIDs);      // update survivor way
          vgraph.replace(survivor).remove(leaf);    // update graph
          removeWayIDs.push(leaf.id);
          keepGoing = true;
        }
      }

      parents = vgraph.parentWays(vertex);

      if (parents.length < 2) {     // vertex is no longer a key vertex
        if (vertexIDs.includes(vertexID)) {
          vertexIDs.splice(vertexIDs.indexOf(vertexID), 1);   // stop checking this one
        }
        removeVertexIDs.push(vertexID);
        keepGoing = true;
      }

      if (parents.length < 1) {     // vertex is no longer attached to anything
        vgraph.remove(vertex);
      }
    }
  } while (keepGoing);

  vgraph = vgraph.commit();
  vertices = vertices
    .filter(vertex => !removeVertexIDs.includes(vertex.id))
    .map(vertex => vgraph.entity(vertex.id) as OsmNode);
  ways = ways
    .filter(way => !removeWayIDs.includes(way.id))
    .map(way => vgraph.entity(way.id) as OsmWay);


  // OK!  Here is our intersection..
  const intersection: Intersection = {
    graph: vgraph,
    actions: actions,
    vertices: vertices,
    ways: ways,

    // Get all the valid turns through this intersection given a starting way id.
    // This operates on the virtual graph for everything.
    //
    // Basically, walk through all possible paths from starting way,
    //   honoring the existing turn restrictions as we go (watch out for loops!)
    //
    // For each path found, generate and return a `osmTurn` datastructure.
    //
    turns: function(fromWayID: EntityID, maxViaWay: number = 0): Turn[] {
      if (!fromWayID) return [];

      const vgraph = intersection.graph;
      const keyvertexIDs = intersection.vertices.map(v => v.id);

      const start = vgraph.entity(fromWayID) as OsmWay;
      if (!start || !(start.props.__from || start.props.__via)) return [];

      // maxViaWay=0   from-*-to              (0 vias)
      // maxViaWay=1   from-*-via-*-to        (1 via max)
      // maxViaWay=2   from-*-via-*-via-*-to  (2 vias max)
      const maxPathLength = (maxViaWay * 2) + 3;
      const turns: osmTurn[] = [];

      step(start);
      return turns;


      // Internal type for matched restrictions
      interface MatchedRestriction {
        id: string;
        direct: boolean;
        from: EntityID;
        no: boolean;
        only: boolean;
        end: boolean;
      }

      // traverse the intersection graph and find all the valid paths
      function step(
        entity: OsmEntity,
        currPath?: EntityID[],
        currRestrictions?: OsmRelation[],
        matchedRestriction?: MatchedRestriction | false
      ): void {
        currPath = (currPath || []).slice();  // shallow copy
        if (currPath.length >= maxPathLength) return;
        currPath.push(entity.id);
        currRestrictions = (currRestrictions || []).slice();  // shallow copy

        if (entity.type === 'node') {
          const nodeParents = vgraph.parentWays(entity);
          const nextWays: Array<{ way: OsmWay; restrict: MatchedRestriction | undefined }> = [];

          // which ways can we step into?
          for (const way of nodeParents) {

            // if next way is a oneway incoming to this vertex, skip
            if (way.props.__oneWay && way.nodes[0] !== entity.id) continue;

            // if we have seen it before (allowing for an initial u-turn), skip
            if (currPath!.includes(way.id) && currPath!.length >= 3) continue;

            // Check all "current" restrictions (where we've already walked the `FROM`)
            let restrict: MatchedRestriction | undefined;
            for (const restriction of currRestrictions!) {
              const f = restriction.memberByRole('from');
              const v = restriction.membersByRole('via');
              const t = restriction.memberByRole('to');
              const isOnly = /^only_/.test(restriction.tags.restriction);

              // Skip if required members are missing
              if (!f || !t) continue;

              // Does the current path match this turn restriction?
              const matchesFrom = (f.id === fromWayID);
              let matchesViaTo = false;
              let isAlongOnlyPath = false;

              if (t.id === way.id) {     // match TO

                if (v.length === 1 && v[0].type === 'node') {    // match VIA node
                  matchesViaTo = (v[0].id === entity.id && (
                    (matchesFrom && currPath!.length === 2) ||
                    (!matchesFrom && currPath!.length > 2)
                  ));

                } else {                                         // match all VIA ways
                  const pathVias: EntityID[] = [];
                  for (let k = 2; k < currPath!.length; k += 2) {   // k = 2 skips FROM
                    pathVias.push(currPath![k]);              // (path goes way-node-way...)
                  }
                  const restrictionVias: EntityID[] = [];
                  for (const vMember of v) {
                    if (vMember.type === 'way') {
                      restrictionVias.push(vMember.id);
                    }
                  }
                  const diff = utilArrayDifference(pathVias, restrictionVias);
                  matchesViaTo = !diff.length;
                }

              } else if (isOnly) {
                for (const vMember of v) {
                  // way doesn't match TO, but is one of the via ways along the path of an "only"
                  if (vMember.type === 'way' && vMember.id === way.id) {
                    isAlongOnlyPath = true;
                    break;
                  }
                }
              }

              if (matchesViaTo) {
                if (isOnly) {
                  restrict = { id: restriction.id, direct: matchesFrom, from: f.id, no: false, only: true, end: true };
                } else {
                  restrict = { id: restriction.id, direct: matchesFrom, from: f.id, no: true, only: false, end: true };
                }
              } else {    // indirect - caused by a different nearby restriction
                if (isAlongOnlyPath) {
                  restrict = { id: restriction.id, direct: false, from: f.id, no: false, only: true, end: false };
                } else if (isOnly) {
                  restrict = { id: restriction.id, direct: false, from: f.id, no: true, only: false, end: true };
                }
              }

              // stop looking if we find a "direct" restriction (matching FROM, VIA, TO)
              if (restrict && restrict.direct) break;
            }

            nextWays.push({ way: way, restrict: restrict });
          }

          nextWays.forEach(function(nextWay) {
            step(nextWay.way, currPath, currRestrictions, nextWay.restrict);
          });


        } else {  // entity.type === 'way'
          if (currPath!.length >= 3) {     // this is a "complete" path..
            let turnPath = currPath!.slice();   // shallow copy

            // an indirect restriction - only include the partial path (starting at FROM)
            if (matchedRestriction && matchedRestriction.direct === false) {
              for (let i = 0; i < turnPath.length; i++) {
                if (turnPath[i] === matchedRestriction.from) {
                  turnPath = turnPath.slice(i);
                  break;
                }
              }
            }

            const turn = pathToTurn(turnPath);
            if (turn) {
              if (matchedRestriction) {
                turn.restrictionID = matchedRestriction.id;
                turn.no = matchedRestriction.no;
                turn.only = matchedRestriction.only;
                turn.direct = matchedRestriction.direct;
              }
              turns.push(new osmTurn(turn));
            }

            if (currPath![0] === currPath![2]) return;   // if we made a u-turn - stop here
          }

          if (matchedRestriction && matchedRestriction.end) return;  // don't advance any further

          // which nodes can we step into?
          const way = entity as OsmWay;
          const n1 = vgraph.hasEntity(way.first() || '') as OsmNode;
          if (!n1 || !n1.loc) return;
          const n2 = vgraph.hasEntity(way.last() || '') as OsmNode;
          if (!n2 || !n2.loc) return;

          const dist = geoSphericalDistance(n1.loc, n2.loc);
          const nextNodes: OsmNode[] = [];

          if (currPath!.length > 1) {
            if (dist > maxDistance) return;         // the next node is too far
            if (!way.props.__via) return;           // this way is a leaf / can't be a via
          }

          if (!way.props.__oneWay &&                // bidirectional..
              keyvertexIDs.includes(n1.id) &&        // key vertex..
              !currPath!.includes(n1.id)) {          // haven't seen it yet..
            nextNodes.push(n1);                     // can advance to first node
          }
          if (keyvertexIDs.includes(n2.id) &&        // key vertex..
              !currPath!.includes(n2.id)) {          // haven't seen it yet..
            nextNodes.push(n2);                     // can advance to last node
          }

          nextNodes.forEach(function(nextNode) {
            // gather restrictions FROM this way
            const fromRestrictions = vgraph.parentRelations(entity).filter(function(r: OsmRelation) {
              if (!r.isRestriction()) return false;

              const f = r.memberByRole('from');
              if (!f || f.id !== entity.id) return false;

              const isOnly = /^only_/.test(r.tags.restriction);
              if (!isOnly) return true;

              // `only_` restrictions only matter along the direction of the VIA - iD#4849
              let isOnlyVia = false;
              const vias = r.membersByRole('via');
              if (vias.length === 1 && vias[0].type === 'node') {   // via node
                isOnlyVia = (vias[0].id === nextNode.id);
              } else {                                        // via way(s)
                for (const via of vias) {
                  if (via.type !== 'way') continue;
                  const viaWay = vgraph.entity(via.id) as OsmWay;
                  if (viaWay.first() === nextNode.id || viaWay.last() === nextNode.id) {
                    isOnlyVia = true;
                    break;
                  }
                }
              }
              return isOnlyVia;
            });

            step(nextNode, currPath, currRestrictions!.concat(fromRestrictions), false);
          });
        }
      }


      // assumes path is alternating way-node-way of odd length
      function pathToTurn(path: EntityID[]): Turn | null {
        if (path.length < 3) return null;
        const fromWayID: EntityID = path[0];
        const toWayID: EntityID = path[path.length - 1];
        let fromNodeID: EntityID;
        let fromVertexID: EntityID;
        let toNodeID: EntityID;
        let toVertexID: EntityID;
        let viaWayIDs: EntityID[] | undefined;
        let viaNodeID: EntityID | undefined;
        let isUturn: boolean;

        if (path.length === 3 && fromWayID === toWayID) {  // u turn
          const way = vgraph.entity(fromWayID) as OsmWay;
          if (way.props.__oneWay) return null;

          isUturn = true;
          viaNodeID = fromVertexID = toVertexID = path[1];
          fromNodeID = toNodeID = adjacentNode(fromWayID, viaNodeID);

        } else {
          isUturn = false;
          fromVertexID = path[1];
          fromNodeID = adjacentNode(fromWayID, fromVertexID);
          toVertexID = path[path.length - 2];
          toNodeID = adjacentNode(toWayID, toVertexID);

          if (path.length === 3) {
            viaNodeID = path[1];
          } else {
            viaWayIDs = path.filter(entityId => entityId[0] === 'w');
            viaWayIDs = viaWayIDs.slice(1, viaWayIDs.length - 1);  // remove first, last
          }
        }

        return {
          key:  path.join('_'),
          path: path,
          from: { node: fromNodeID, way:  fromWayID, vertex: fromVertexID },
          via:  { node: viaNodeID,  ways: viaWayIDs },
          to:   { node: toNodeID,   way:  toWayID, vertex: toVertexID },
          u:    isUturn
        };


        function adjacentNode(wayID: EntityID, affixId: EntityID): EntityID {
          const nodes = (vgraph.entity(wayID) as OsmWay).nodes;
          return affixId === nodes[0] ? nodes[1] : nodes[nodes.length - 2];
        }
      }
    }
  };

  return intersection;
}


export function osmInferRestriction(graph: Graph, turn: Turn): string {
  const fromWay = graph.entity(turn.from.way) as OsmWay;
  const fromNode = graph.entity(turn.from.node) as OsmNode;
  const fromVertex = graph.entity(turn.from.vertex) as OsmNode;
  const toWay = graph.entity(turn.to.way) as OsmWay;
  const toNode = graph.entity(turn.to.node) as OsmNode;
  const toVertex = graph.entity(turn.to.vertex) as OsmNode;

  const fromOneWay = (fromWay.tags.oneway === 'yes');
  const toOneWay = (toWay.tags.oneway === 'yes');

  let angle = (
    vecAngle(fromVertex.geoms.parts[0]!.world!.coords as Vec2, fromNode.geoms.parts[0]!.world!.coords as Vec2) -
    vecAngle(toVertex.geoms.parts[0]!.world!.coords as Vec2, toNode.geoms.parts[0]!.world!.coords as Vec2)
  ) * RAD2DEG;

  while (angle < 0) {
    angle += 360;
  }

  if (fromNode === toNode) {
    return 'no_u_turn';
  }
  if ((angle < 23 || angle > 336) && fromOneWay && toOneWay) {
    return 'no_u_turn';   // wider tolerance for u-turn if both ways are oneway
  }
  if ((angle < 40 || angle > 319) && fromOneWay && toOneWay && turn.from.vertex !== turn.to.vertex) {
    return 'no_u_turn';   // even wider tolerance for u-turn if there is a via way (from !== to)
  }
  if (angle < 158) {
    return 'no_right_turn';
  }
  if (angle > 202) {
    return 'no_left_turn';
  }

  return 'no_straight_on';
}
