import { vecInterp } from '@rapid-sdk/math';

import { OsmNode, OsmWay, OsmRelation } from '../models/index.js';


export function actionRapidAcceptFeature(entityID, extGraph) {

  return graph => {
    const seenRelations = new Map();    // Map<relationID, Relation>, avoid infinite recursion
    const extEntity = extGraph.entity(entityID);

    if (extEntity.type === 'node') {
      acceptNode(extEntity);
    } else if (extEntity.type === 'way') {
      acceptWay(extEntity);
    } else if (extEntity.type === 'relation') {
      acceptRelation(extEntity);
    }

    return graph.commit();


    // These functions each accept the external entities, returning the replacement
    // NOTE - these functions will update `graph` closure variable

    function acceptNode(extNode) {
      let node = new OsmNode(extNode);   // copy node before modifying
      removeMetadata(node);

      graph.replace(node);
      return node;
    }


    function acceptWay(extWay) {
      let way = new OsmWay(extWay);   // copy way before modifying
      removeMetadata(way);

      const nodes = [];
      for (const nodeID of way.nodes) {
        let node = new OsmNode(extGraph.entity(nodeID));   // copy node before modifying
        let conn = node.tags.conn && node.tags.conn.split(',');
        let dupeId = node.tags.dupe;
        removeMetadata(node);

        if (dupeId && graph.hasEntity(dupeId) && !locationChanged(graph.entity(dupeId).loc, node.loc)) {
          node = graph.entity(dupeId);   // keep original node with dupeId
//        } else if (graph.hasEntity(node.id) && locationChanged(graph.entity(node.id).loc, node.loc)) {
//          node = new OsmNode(node.context, { loc: node.loc });     // replace (unnecessary copy of node?)
        }

        if (conn && graph.hasEntity(conn[0])) {
          //conn=w316746574,n3229071295,n3229071273
          const targetWay = graph.hasEntity(conn[0]);
          const nodeA = graph.hasEntity(conn[1]);
          const nodeB = graph.hasEntity(conn[2]);

          if (targetWay && nodeA && nodeB) {
            const result = findConnectionPoint(graph, node, targetWay, nodeA, nodeB);
            if (result && !locationChanged(result.interpLoc, node.loc)) {
              node.loc = result.interpLoc;
              graph.replace(targetWay.addNode(node.id, result.insertIdx));
            }
          }
        }

        graph.replace(node);
        nodes.push(node.id);
      }

      way = way.update({ nodes: nodes });
      graph.replace(way);
      return way;
    }


    function acceptRelation(extRelation) {
      const seen = seenRelations.get(extRelation.id);
      if (seen) return seen;

      let relation = new OsmRelation(extRelation);  // copy relation before modifying
      removeMetadata(relation);

      const members = [];
      for (const member of relation.members) {
        const extEntity = extGraph.entity(member.id);
        let replacement;

        if (extEntity.type === 'node') {
          replacement = acceptNode(extEntity);
        } else if (extEntity.type === 'way') {
          replacement = acceptWay(extEntity);
        } else if (extEntity.type === 'relation') {
          replacement = acceptRelation(extEntity);
        }

        members.push(Object.assign(member, { id: replacement.id }));
      }

      relation = relation.update({ members: members });
      graph.replace(relation);
      seenRelations.set(extRelation.id, relation);  // don't create it again
      return relation;
    }
  };


  // Find the place to newNode on targetWay between nodeA and nodeB if it does
  // not alter the existing segment's angle much. There may be other nodes
  // between A and B from user edit or other automatic connections.
  function findConnectionPoint(graph, newNode, targetWay, nodeA, nodeB) {
    const sortByLon = Math.abs(nodeA.loc[0] - nodeB.loc[0]) > Math.abs(nodeA.loc[1] - nodeB.loc[1]);
    const sortFunc = sortByLon
      ? function(n1, n2) {
        return nodeA.loc[0] < nodeB.loc[0] ? n1.loc[0] - n2.loc[0] : n2.loc[0] - n1.loc[0];
      }
      : function(n1, n2) {
        return nodeA.loc[1] < nodeB.loc[1] ? n1.loc[1] - n2.loc[1] : n2.loc[1] - n1.loc[1];
      };

    const nidList = targetWay.nodes;
    const idxA = nidList.indexOf(nodeA.id);
    const idxB = nidList.indexOf(nodeB.id);

    // Invariants for finding the insert index below: A and B must be in the
    // node list, in order, and the sort function must also order A before B
    if (idxA === -1 || idxB === -1 || idxA >= idxB || sortFunc(nodeA, nodeB) >= 0) {
      return null;
    }

    let insertIdx = idxA + 1;  // index to insert immediately before
    while (insertIdx < idxB && sortFunc(newNode, graph.entity(nidList[insertIdx])) > 0) {
      insertIdx++;
    }

    // Find the interpolated point on the segment where insertion will not
    // alter the segment's angle.
    const locA = graph.entity(nidList[insertIdx - 1]).loc;
    const locB = graph.entity(nidList[insertIdx]).loc;
    const locN = newNode.loc;
    const coeff = Math.abs(locA[0] - locB[0]) > Math.abs(locA[1] - locB[1])
      ? (locN[0] - locA[0]) / (locB[0] - locA[0])
      : (locN[1] - locA[1]) / (locB[1] - locA[1]);
    const interpLoc = vecInterp(locA, locB, coeff);

    return {
      insertIdx: insertIdx,
      interpLoc: interpLoc,
    };
  }


  function locationChanged(loc1, loc2) {
    return Math.abs(loc1[0] - loc2[0]) > 2e-5
      || Math.abs(loc1[1] - loc2[1]) > 2e-5;
  }


  // Removes the metadata directly, this is kind of hacky
  function removeMetadata(entity) {
    const props = entity.props;
    const tags = props.tags;

    delete props.__fbid__;
    delete props.__origid__;
    delete props.__service__;
    delete props.__datasetid__;
    delete tags.conn;
    delete tags.orig_id;
    delete tags.debug_way_id;
    delete tags.import;
    delete tags.dupe;
  }
}
