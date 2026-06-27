import { OsmNode, OsmRelation, OsmWay } from '../data/index.ts';
import { validateAlmostJunction } from '../validators/almost_junction.ts';
import { validateCrossingWays } from '../validators/crossing_ways.ts';

import type { Action } from './types.ts';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmRelationMember, OsmTags } from '../data/types.ts';
import type { Vec2 } from '@rapid-sdk/math';


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
     * @param  extWay  - the original OsmWay in the external graph
     * @param  way     - the newly accepted OsmWay
     * @param  graph   - the current Graph
     */
    function attemptAutoconnect(extWay: OsmWay, way: OsmWay, graph: Graph): void {
      const context = graph.context;
      const rapid = context.systems.rapid;
      const spatial = context.systems.spatial;
      const storage = context.systems.storage;

      const doAutoconnect = storage?.getItem('rapid-internal-feature.autoConnect') === 'true';
      if (!doAutoconnect || !rapid || !spatial) return;

      graph = graph.commit();

      const serviceID = extWay.props.__service__;
      const datasetID = extWay.props.__datasetid__;
      const extSpatialID = `${serviceID}-${datasetID}-data`;  // spatialID naming convention

      // 1. If there are unaccepted nodes in the external dataset at the same location as
      // the node that we just added, mark them accepted also and import their tags.
      for (const nodeID of way.nodes) {
        const node = graph.entity(nodeID) as OsmNode;
        const coord = node.geoms.parts[0].world?.coords as Vec2;  // A node should have a single world coord
        if (!coord) continue;

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
      }

      // 2. Run the validator for almost junction and autofix whatever it found.
      const checkAlmostJunction = validateAlmostJunction(context);
      for (const issue of checkAlmostJunction(way, graph).issues) {
        if (issue.autoArgs) {
          graph = issue.autoArgs[0](graph);   // autoArgs = [action, annotation]
        }
      }

      // 3. Run the validator for crossing ways and autofix whatever it found.
      const checkCrossingWays = validateCrossingWays(context);
      for (const issue of checkCrossingWays(way, graph).issues) {
        if (issue.autoArgs) {
          graph = issue.autoArgs[0](graph);   // autoArgs = [action, annotation]
        }
      }
    }

  }) as RapidAcceptAction;


  /**
   * Accessor to get _all_ the ids that were accepted by the action.
   * When accepting a way, we also accept child nodes.
   * When accepting a relation, we also accept child members.
   * When autoconnecting, we also try to accept other nodes that are in the same place as the accepted nodes.
   * @return  Set of all ids that were accepted (not just the Entity that the user clicked on)
   */
  action.getAllIDs = () => allIDs;

  return action;


  /**
   * Deletes all Rapid-specific metadata from an entity's props and tags in place.
   * @param  entity - The entity to strip metadata from (mutated in place)
   */
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

