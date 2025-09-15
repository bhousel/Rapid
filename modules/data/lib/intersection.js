import { RAD2DEG, geoSphericalDistance, vecAngle } from '@rapid-sdk/math';
import { utilArrayDifference, utilArrayUniq } from '@rapid-sdk/util';

import { actionDeleteRelation } from '../../actions/delete_relation.js';
import { actionReverse } from '../../actions/reverse.js';
import { actionSplit } from '../../actions/split.js';
import { Graph } from './Graph.js';


export function osmTurn(turn) {
  if (!(this instanceof osmTurn)) {
    return new osmTurn(turn);
  }
  Object.assign(this, turn);
}


export function osmIntersection(context, graph, startvertexID, maxDistance) {
  maxDistance = maxDistance || 30;    // in meters


  function memberOfRestriction(entity) {
    return graph.parentRelations(entity).some(r => r.isRestriction());
  }

  function isRoad(way) {
    if (way.isArea() || way.isDegenerate()) return false;
    const roads = {
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
    return roads[way.tags.highway];
  }


  let startNode = graph.entity(startvertexID);
  let checkVertices = [startNode];
  let vertices = [];
  let ways = [];
  let parents = [];

  // `actions` will store whatever actions must be performed to satisfy
  // preconditions for adding a turn restriction to this intersection.
  //  - Remove any existing degenerate turn restrictions (missing from/to, etc)
  //  - Reverse oneways so that they are drawn in the forward direction
  //  - Split ways on key vertices
  let actions = [];


  // STEP 1:  walk the graph outwards from starting vertex to search
  //  for more key vertices and ways to include in the intersection..
  while (checkVertices.length) {
    const vertex = checkVertices.pop();

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
        if (node === vertex) continue;                                               // same thing
        if (vertices.includes(node)) continue;                                       // seen it already
        if (geoSphericalDistance(node.loc, startNode.loc) > maxDistance) continue;   // too far from start

        // a key vertex will have parents that are also roads
        let hasParents = false;
        const parents = graph.parentWays(node);
        for (const parent of parents) {
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
  let vbase = new Graph(context);
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
      if (relation.isValidRestriction(graph)) {
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
    const splitAll = actionSplit([v.id]).keepHistoryOn('first');
    if (!splitAll.disabled(vgraph)) {
      for (const way of splitAll.ways(vgraph)) {
        const splitOne = actionSplit([v.id]).limitWays([way.id]).keepHistoryOn('first');
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
  let vertexIDs = vertices.map(v => v.id);
  let wayIDs;
  vertices = [];
  ways = [];

  for (const vertexID of vertexIDs) {
    const vertex = vgraph.entity(vertexID);
    const parents = vgraph.parentWays(vertex);
    vertices.push(vertex);
    ways = ways.concat(parents);
  }

  vertices = utilArrayUniq(vertices);
  ways = utilArrayUniq(ways);

  vertexIDs = vertices.map(v => v.id);
  wayIDs = ways.map(w => w.id);


  // STEP 6:  Update the ways with some metadata that will be useful for
  // walking the intersection graph later and rendering turn arrows.

  function withMetadata(way, vertexIDs) {
    const __oneWay = way.isOneWay();

    // which affixes are key vertices?
    const __first = (vertexIDs.indexOf(way.first()) !== -1);
    const __last = (vertexIDs.indexOf(way.last()) !== -1);

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
    const way = withMetadata(vgraph.entity(wayID), vertexIDs);
    vgraph.replace(way);
    ways.push(way);
  }


  // STEP 7:  Simplify - This is an iterative process where we:
  //  1. Find trivial vertices with only 2 parents
  //  2. trim off the leaf way from those vertices and remove from vgraph

  let keepGoing;
  let removeWayIDs = [];
  let removeVertexIDs = [];

  do {
    keepGoing = false;
    checkVertices = vertexIDs.slice();

    for (const vertexID of checkVertices) {
      const vertex = vgraph.hasEntity(vertexID);

      if (!vertex) {
        if (vertexIDs.indexOf(vertexID) !== -1) {
          vertexIDs.splice(vertexIDs.indexOf(vertexID), 1);   // stop checking this one
        }
        removeVertexIDs.push(vertexID);
        continue;
      }

      parents = vgraph.parentWays(vertex);
      if (parents.length < 3) {
        if (vertexIDs.indexOf(vertexID) !== -1) {
          vertexIDs.splice(vertexIDs.indexOf(vertexID), 1);   // stop checking this one
        }
      }

      if (parents.length === 2) {     // vertex with 2 parents is trivial
        const a = parents[0];
        const b = parents[1];
        const aIsLeaf = a && !a.props.__via;
        const bIsLeaf = b && !b.props.__via;
        let leaf, survivor;

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
        if (vertexIDs.indexOf(vertexID) !== -1) {
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
    .filter(vertex => removeVertexIDs.indexOf(vertex.id) === -1)
    .map(vertex => vgraph.entity(vertex.id));
  ways = ways
    .filter(way => removeWayIDs.indexOf(way.id) === -1)
    .map(way => vgraph.entity(way.id));


  // OK!  Here is our intersection..
  const intersection = {
    graph: vgraph,
    actions: actions,
    vertices: vertices,
    ways: ways
  };



  // Get all the valid turns through this intersection given a starting way id.
  // This operates on the virtual graph for everything.
  //
  // Basically, walk through all possible paths from starting way,
  //   honoring the existing turn restrictions as we go (watch out for loops!)
  //
  // For each path found, generate and return a `osmTurn` datastructure.
  //
  intersection.turns = function(fromWayID, maxViaWay) {
      if (!fromWayID) return [];
      if (!maxViaWay) maxViaWay = 0;

      var vgraph = intersection.graph;
      var keyvertexIDs = intersection.vertices.map(function(v) { return v.id; });

      var start = vgraph.entity(fromWayID);
      if (!start || !(start.props.__from || start.props.__via)) return [];

      // maxViaWay=0   from-*-to              (0 vias)
      // maxViaWay=1   from-*-via-*-to        (1 via max)
      // maxViaWay=2   from-*-via-*-via-*-to  (2 vias max)
      var maxPathLength = (maxViaWay * 2) + 3;
      var turns = [];

      step(start);
      return turns;


      // traverse the intersection graph and find all the valid paths
      function step(entity, currPath, currRestrictions, matchedRestriction) {
          currPath = (currPath || []).slice();  // shallow copy
          if (currPath.length >= maxPathLength) return;
          currPath.push(entity.id);
          currRestrictions = (currRestrictions || []).slice();  // shallow copy
          var i, j, k;

          if (entity.type === 'node') {
              var parents = vgraph.parentWays(entity);
              var nextWays = [];

              // which ways can we step into?
              for (i = 0; i < parents.length; i++) {
                  var way = parents[i];

                  // if next way is a oneway incoming to this vertex, skip
                  if (way.props.__oneWay && way.nodes[0] !== entity.id) continue;

                  // if we have seen it before (allowing for an initial u-turn), skip
                  if (currPath.indexOf(way.id) !== -1 && currPath.length >= 3) continue;

                  // Check all "current" restrictions (where we've already walked the `FROM`)
                  var restrict = null;
                  for (j = 0; j < currRestrictions.length; j++) {
                      var restriction = currRestrictions[j];
                      var f = restriction.memberByRole('from');
                      var v = restriction.membersByRole('via');
                      var t = restriction.memberByRole('to');
                      var isOnly = /^only_/.test(restriction.tags.restriction);

                      // Does the current path match this turn restriction?
                      var matchesFrom = (f.id === fromWayID);
                      var matchesViaTo = false;
                      var isAlongOnlyPath = false;

                      if (t.id === way.id) {     // match TO

                          if (v.length === 1 && v[0].type === 'node') {    // match VIA node
                              matchesViaTo = (v[0].id === entity.id && (
                                  (matchesFrom && currPath.length === 2) ||
                                  (!matchesFrom && currPath.length > 2)
                              ));

                          } else {                                         // match all VIA ways
                              var pathVias = [];
                              for (k = 2; k < currPath.length; k +=2 ) {   // k = 2 skips FROM
                                  pathVias.push(currPath[k]);              // (path goes way-node-way...)
                              }
                              var restrictionVias = [];
                              for (k = 0; k < v.length; k++) {
                                  if (v[k].type === 'way') {
                                      restrictionVias.push(v[k].id);
                                  }
                              }
                              var diff = utilArrayDifference(pathVias, restrictionVias);
                              matchesViaTo = !diff.length;
                          }

                      } else if (isOnly) {
                          for (k = 0; k < v.length; k++) {
                              // way doesn't match TO, but is one of the via ways along the path of an "only"
                              if (v[k].type === 'way' && v[k].id === way.id) {
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
              if (currPath.length >= 3) {     // this is a "complete" path..
                  var turnPath = currPath.slice();   // shallow copy

                  // an indirect restriction - only include the partial path (starting at FROM)
                  if (matchedRestriction && matchedRestriction.direct === false) {
                      for (i = 0; i < turnPath.length; i++) {
                          if (turnPath[i] === matchedRestriction.from) {
                              turnPath = turnPath.slice(i);
                              break;
                          }
                      }
                  }

                  var turn = pathToTurn(turnPath);
                  if (turn) {
                      if (matchedRestriction) {
                          turn.restrictionID = matchedRestriction.id;
                          turn.no = matchedRestriction.no;
                          turn.only = matchedRestriction.only;
                          turn.direct = matchedRestriction.direct;
                      }
                      turns.push(osmTurn(turn));
                  }

                  if (currPath[0] === currPath[2]) return;   // if we made a u-turn - stop here
              }

              if (matchedRestriction && matchedRestriction.end) return;  // don't advance any further

              // which nodes can we step into?
              var n1 = vgraph.entity(entity.first());
              var n2 = vgraph.entity(entity.last());
              var dist = geoSphericalDistance(n1.loc, n2.loc);
              var nextNodes = [];

              if (currPath.length > 1) {
                  if (dist > maxDistance) return;         // the next node is too far
                  if (!entity.props.__via) return;        // this way is a leaf / can't be a via
              }

              if (!entity.props.__oneWay &&               // bidirectional..
                  keyvertexIDs.indexOf(n1.id) !== -1 &&   // key vertex..
                  currPath.indexOf(n1.id) === -1) {       // haven't seen it yet..
                  nextNodes.push(n1);                     // can advance to first node
              }
              if (keyvertexIDs.indexOf(n2.id) !== -1 &&   // key vertex..
                  currPath.indexOf(n2.id) === -1) {       // haven't seen it yet..
                  nextNodes.push(n2);                     // can advance to last node
              }

              nextNodes.forEach(function(nextNode) {
                  // gather restrictions FROM this way
                  var fromRestrictions = vgraph.parentRelations(entity).filter(function(r) {
                      if (!r.isRestriction()) return false;

                      var f = r.memberByRole('from');
                      if (!f || f.id !== entity.id) return false;

                      var isOnly = /^only_/.test(r.tags.restriction);
                      if (!isOnly) return true;

                      // `only_` restrictions only matter along the direction of the VIA - #4849
                      var isOnlyVia = false;
                      var v = r.membersByRole('via');
                      if (v.length === 1 && v[0].type === 'node') {   // via node
                          isOnlyVia = (v[0].id === nextNode.id);
                      } else {                                        // via way(s)
                          for (var i = 0; i < v.length; i++) {
                              if (v[i].type !== 'way') continue;
                              var viaWay = vgraph.entity(v[i].id);
                              if (viaWay.first() === nextNode.id || viaWay.last() === nextNode.id) {
                                  isOnlyVia = true;
                                  break;
                              }
                          }
                      }
                      return isOnlyVia;
                  });

                  step(nextNode, currPath, currRestrictions.concat(fromRestrictions), false);
              });
          }
      }


      // assumes path is alternating way-node-way of odd length
      function pathToTurn(path) {
          if (path.length < 3) return;
          var fromWayID, fromNodeID, fromVertexID;
          var toWayID, toNodeID, toVertexID;
          var viaWayIDs, viaNodeID, isUturn;

          fromWayID = path[0];
          toWayID = path[path.length - 1];

          if (path.length === 3 && fromWayID === toWayID) {  // u turn
              var way = vgraph.entity(fromWayID);
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
                  viaWayIDs = path.filter(function(entityId) { return entityId[0] === 'w'; });
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


          function adjacentNode(wayID, affixId) {
              var nodes = vgraph.entity(wayID).nodes;
              return affixId === nodes[0] ? nodes[1] : nodes[nodes.length - 2];
          }
      }

  };

  return intersection;
}


export function osmInferRestriction(graph, turn) {
  const fromWay = graph.entity(turn.from.way);
  const fromNode = graph.entity(turn.from.node);
  const fromVertex = graph.entity(turn.from.vertex);
  const toWay = graph.entity(turn.to.way);
  const toNode = graph.entity(turn.to.node);
  const toVertex = graph.entity(turn.to.vertex);

  const fromOneWay = (fromWay.tags.oneway === 'yes');
  const toOneWay = (toWay.tags.oneway === 'yes');

  let angle = (
    vecAngle(fromVertex.geoms.parts[0].world.coords, fromNode.geoms.parts[0].world.coords) -
    vecAngle(toVertex.geoms.parts[0].world.coords, toNode.geoms.parts[0].world.coords)
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
