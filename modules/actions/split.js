import { geoSphericalDistance, numWrap } from '@rapid-sdk/math';
import { utilArrayIntersection, utilArrayUniq } from '@rapid-sdk/util';

import { actionAddMember } from './add_member.js';
import { osmIsOldMultipolygonOuterMember } from '../data/lib/multipolygon.js';
import { OsmRelation } from '../data/OsmRelation.js';
import { OsmWay } from '../data/OsmWay.js';


// Split a way at the given node.
//
// Optionally, split only the given ways, if multiple ways share the given node.
//
// For testing convenience, accepts `newWayIDs` to assign to the new ways.
// (Normally, new entities are automatically assigned the next available number).
//
// This is the inverse of `actionJoin`.
//
export function actionSplit(nodeIDs, newWayIDs) {
  // accept single ID for backwards-compatibility
  if (typeof nodeIDs === 'string') nodeIDs = [nodeIDs];

  let _wayIDs;
  // the strategy for picking which way will have a new version and which way is newly created
  let _keepHistoryOn = 'longest'; // 'longest', 'first'

  // The IDs of the ways actually created by running this action
  let _createdWayIDs = [];

  function dist(graph, nA, nB) {
    const locA = graph.entity(nA).loc;
    const locB = graph.entity(nB).loc;
    const epsilon = 1e-6;
    return (locA && locB) ? geoSphericalDistance(locA, locB) : epsilon;
  }

  // If the way is closed, we need to search for a partner node
  // to split the way at.
  //
  // The following looks for a node that is both far away from
  // the initial node in terms of way segment length and nearby
  // in terms of beeline-distance. This assures that areas get
  // split on the most "natural" points (independent of the number
  // of nodes).
  // For example: bone-shaped areas get split across their waist
  // line, circles across the diameter.
  function splitArea(nodes, idxA, graph) {
    let lengths = new Array(nodes.length);
    let length;
    let i;
    let best = 0;
    let idxB;

    function wrap(index) {
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
      var cost = lengths[i] / dist(graph, nodes[idxA], nodes[i]);
      if (cost > best) {
        idxB = i;
        best = cost;
      }
    }

    return idxB;
  }


  function totalLengthBetweenNodes(graph, nodes) {
    let totalLength = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      totalLength += dist(graph, nodes[i], nodes[i + 1]);
    }
    return totalLength;
  }


  function split(graph, nodeID, wayA, newWayId) {
    let wayB = new OsmWay(wayA.context, { id: newWayId, tags: wayA.tags });   // `wayB` is the NEW way
    let origNodes = wayA.nodes.slice();
    let nodesA;
    let nodesB;
    let isArea = wayA.isArea();
    let isOuter = osmIsOldMultipolygonOuterMember(wayA, graph);

    if (wayA.isClosed()) {
      const nodes = wayA.nodes.slice(0, -1);
      const idxA = nodes.indexOf(nodeID);
      const idxB = splitArea(nodes, idxA, graph);
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

      let temp = lengthA;
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
        const tagsA = Object.assign({}, wayA.tags);  // copy
        const tagsB = Object.assign({}, wayB.tags);  // copy

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

    for (let relation of graph.parentRelations(wayA)) {
      var member;

      // Turn restrictions - make sure:
      // 1. Splitting a FROM/TO way - only `wayA` OR `wayB` remains in relation
      //    (whichever one is connected to the VIA node/ways)
      // 2. Splitting a VIA way - `wayB` remains in relation as a VIA way
      if (relation.hasFromViaTo()) {
        const f = relation.memberByRole('from');
        const v = relation.membersByRole('via');
        const t = relation.memberByRole('to');

        // 1. split a FROM/TO
        if (f.id === wayA.id || t.id === wayA.id) {
          let keepB = false;
          if (v.length === 1 && v[0].type === 'node') {   // check via node
            keepB = wayB.contains(v[0].id);
          } else {                                        // check via way(s)
            for (const via of v) {
              if (via.type !== 'way') continue;
              const wayV = graph.hasEntity(via.id);
              if (wayV && utilArrayIntersection(wayB.nodes, wayV.nodes).length) {
                keepB = true;
                break;
              }
            }
          }

          if (keepB) {
            relation = relation.replaceMember(wayA, wayB);
            graph.replace(relation);
          }

        // 2. split a VIA
        } else {
          for (const via of v) {
            if (via.type === 'way' && via.id === wayA.id) {
              member = { id: wayB.id, type: 'way', role: 'via' };
              graph = actionAddMember(relation.id, member, via.index + 1)(graph);
              break;
            }
          }
        }

      // All other relations (Routes, Multipolygons, etc):
      // 1. Both `wayA` and `wayB` remain in the relation
      // 2. But must be inserted as a pair (see `actionAddMember` for details)
      } else {
        if (relation === isOuter) {
          graph.replace(relation.mergeTags(wayA.tags));
          graph.replace(wayA.update({ tags: {} }));
          graph.replace(wayB.update({ tags: {} }));
        }

        member = { id: wayB.id, type: 'way', role: relation.memberById(wayA.id).role };
        const insertPair = { originalID: wayA.id, insertedID: wayB.id, nodes: origNodes };
        graph = actionAddMember(relation.id, member, undefined, insertPair)(graph);
      }
    }

    if (!isOuter && isArea) {
      const multipolygon = new OsmRelation(wayA.context, {
        tags: Object.assign({}, wayA.tags, { type: 'multipolygon' }),
        members: [
          { id: wayA.id, role: 'outer', type: 'way' },
          { id: wayB.id, role: 'outer', type: 'way' }
        ]
      });

      graph.replace(multipolygon);
      graph.replace(wayA.update({ tags: {} }));
      graph.replace(wayB.update({ tags: {} }));
    }

    _createdWayIDs.push(wayB.id);

    return graph.commit();
  }


  const action = graph => {
    _createdWayIDs = [];
    let newWayIndex = 0;
    for (const nodeID of nodeIDs) {
      const candidates = action.waysForNode(nodeID, graph);
      for (const candidate of candidates) {
        graph = split(graph, nodeID, candidate, newWayIDs && newWayIDs[newWayIndex]);
        newWayIndex += 1;
      }
    }

    return graph;
  };


  action.getCreatedWayIDs = function() {
    return _createdWayIDs;
  };


  action.waysForNode = function(nodeID, graph) {
    const node = graph.entity(nodeID);
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

    function isSplittable(parent) {
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


  action.ways = function(graph) {
    return utilArrayUniq([].concat.apply([], nodeIDs.map(nodeID => action.waysForNode(nodeID, graph))));
  };


  action.disabled = function(graph) {
    for (const nodeID of nodeIDs) {
      const candidates = action.waysForNode(nodeID, graph);
      if (candidates.length === 0 || (_wayIDs && _wayIDs.length !== candidates.length)) {
        return 'not_eligible';
      }
    }
  };


  action.limitWays = function(val) {
    if (!arguments.length) return _wayIDs;
    _wayIDs = val;
    return action;
  };


  action.keepHistoryOn = function(val) {
    if (!arguments.length) return _keepHistoryOn;
    _keepHistoryOn = val;
    return action;
  };


  return action;
}
