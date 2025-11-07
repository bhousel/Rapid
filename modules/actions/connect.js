import { utilArrayUniq } from '@rapid-sdk/util';

import { actionDeleteNode } from './delete_node.js';
import { actionDeleteWay } from './delete_way.js';


// Connect the ways at the given nodes.
//
// First choose a node to be the survivor, with preference given to an existing (not new) node.
// Tags and relation memberships of of non-surviving nodes are merged to the survivor.
//
// This is the inverse of `actionDisconnect`.
//
export function actionConnect(nodeIDs) {
  const action = (graph) => {
    let survivor;

    // Choose a survivor node, prefer an existing (not new) node - iD#4974
    for (const nodeID of nodeIDs) {
      survivor = graph.entity(nodeID);
      if (survivor.version) break;  // found one
    }

    // Replace all non-surviving nodes with the survivor and merge tags.
    for (const nodeID of nodeIDs) {
      if (nodeID === survivor.id) continue;
      const node = graph.entity(nodeID);

      for (const parentWay of graph.parentWays(node)) {
        graph.replace(parentWay.replaceNode(nodeID, survivor.id));
      }

      for (const parentRel of graph.parentRelations(node)) {
        graph.replace(parentRel.replaceMember(node, survivor));
      }

      survivor = survivor.mergeTags(node.tags);
      graph = actionDeleteNode(nodeID)(graph);
    }

    graph.replace(survivor);

    // find and delete any degenerate ways created by connecting adjacent vertices
    for (const parentWay of graph.parentWays(survivor)) {
      if (parentWay.isDegenerate()) {
        graph = actionDeleteWay(parentWay.id)(graph);
      }
    }

    return graph.commit();
  };


  action.disabled = (graph) => {
    let seen = {};
    const restrictionIDs = new Set();
    let survivor;

    // Choose a survivor node, prefer an existing (not new) node - iD#4974
    for (const nodeID of nodeIDs) {
      survivor = graph.entity(nodeID);
      if (survivor.version) break;  // found one
    }

    // 1. disable if the nodes being connected have conflicting relation roles
    for (const nodeID of nodeIDs) {
      const node = graph.entity(nodeID);

      for (const relation of graph.parentRelations(node)) {
        const relationID = relation.id;
        const role = relation.memberById(nodeID).role || '';

        // if this node is a via node in a restriction, remember for later
        if (relation.hasFromViaTo()) {
          restrictionIDs.add(relationID);
        }

        if (seen[relationID] !== undefined && seen[relationID] !== role) {
          return 'relation';
        } else {
          seen[relationID] = role;
        }
      }
    }

    // gather restrictions for parent ways
    for (const nodeID of nodeIDs) {
      const node = graph.entity(nodeID);

      for (const parentWay of graph.parentWays(node)) {
        for (const parentRelation of graph.parentRelations(parentWay)) {
          if (parentRelation.hasFromViaTo()) {
            restrictionIDs.add(parentRelation.id);
          }
        }
      }
    }

    // test restrictions
    for (const restrictionID of restrictionIDs) {
      const relation = graph.entity(restrictionID);
      if (!relation.isComplete(graph)) continue;

      let memberWays = relation.members
        .filter(m => m.type === 'way')
        .map(m => graph.entity(m.id));

      memberWays = utilArrayUniq(memberWays);
      const f = relation.memberByRole('from');
      const t = relation.memberByRole('to');
      const isUturn = (f.id === t.id);

      // 2a. disable if connection would damage a restriction
      // (a key node is a node at the junction of ways)
      const nodes = { from: [], via: [], to: [], keyfrom: [], keyto: [] };
      for (const member of relation.members) {
        collectNodes(member, nodes);
      }

      nodes.keyfrom = utilArrayUniq(nodes.keyfrom.filter(hasDuplicates));
      nodes.keyto = utilArrayUniq(nodes.keyto.filter(hasDuplicates));

      const filter = keyNodeFilter(nodes.keyfrom, nodes.keyto);
      nodes.from = nodes.from.filter(filter);
      nodes.via = nodes.via.filter(filter);
      nodes.to = nodes.to.filter(filter);

      let connectFrom = false;
      let connectVia = false;
      let connectTo = false;
      let connectKeyFrom = false;
      let connectKeyTo = false;

      for (const n of nodeIDs) {
        if (nodes.from.indexOf(n) !== -1)    { connectFrom = true; }
        if (nodes.via.indexOf(n) !== -1)     { connectVia = true; }
        if (nodes.to.indexOf(n) !== -1)      { connectTo = true; }
        if (nodes.keyfrom.indexOf(n) !== -1) { connectKeyFrom = true; }
        if (nodes.keyto.indexOf(n) !== -1)   { connectKeyTo = true; }
      }
      if (connectFrom && connectTo && !isUturn) { return 'restriction'; }
      if (connectFrom && connectVia) { return 'restriction'; }
      if (connectTo   && connectVia) { return 'restriction'; }

      // connecting to a key node -
      // if both nodes are on a member way (i.e. part of the turn restriction),
      // the connecting node must be adjacent to the key node.
      if (connectKeyFrom || connectKeyTo) {
        if (nodeIDs.length !== 2) { return 'restriction'; }

        let n0 = null;
        let n1 = null;
        for (const way of memberWays) {
          if (way.contains(nodeIDs[0])) { n0 = nodeIDs[0]; }
          if (way.contains(nodeIDs[1])) { n1 = nodeIDs[1]; }
        }

        if (n0 && n1) {    // both nodes are part of the restriction
          let ok = false;
          for (const way of memberWays) {
            if (way.isAdjacent(n0, n1)) {
              ok = true;
              break;
            }
          }
          if (!ok) {
            return 'restriction';
          }
        }
      }

      // 2b. disable if nodes being connected will destroy a member way in a restriction
      // (to test, make a copy and try actually connecting the nodes)
      for (const w of memberWays) {
        let way = w.update({});   // make copy
        for (const nodeID of nodeIDs) {
          if (nodeID === survivor.id) continue;

          if (way.isAdjacent(nodeID, survivor.id)) {
            way = way.removeNode(nodeID);
          } else {
            way = way.replaceNode(nodeID, survivor.id);
          }
        }
        if (way.isDegenerate()) {
          return 'restriction';
        }
      }
    }

    return false;


    // if a key node appears multiple times (indexOf !== lastIndexOf) it's a FROM-VIA or TO-VIA junction
    function hasDuplicates(n, i, arr) {
      return arr.indexOf(n) !== arr.lastIndexOf(n);
    }

    function keyNodeFilter(froms, tos) {
      return function(n) {
        return froms.indexOf(n) === -1 && tos.indexOf(n) === -1;
      };
    }

    function collectNodes(member, collection) {
      const entity = graph.hasEntity(member.id);
      if (!entity) return;

      const role = member.role || '';
      if (!collection[role]) {
        collection[role] = [];
      }

      if (member.type === 'node') {
        collection[role].push(member.id);
        if (role === 'via') {
          collection.keyfrom.push(member.id);
          collection.keyto.push(member.id);
        }

      } else if (member.type === 'way') {
        collection[role].push.apply(collection[role], entity.nodes);
        if (role === 'from' || role === 'via') {
          collection.keyfrom.push(entity.first());
          collection.keyfrom.push(entity.last());
        }
        if (role === 'to' || role === 'via') {
          collection.keyto.push(entity.first());
          collection.keyto.push(entity.last());
        }
      }
    }
  };


  return action;
}
