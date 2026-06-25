import { actionAddMidpoint } from '../actions/add_midpoint.ts';
import { actionConnect } from './connect.ts';
import { OsmNode, OsmRelation, OsmWay } from '../data/index.ts';
import { Extent, geoSphericalDistance, projWorldToWgs84, projWgs84ToWorld, Vec2, vecProject, vecInterp } from '@rapid-sdk/math';
import { validateCrossingWays } from '../validators/crossing_ways.ts';

import type { Action } from './types.ts';
import type { Closest } from '@rapid-sdk/math';
import type { Graph } from '../lib/Graph.ts';
import type { Midpoint } from '../actions/add_midpoint.ts';
import type { OsmEntity, OsmRelationMember, OsmTags } from '../data/types.ts';


/** Result of finding a connection point on target way */
interface ConnectionPoint {
  insertIdx: number;
  interpLoc: Vec2;
}

/**
 * Extended Action that includes additional methods.
 */
interface RapidAcceptAction extends Action {
  /** Returns the full set of entityIDs accepted */
  getAllIDs(): Set<EntityID>;
}


/**
 * Accepts a Rapid feature from an external graph into the main graph.
 * Handles nodes, ways, and relations, including connection points to existing ways.
 * @param   entityID  - EntityID of the entity to accept from the external graph
 * @param   extGraph  - The external Graph containing the Rapid features
 * @return  An Action function that adds the given Rapid feature to the main graph
 */
