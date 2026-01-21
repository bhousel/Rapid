import { actionDeleteNode } from './delete_node.ts';
import { actionDeleteWay } from './delete_way.ts';
import { utilArrayUniq } from '@rapid-sdk/util';

import type { Action } from './types.ts';
import type { EntityType } from '../data/types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmNode } from '../data/OsmNode.ts';
import type { OsmRelation, OsmRelationMember } from '../data/OsmRelation.ts';
import type { OsmWay } from '../data/OsmWay.ts';


/**
 * actionConnect
 * Connects the ways at the given nodes.
 *
 * First choose a node to be the survivor, with preference given to an existing (not new) node.
 * Tags and relation memberships of non-surviving nodes are merged to the survivor.
 *
 * This is the inverse of `actionDisconnect`.
 *
 * @param   nodeIDs  - Array of EntityIDs of nodes to connect
 * @return  An Action that connects the nodes
 */
export function actionConnect(nodeIDs: EntityID[]): Action {
  const action = ((graph: Graph): Graph => {
    if (!nodeIDs.length) return graph;

    // Choose a survivor node, prefer an existing (not new) node - iD#4974
    // If none have a version, the last node becomes the survivor.
    let survivor = graph.entity(nodeIDs[0]) as OsmNode;
    for (const nodeID of nodeIDs) {
      survivor = graph.entity(nodeID) as OsmNode;
      if (survivor.version) break;  // found one
    }

    // Replace all non-surviving nodes with the survivor and merge tags.
    for (const nodeID of nodeIDs) {
      if (nodeID === survivor.id) continue;
      const node = graph.entity(nodeID) as OsmNode;

      for (const parentWay of graph.parentWays(node)) {
        graph.replace(parentWay.replaceNode(nodeID, survivor.id));
      }

      for (const parentRel of graph.parentRelations(node)) {
        graph.replace(parentRel.replaceMember(node, { id: survivor.id, type: survivor.type as EntityType }));
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
  }) as Action;


  action.disabled = (graph: Graph): string | false => {
    if (!nodeIDs.length) return false;

    const seen: Record<EntityID, string> = {};
    const restrictionIDs = new Set<EntityID>();

    // Choose a survivor node, prefer an existing (not new) node - iD#4974
    // If none have a version, the last node becomes the survivor.
    let survivor = graph.entity(nodeIDs[0]) as OsmNode;
    for (const nodeID of nodeIDs) {
      survivor = graph.entity(nodeID) as OsmNode;
      if (survivor.version) break;  // found one
    }

    // 1. disable if the nodes being connected have conflicting relation roles
    for (const nodeID of nodeIDs) {
      const node = graph.entity(nodeID) as OsmNode;

      for (const relation of graph.parentRelations(node)) {
        const relationID = relation.id;
        const role = relation.memberById(nodeID)?.role || '';

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
      const node = graph.entity(nodeID) as OsmNode;

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
      const relation = graph.entity(restrictionID) as OsmRelation;
      if (!relation.isComplete(graph)) continue;

      let memberWays = relation.members
        .filter((m: OsmRelationMember) => m.type === 'way')
        .map((m: OsmRelationMember) => graph.entity(m.id)) as OsmWay[];

      memberWays = utilArrayUniq(memberWays);
      const f = relation.memberByRole('from');
      const t = relation.memberByRole('to');
      const isUturn = (f?.id === t?.id);

      // 2a. disable if connection would damage a restriction
      // (a key node is a node at the junction of ways)
      const nodes: Record<string, EntityID[]> = { from: [], via: [], to: [], keyfrom: [], keyto: [] };
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

        let n0: EntityID | null = null;
        let n1: EntityID | null = null;
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
    function hasDuplicates(n: EntityID, i: number, arr: EntityID[]): boolean {
      return arr.indexOf(n) !== arr.lastIndexOf(n);
    }

    function keyNodeFilter(froms: EntityID[], tos: EntityID[]): (n: EntityID) => boolean {
      return function(n: EntityID): boolean {
        return froms.indexOf(n) === -1 && tos.indexOf(n) === -1;
      };
    }

    function collectNodes(member: OsmRelationMember, collection: Record<string, EntityID[]>): void {
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
        const wayEntity = entity as OsmWay;
        collection[role].push(...wayEntity.nodes);
        if (role === 'from' || role === 'via') {
          collection.keyfrom.push(wayEntity.first()!);
          collection.keyfrom.push(wayEntity.last()!);
        }
        if (role === 'to' || role === 'via') {
          collection.keyto.push(wayEntity.first()!);
          collection.keyto.push(wayEntity.last()!);
        }
      }
    }
  };


  return action;
}
