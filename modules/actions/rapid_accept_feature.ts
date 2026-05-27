import { OsmNode, OsmRelation, OsmWay } from '../data/index.ts';
import { Vec2, vecEqual, vecInterp } from '@rapid-sdk/math';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmRelationMember, OsmTags } from '../data/types.ts';


/** Result of finding a connection point on target way */
interface ConnectionPoint {
  insertIdx: number;
  interpLoc: Vec2;
}


/**
 * Accepts a Rapid feature from an external graph into the main graph.
 * Handles nodes, ways, and relations, including connection points to existing ways.
 * @param   entityID  - EntityID of the entity to accept from the external graph
 * @param   extGraph  - The external Graph containing the Rapid features
 * @return  An Action function that adds the given Rapid feature to the main graph
 */
export function actionRapidAcceptFeature(entityID: EntityID, extGraph: Graph): Action {

  return (graph: Graph): Graph => {
    const seenRelations = new Map<EntityID, OsmRelation>();    // avoid infinite recursion
    const extEntity = extGraph.entity(entityID);

    if (extEntity.type === 'node') {
      acceptNode(extEntity as OsmNode);
    } else if (extEntity.type === 'way') {
      acceptWay(extEntity as OsmWay);
    } else if (extEntity.type === 'relation') {
      acceptRelation(extEntity as OsmRelation);
    }

    return graph.commit();


    // These functions each accept the external entities, returning the replacement
    // NOTE - these functions operate on the `graph` closure variable

    /**
     * Copies an external node into the working graph, stripping Rapid metadata tags.
     * @param   extNode - The external node to accept
     * @return  The new node added to the graph
     */
    function acceptNode(extNode: OsmNode): OsmNode {
      const node = new OsmNode(extNode);   // copy node before modifying
      removeMetadata(node);

      graph.replace(node);
      return node;
    }


    /**
     * Copies an external way and all of its nodes into the working graph.
     * Handles `conn` tags (connection snapping to an existing way) and `dupe`
     * tags (reuse of an existing node instead of creating a duplicate).
     * Strips Rapid metadata tags from the way and its nodes.
     * @param   extWay - The external way to accept
     * @return  The new way added to the graph
     */
    function acceptWay(extWay: OsmWay): OsmWay {
      let way = new OsmWay(extWay);   // copy way before modifying
      removeMetadata(way);

      const nodes: EntityID[] = [];
      for (const nodeID of way.nodes) {
        let node = new OsmNode(extGraph.entity(nodeID) as OsmNode);   // copy node before modifying
        const connTag = node.tags.conn;
        const conn: string[] | undefined = connTag ? connTag.split(',') : undefined;
        const dupeID: string | undefined = node.tags.dupe;
        removeMetadata(node);

        const dupe = (dupeID && graph.hasEntity(dupeID)) as OsmNode | undefined;
        if (dupe && vecEqual(dupe.loc!, node.loc!)) {
          node = dupe;   // prefer the original node identified by dupeID
        }

        if (conn && graph.hasEntity(conn[0])) {
          //conn=w316746574,n3229071295,n3229071273
          const targetWay = graph.hasEntity(conn[0]) as OsmWay | null;
          const nodeA = graph.hasEntity(conn[1]) as OsmNode | null;
          const nodeB = graph.hasEntity(conn[2]) as OsmNode | null;

          if (targetWay && nodeA && nodeB) {
            const result = findConnectionPoint(graph, node, targetWay, nodeA, nodeB);
            if (result && vecEqual(result.interpLoc, node.loc!)) {
              // Create a new node with updated loc since loc is readonly
              node = node.update({ loc: result.interpLoc });
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


    /**
     * Recursively copies an external relation and all of its member entities
     * into the working graph.  Uses `seenRelations` to avoid infinite loops
     * when member relations are circular.
     * @param   extRelation - The external relation to accept
     * @return  The new relation added to the graph
     */
    function acceptRelation(extRelation: OsmRelation): OsmRelation {
      const seen = seenRelations.get(extRelation.id);
      if (seen) return seen;

      let relation = new OsmRelation(extRelation);  // copy relation before modifying
      removeMetadata(relation);

      const members: OsmRelationMember[] = [];
      for (const member of relation.members) {
        const extEntity = extGraph.entity(member.id);
        let replacement: OsmEntity;

        if (extEntity.type === 'node') {
          replacement = acceptNode(extEntity as OsmNode);
        } else if (extEntity.type === 'way') {
          replacement = acceptWay(extEntity as OsmWay);
        } else if (extEntity.type === 'relation') {
          replacement = acceptRelation(extEntity as OsmRelation);
        } else {
          continue;  // skip unknown types
        }

        members.push(Object.assign(member, { id: replacement.id }));
      }

      relation = relation.update({ members: members });
      graph.replace(relation);
      seenRelations.set(extRelation.id, relation);  // don't create it again
      return relation;
    }
  };


  /**
   * Finds the correct position and interpolated location to insert `newNode`
   * onto `targetWay` between `nodeA` and `nodeB`, preserving the existing
   * segment angle.  Returns `null` if the invariants required for a clean
   * insertion cannot be met (e.g. A/B out of order, wrong sort direction).
   * @param   graph     - The current graph
   * @param   newNode   - The node to be inserted
   * @param   targetWay - The way to insert the node into
   * @param   nodeA     - The node immediately before the insertion segment
   * @param   nodeB     - The node immediately after the insertion segment
   * @return  `{ insertIdx, interpLoc }` describing where to insert, or `null`
   */
  // Find the place to newNode on targetWay between nodeA and nodeB if it does
  // not alter the existing segment's angle much. There may be other nodes
  // between A and B from user edit or other automatic connections.
  function findConnectionPoint(
    graph: Graph,
    newNode: OsmNode,
    targetWay: OsmWay,
    nodeA: OsmNode,
    nodeB: OsmNode
  ): ConnectionPoint | null {
    const locA = nodeA.loc!;
    const locB = nodeB.loc!;
    const sortByLon = Math.abs(locA[0] - locB[0]) > Math.abs(locA[1] - locB[1]);
    const sortFunc = sortByLon
      ? function(n1: OsmNode, n2: OsmNode): number {
        return locA[0] < locB[0] ? n1.loc![0] - n2.loc![0] : n2.loc![0] - n1.loc![0];
      }
      : function(n1: OsmNode, n2: OsmNode): number {
        return locA[1] < locB[1] ? n1.loc![1] - n2.loc![1] : n2.loc![1] - n1.loc![1];
      };

    const nidList: EntityID[] = targetWay.nodes;
    const idxA: number = nidList.indexOf(nodeA.id);
    const idxB: number = nidList.indexOf(nodeB.id);

    // Invariants for finding the insert index below: A and B must be in the
    // node list, in order, and the sort function must also order A before B
    if (idxA === -1 || idxB === -1 || idxA >= idxB || sortFunc(nodeA, nodeB) >= 0) {
      return null;
    }

    let insertIdx: number = idxA + 1;  // index to insert immediately before
    while (insertIdx < idxB && sortFunc(newNode, graph.entity(nidList[insertIdx]) as OsmNode) > 0) {
      insertIdx++;
    }

    // Find the interpolated point on the segment where insertion will not
    // alter the segment's angle.
    const interpLocA: Vec2 = (graph.entity(nidList[insertIdx - 1]) as OsmNode).loc!;
    const interpLocB: Vec2 = (graph.entity(nidList[insertIdx]) as OsmNode).loc!;
    const locN: Vec2 = newNode.loc!;
    const coeff: number = Math.abs(interpLocA[0] - interpLocB[0]) > Math.abs(interpLocA[1] - interpLocB[1])
      ? (locN[0] - interpLocA[0]) / (interpLocB[0] - interpLocA[0])
      : (locN[1] - interpLocA[1]) / (interpLocB[1] - interpLocA[1]);
    const interpLoc: Vec2 = vecInterp(interpLocA, interpLocB, coeff);

    return {
      insertIdx: insertIdx,
      interpLoc: interpLoc,
    };
  }


  /**
   * Deletes all Rapid-specific metadata from an entity's props and tags in place.
   * @param   entity - The entity to strip metadata from (mutated in place)
   */
  // Removes the metadata directly, this is kind of hacky
  function removeMetadata(entity: OsmEntity): void {
    const props = entity.props as Record<string, unknown>;
    const tags = props.tags as OsmTags;

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