export function actionRapidAcceptFeature(entityID: EntityID, extGraph: Graph): RapidAcceptAction {

  const allIDs = new Set<EntityID>();

  const action: RapidAcceptAction = ((graph: Graph): Graph => {
    const seenRelations = new Map<EntityID, OsmRelation>();    // avoid infinite recursion
    const extEntity = extGraph.entity(entityID);

    if (extEntity.type === 'node') {
      acceptNode(extEntity as OsmNode);
    } else if (extEntity.type === 'way') {
      const way = acceptWay(extEntity as OsmWay);
      attemptAutoconnect(extEntity as OsmWay, way, graph);
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
      allIDs.add(node.id);
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
      allIDs.add(way.id);

      const nodes: EntityID[] = [];
      for (const nodeID of way.nodes) {
        const node = acceptNode(extGraph.entity(nodeID) as OsmNode);
        nodes.push(node.id);
      }

// This is the legacy code that relies on `conn` and `dupe` tags added by the MapWithAI server.
//      for (const nodeID of way.nodes) {
//        let node = new OsmNode(extGraph.entity(nodeID) as OsmNode);   // copy node before modifying
//        const connTag = node.tags.conn;
//        const conn: string[] | undefined = connTag ? connTag.split(',') : undefined;
//        const dupeID: string | undefined = node.tags.dupe;
//        removeMetadata(node);
//
//        const dupe = (dupeID && graph.hasEntity(dupeID)) as OsmNode | undefined;
//        if (dupe && vecEqual(dupe.loc!, node.loc!)) {
//          node = dupe;   // prefer the original node identified by dupeID
//        }
//
//        if (conn && graph.hasEntity(conn[0])) {
//          //conn=w316746574,n3229071295,n3229071273
//          const targetWay = graph.hasEntity(conn[0]) as OsmWay | null;
//          const nodeA = graph.hasEntity(conn[1]) as OsmNode | null;
//          const nodeB = graph.hasEntity(conn[2]) as OsmNode | null;
//
//          if (targetWay && nodeA && nodeB) {
//            const result = findConnectionPoint(graph, node, targetWay, nodeA, nodeB);
//            if (result && vecEqual(result.interpLoc, node.loc!)) {
//              // Create a new node with updated loc since loc is readonly
//              node = node.update({ loc: result.interpLoc });
//              graph.replace(targetWay.addNode(node.id, result.insertIdx));
//            }
//          }
//        }
//
//        graph.replace(node);
//        nodes.push(node.id);
//      }

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
      allIDs.add(relation.id);

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


    /**
     * After adding a way, automatically connect it to existing features in the working graph.
     * @param  extWay    - the original OsmWay in the external graph
     * @param  way       - the newly accepted OsmWay
     * @param  graph     - the current Graph
     */
    function attemptAutoconnect(extWay: OsmWay, way: OsmWay, graph: Graph): void {
      const context = graph.context;
      const editor = context.systems.editor;
      const rapid = context.systems.rapid;
      const schema = context.systems.schema;
      const spatial = context.systems.spatial;
      const storage = context.systems.storage;

      const doAutoconnect = storage?.getItem('rapid-internal-feature.autoConnect') === 'true';
      if (!doAutoconnect || !editor || !rapid || !spatial) return;

      graph = graph.commit();

      const serviceID = extWay.props.__service__;
      const datasetID = extWay.props.__datasetid__;
      const extSpatialID = `${serviceID}-${datasetID}-data`;  // spatialID naming convention
      const baseSpatialID = editor.spatialIDForGraph(graph);  // 'editor_staging'

      // For each node in the way we've just accepted, look for things to connect to...
      // Be careful: some of the modifications below can modify or replace `way` or `node`.
      // for (let i = 0; i < way.nodes.length; i++)
      //  const nodeID = way.nodes[i];
      for (const nodeID of way.nodes) {
        let node = graph.entity(nodeID) as OsmNode;
        const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
        if (!coord) continue;

        // 1. If there are unaccepted nodes in the external dataset at the same location as
        // the node that we just added, mark them accepted also and import their tags.
        const extHits = spatial.getItemsAtCoord(extSpatialID, coord);
        for (const hit of extHits) {
          const other = hit.contents as OsmNode;
          const otherID = other.id;
          if (other.type !== 'node') continue;
          if (rapid.acceptIDs.has(otherID) || rapid.ignoreIDs.has(otherID) || allIDs.has(otherID)) continue;

          const copy = new OsmNode(other);   // copy node before modifying
          removeMetadata(copy);
          allIDs.add(copy.id);
          for (const [k, v] of Object.entries(copy.props?.tags ?? {})) {
            node.props.tags![k] = v;
          }
          node.touch();
          graph.replace(node);
        }

        // 2. If the node can connect to the basemap, do that.
        // Code here is similar to snapping code found in places like DragNodeMode.ts.
        // Choose the closest thing within the snap distance, either a node or a way.
        // Snap only to highways for now.
        const SNAP_DIST = 1;   // 1 meter
        const box = queryBox(node.loc!, SNAP_DIST);
        const baseHits = spatial.getItemsAtBox(baseSpatialID, box);
        for (const hit of baseHits) {
          // Make sure we're using the current the version of the target as it exists in this graph.
          const target = graph.hasEntity((hit.contents as OsmEntity).id);
          if (!target) continue;

          if (target.type === 'node') {
            if (!hasParentHighway(graph, target as OsmNode)) continue;  // connect to highway/path only

            graph = actionConnect([node.id, target.id])(graph);
            // refresh entities after connect (one of them survived)
            node = (graph.hasEntity(node.id) ?? graph.hasEntity(target.id)) as OsmNode;
            way = graph.entity(way.id) as OsmWay;

          } else if (target.type === 'way') {
            const targetWay = target as OsmWay;
            if (!isHighway(graph, targetWay)) continue;  // connect to highway/path only

            // A way will have LineString or Polygon geometry. We can use 'outer' to get these points.
            const line = targetWay.geoms.parts[0]!.world!.outer as Vec2[];
            const choice = vecProject(coord, line);
            if (choice && choice.point) {
              const snapLoc = projWorldToWgs84(choice.point);
              const dist = geoSphericalDistance(node.loc!, snapLoc);
              if (dist < SNAP_DIST) {
                const edge: [EntityID, EntityID] = [targetWay.nodes[choice.index - 1], targetWay.nodes[choice.index]];
                graph = actionAddMidpoint({ loc: snapLoc, edge }, node)(graph);
                // refresh entities after connect
                node = graph.entity(node.id) as OsmNode;
                way = graph.entity(way.id) as OsmWay;
              }
            }
          }
        }

        // First, compute the distance to neighbor nodes.
        // We don't want to snap to anything in the basemap farther than this distance.
        // (It could cause a node to jump past its neighbor or break the way!)
//        let neighborDistance = Infinity;  // in meters
//        const nextID = way.nodes[i + 1];
//        const prevID = way.nodes[i - 1];
//        const nextNode = (nextID ? graph.hasEntity(nextID) : undefined) as OsmNode | undefined;
//        const prevNode = (prevID ? graph.hasEntity(prevID) : undefined) as OsmNode | undefined;
//        const nextLoc = nextNode?.loc;
//        const prevLoc = prevNode?.loc;
//        if (nextLoc) {
//          neighborDistance = Math.min(neighborDistance, geoSphericalDistance(node.loc!, nextLoc));
//        }
//        if (prevLoc) {
//          neighborDistance = Math.min(neighborDistance, geoSphericalDistance(node.loc!, prevLoc));
//        }
//
//        const SEARCH_DIST = Math.min(0.5, neighborDistance);   // 1 meter (or less if close neighbor)
//        let minDistance = Infinity;
//        let target: OsmEntity | undefined;
//        let midpoint: Midpoint | undefined;
//
//        const box = queryBox(node.loc!, SEARCH_DIST);
//        const baseHits = spatial.getItemsAtBox(baseSpatialID, box);
//        for (const hit of baseHits) {
//          // Make sure we're using the current the version of the candidate as it exists in this graph.
//          const candidate = graph.hasEntity((hit.contents as OsmEntity).id);
//          if (!candidate) continue;
//
//          if (candidate.type === 'node') {
//            const candidateNode = candidate as OsmNode;
//            if (!hasParentHighway(graph, candidateNode)) continue;
//
//            const dist = geoSphericalDistance(node.loc!, candidateNode.loc!);
//            if (dist > neighborDistance) continue;  // let our neighbor snap here instead.
//            if (dist < minDistance) {
//              minDistance = dist;
//              target = candidateNode;
//            }
//
//          } else if (candidate.type === 'way') {
//            const candidateWay = candidate as OsmWay;
//            if (!isHighway(graph, candidateWay)) continue;
//
//            // A way will have LineString or Polygon geometry. We can use 'outer' to get these points.
//            const line = candidateWay.geoms.parts[0]!.world!.outer as Vec2[];
//            const choice = vecProject(coord, line);
//
//            if (choice && choice.point) {
//              // Add a slight distance penalty - It's possible that we will hit both a candidate node and way
//              // at 0 distance, and we'd perfer connecting to the node over adding a midpoint on the way.
//              const loc = projWorldToWgs84(choice.point);
//              const dist = geoSphericalDistance(node.loc!, loc) + 1e-7;
//              if (dist > neighborDistance) continue;  // let our neighbor snap here instead.
//              if (dist < minDistance) {
//                const edge: [EntityID, EntityID] = [candidateWay.nodes[choice.index - 1], candidateWay.nodes[choice.index]];
//                minDistance = dist;
//                target = candidateWay;
//                midpoint = { edge, loc };
//              }
//            }
//          }
//        }
//
//        // snap to node or way if possible.
//        if (target?.type === 'node') {
//          graph = actionConnect([ node.id, target.id ])(graph);
//          // refresh entities after connect (one of them survived)
//          node = (graph.hasEntity(node.id) ?? graph.hasEntity(target.id)) as OsmNode;
//          way = graph.entity(way.id) as OsmWay;
//
//        } else if (target?.type === 'way' && midpoint) {
//          graph = actionAddMidpoint(midpoint, node)(graph);
//          // refresh entities after connect
//          node = graph.entity(node.id) as OsmNode;
//          way = graph.entity(way.id) as OsmWay;
//        }
      }

      // 3. Run the validator for crossing ways and autofix whatever it found.
      const checkCrossingWays = validateCrossingWays(context);
      const result = checkCrossingWays(way, graph);
      for (const issue of result.issues) {
        if (issue.autoArgs) {
          graph = issue.autoArgs[0](graph);   // autoArgs = [action, annotation]
        }
      }

      /**
       * Tests whether the given way is a line tagged as a routable highway.
       * @param graph  - The graph to check
       * @param entity - The way to check
       * @returns `true` if the way is a routable highway
       */
      function isHighway(graph: Graph, way: OsmWay): boolean {
        if (way.geometry(graph) !== 'line') return false;
        return !!schema!.getScope('osm').rulesets.get('connected_highway')?.match({ highway: way.tags.highway });
      }

      /**
       * Tests whether the given node has a parent routable highway.
       * @param graph  - The graph to check
       * @param node   - The node to check
       * @returns `true` if the node has a parent routable highway
       */
      function hasParentHighway(graph: Graph, node: OsmNode): boolean {
        for (const parent of graph.parentWays(node)) {
          if (isHighway(graph, parent)) {
            return true;
          }
        }
        return false;
      }

    }

  }) as RapidAcceptAction;


  /**
   *  Accessor to get _all_ the ids that were accepted by the action.
   */
  action.getAllIDs = () => allIDs;

  return action;


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


  /**
   * Generate a query box for the spatial system, given a center and a padding.
   * @param   loc      - center coordinate (in WGS84 coordinates)
   * @param   padding  - padding disatance (in meters)
   * @returns Box object with `minX`,`minY`,`maxX`,`maxY` properties
   */
  function queryBox(loc: Vec2, padding: number) {
    const extent = new Extent(loc).padByMeters(padding);

    // Convert the WGS84 extent to a world-coordinate box.
    const bb = extent.bbox();
    const [ax, ay] = projWgs84ToWorld([bb.minX, bb.minY]);
    const [bx, by] = projWgs84ToWorld([bb.maxX, bb.maxY]);
    return {
      minX: Math.min(ax, bx),
      minY: Math.min(ay, by),
      maxX: Math.max(ax, bx),
      maxY: Math.max(ay, by)
    };
  }


}

