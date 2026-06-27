import {
  Extent, geoMetersToLat, geoMetersToLon, geoSphericalDistance, geoSphericalClosestPoint,
  geomLineIntersection, vecAngle, vecInterp
} from '@rapid-sdk/math';

import { actionAddMidpoint } from '../actions/add_midpoint.ts';
import { actionChangeTags } from '../actions/change_tags.ts';
import { actionMergeNodes } from '../actions/merge_nodes.ts';
import { geoHasSelfIntersections } from '../geo/geom.ts';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Action } from '../actions/types.ts';
import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { Midpoint } from '../actions/add_midpoint.ts';
import type { OsmEntity, OsmNode, OsmTags, OsmWay } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';
import type { Vec2 } from '@rapid-sdk/math';

interface ConnectionInfo {
  mid: OsmNode;
  node: OsmNode;
  wid: EntityID;
  edge: [EntityID, EntityID],
  cross_loc: Vec2
};


/**
 * Factory that creates a validator to detect roads that can
 * be connected to other roads with a short extension
 * @param context
 */
export function validateAlmostJunction(context: Context): ValidatorFunction {
  const type = 'almost_junction' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const schema = context.systems.schema;

  const EXTEND_TH_METERS = 5;
  const WELD_TH_METERS = 0.75;
  // Comes from considering bounding case of parallel ways
  const CLOSE_NODE_TH = EXTEND_TH_METERS - WELD_TH_METERS;
  // Comes from considering bounding case of perpendicular ways
  const SIG_ANGLE_TH = Math.atan(WELD_TH_METERS / EXTEND_TH_METERS);

  /**
   * Tests whether the entity is a routable highway.
   * @param entity
   */
  function isHighway(entity: OsmEntity): boolean {
    if (entity.type !== 'way') return false;
    return !!schema!.getScope('osm').rulesets.get('connected_highway')?.match({ highway: entity.tags.highway });
  }

  /**
   * Tests whether the node is tagged as not continuing (noexit, entrance, or parking entrance).
   * @param node
   */
  function isTaggedAsNotContinuing(node: OsmNode): boolean {
    return node.tags.noexit === 'yes'
      || node.tags.amenity === 'parking_entrance'
      || !!(node.tags.entrance && node.tags.entrance !== 'no');
  }


  /**
   * Checks whether a highway could be connected to a nearby highway by
   * extending one of its endpoints a short distance.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Result object containing issues detected
   */
  const validator = function checkAlmostJunction(entity: OsmEntity, graph: Graph): ValidatorResult {
    const result: ValidatorResult = { issues: [] };
    if (!schema) return result;
    if (!isHighway(entity)) return result;
    if (entity.isDegenerate()) return result;

    const way = entity as OsmWay;
    if (way.isClosed()) return result;

    const extendableNodeInfos = findConnectableEndNodesByExtension(way, graph);
    for (const extendableNodeInfo of extendableNodeInfos) {
      const autoArgs : [Action, string] = [
        actionExtendNode(extendableNodeInfo),
        l10n.t('issues.fix.connect_almost_junction.annotation')
      ];

      const issue = new ValidationIssue(context, {
        type,
        subtype: 'highway-highway',
        severity: 'warning',
        message: function (this: any) {
          const graph = editor.staging.graph;
          const entity1 = graph.hasEntity(this.entityIds[0]);
          if (this.entityIds[0] === this.entityIds[2]) {
            return entity1 ? l10n.t('issues.almost_junction.self.message', {
              feature: l10n.displayLabel(entity1, graph)
            }) : '';
          } else {
            const entity2 = graph.hasEntity(this.entityIds[2]);
            return (entity1 && entity2) ? l10n.t('issues.almost_junction.message', {
              feature: l10n.displayLabel(entity1, graph),
              feature2: l10n.displayLabel(entity2, graph)
            }) : '';
          }
        },
        reference: showReference as any,
        entityIds: [
          entity.id,
          extendableNodeInfo.node.id,
          extendableNodeInfo.wid,
        ],
        loc: extendableNodeInfo.node.loc,
        hash: JSON.stringify(extendableNodeInfo.node.loc),
        autoArgs: autoArgs,
        data: {
          midId: extendableNodeInfo.mid.id,
          edge: extendableNodeInfo.edge,
          cross_loc: extendableNodeInfo.cross_loc
        },
        dynamicFixes: makeFixes
      });

      result.issues.push(issue);
    }

    return result;


    /**
     * An action to perform the steps to extend the endpoint.
     * @returns an Action function that accepts a graph and returns a modified graph.
     */
    function actionExtendNode(info: ConnectionInfo) {
      return (graph: Graph) => {
        const midNode = graph.hasEntity(info.mid.id) as OsmNode;
        const endNode = graph.hasEntity(info.node.id) as OsmNode;
        const crossWay = graph.hasEntity(info.wid) as OsmWay;
        if (!midNode || !endNode || !crossWay) return graph;

        // When endpoints are close, just join if resulting small change in angle (iD#7201)
        const nearEndNodes = findNearbyEndNodes(endNode, crossWay, graph);
        if (nearEndNodes.length > 0) {
          const colinear = findSmallJoinAngle(midNode, endNode, nearEndNodes);
          if (colinear) {
            return actionMergeNodes([colinear.id, endNode.id], colinear.loc!)(graph);
          }
        }

        const targetEdge = info.edge;
        const crossLoc = info.cross_loc;
        const edgeA = graph.hasEntity(info.edge[0]) as OsmNode;
        const edgeB = graph.hasEntity(info.edge[1]) as OsmNode;
        if (!edgeA || !edgeB) return graph;

        const edgeNodes = [edgeA, edgeB];
        const points = edgeNodes.map(node => node.loc!);
        const closest = geoSphericalClosestPoint(points, crossLoc);

        // already a point nearby, just connect to that
        if (closest && closest.distance < WELD_TH_METERS) {
          const node = edgeNodes[closest.index] as OsmNode;
          return actionMergeNodes([node.id, endNode.id], closest.point)(graph);
        } else {   // create a midpoint on the target way
          return actionAddMidpoint({ loc: crossLoc, edge: targetEdge } as Midpoint, endNode)(graph);
        }
      };
    }


    /**
     * Generates fixes for an almost-junction: connect the features or tag as disconnected.
     * @returns Array of validation fixes
     */
    function makeFixes(this: any) {
      const graph = editor.staging.graph;

      const fixes = [new ValidationFix({
        icon: 'rapid-icon-abutment',
        title: l10n.t('issues.fix.connect_features.title'),
        onClick: function(this: any) {
          const annotation = l10n.t('issues.fix.connect_almost_junction.annotation');
          const [, endNodeId, crossWayId] = this.issue.entityIds;
          const midNode = graph.entity(this.issue.data.midId) as OsmNode;
          const endNode = graph.entity(endNodeId) as OsmNode;
          const crossWay = graph.entity(crossWayId) as OsmWay;

          // When endpoints are close, just join if resulting small change in angle (iD#7201)
          const nearEndNodes = findNearbyEndNodes(endNode, crossWay, graph);
          if (nearEndNodes.length > 0) {
            const colinear = findSmallJoinAngle(midNode, endNode, nearEndNodes);
            if (colinear) {
              editor.perform(actionMergeNodes([colinear.id, endNode.id], colinear.loc!));
              editor.commit({
                annotation: annotation,
                selectedIDs: [colinear.id, endNode.id]
              });
              return;
            }
          }

          const targetEdge = this.issue.data.edge;
          const crossLoc = this.issue.data.cross_loc;
          const edgeNodes = [ graph.entity(targetEdge[0]) as OsmNode, graph.entity(targetEdge[1]) as OsmNode ];
          const points = edgeNodes.map(node => node.loc!);
          const closest = geoSphericalClosestPoint(points, crossLoc);  // note: using wgs84, should change this

          // already a point nearby, just connect to that
          if (closest && closest.distance < WELD_TH_METERS) {
            const node = edgeNodes[closest.index] as OsmNode;
            editor.perform(actionMergeNodes([ node.id, endNode.id ], closest.point));
            editor.commit({
              annotation: annotation,
              selectedIDs: [node.id, endNode.id]
            });
          } else {   // create a midpoint on the target way
            editor.perform(actionAddMidpoint({ loc: crossLoc, edge: targetEdge } as Midpoint, endNode));
            editor.commit({
              annotation: annotation,
              selectedIDs: [endNode.id]
            });
          }
        }
      })];

      const node = graph.hasEntity(this.entityIds[1]);
      if (node && !node.hasInterestingTags()) {
        // node has no descriptive tags, suggest noexit fix
        fixes.push(new ValidationFix({
          icon: 'maki-barrier',
          title: l10n.t('issues.fix.tag_as_disconnected.title'),
          onClick: function(this: any) {
            const nodeID = this.issue.entityIds[1];
            const tags = { ...graph.entity(nodeID).tags };
            tags.noexit = 'yes';
            editor.perform(actionChangeTags(nodeID, tags));
            editor.commit({
              annotation: l10n.t('issues.fix.tag_as_disconnected.annotation'),
              selectedIDs: [nodeID]
            });
          }
        }));
      }

      return fixes;
    }

    /**
     * Renders the issue reference text into the given selection.
     * @param $selection
     */
    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.almost_junction.highway-highway.reference'));
    }


    /**
     * Tests whether a node is a valid candidate for extension.
     * Must be loaded, not tagged as not-continuing, and have exactly one parent way.
     * @param node - The endpoint node to check
     * @param way - The way containing the node
     * @returns `true` if the node can be extended
     */
    function isExtendableCandidate(node: OsmNode, way: OsmWay): boolean {
      // Bail out if map not fully loaded here - we won't know all the node's parentWays. - iD#5938
      // Don't worry, as more map tiles are loaded, we'll have additional chances to validate it.
      const osm = context.services.osm;
      if (osm && !osm.isDataLoaded(node.loc!)) return false;
      if (isTaggedAsNotContinuing(node)) return false;                      // node is tagged as not continuing
      if (graph.parentWays(node).length !== 1) return false;                // node has several parents already
      if (way.nodes.filter(id => id === node.id).length > 1) return false;  // node appears multiple times in way
      return true;
    }


    /**
     * Finds endpoints of a way that could be connected to nearby roads
     * by extending them a short distance.
     * @param way - The way to check
     * @param graph - The current graph
     * @returns Array of connection info objects for extendable endpoints
     */
    function findConnectableEndNodesByExtension(way: OsmWay, graph: Graph): ConnectionInfo[] {
      const results: ConnectionInfo[] = [];

      for (const i of [0, way.nodes.length - 1]) {     // first, last
        const nodeID = way.nodes[i];
        const node = graph.hasEntity(nodeID) as OsmNode;
        if (!node) continue;
        if (!isExtendableCandidate(node, way)) continue;

        const connectionInfo = canConnectByExtend(way, i);
        if (!connectionInfo) continue;

        // Try moving the node - would it create a self intersection?  If so, skip it.
        const testNodes = graph.childNodes(way).slice();   // shallow copy
        testNodes[i] = testNodes[i].move(connectionInfo.cross_loc);
        if (geoHasSelfIntersections(testNodes, nodeID)) continue;

        results.push(connectionInfo);
      }

      return results;
    }


    /**
     * Finds endpoints of the target way that are near the given node.
     * @param node - The node to search around
     * @param way - The way whose endpoints to check
     * @param graph - The current graph
     * @returns Array of nearby endpoint nodes
     */
    function findNearbyEndNodes(node: OsmNode, way: OsmWay, graph: Graph): OsmNode[] {
      return [way.first()!, way.last()!]
        .map(d => graph.entity(d) as OsmNode)
        .filter((d: OsmNode) => {
          // Node cannot be near to itself, but other endnode of same way could be
          return d.id !== node.id && geoSphericalDistance(node.loc!, d.loc!) <= CLOSE_NODE_TH;
        });
    }


    /**
     * Finds the endpoint most colinear with the mid→tip direction.
     * Used to determine if merging with a nearby endpoint is preferable to
     * adding a midpoint to the target edge.
     * @param midNode - The interior node of the extending edge
     * @param tipNode - The endpoint being extended
     * @param endNodes - Candidate nearby endpoints
     * @returns The most colinear endpoint, or `null` if none within threshold
     */
    function findSmallJoinAngle(midNode: OsmNode, tipNode: OsmNode, endNodes: OsmNode[]): OsmNode | null {
      // Both nodes could be close, so want to join whichever is closest to colinear
      let joinTo: OsmNode | undefined;
      let minAngle = Infinity;

      // World coordinates of the nodes involved.
      const mid = midNode.geoms.parts[0].world?.coords as Vec2;
      const tip = tipNode.geoms.parts[0].world?.coords as Vec2;
      if (!mid || !tip) return null;

      for (const endNode of endNodes) {
        const end = endNode.geoms.parts[0].world?.coords as Vec2;
        if (!end)  continue;

        const a1 = vecAngle(mid, tip) + Math.PI;
        const a2 = vecAngle(mid, end) + Math.PI;
        const diff = Math.max(a1, a2) - Math.min(a1, a2);

        if (diff < minAngle) {
          joinTo = endNode;
          minAngle = diff;
        }
      }

      return (minAngle <= SIG_ANGLE_TH) ? joinTo! : null;
    }


    /**
     * Tests whether a tag value is defined and not `'no'`.
     * @param tags
     * @param key
     */
    function hasTag(tags: OsmTags, key: string): boolean {
      return tags[key] !== undefined && tags[key] !== 'no';
    }


    /**
     * Tests whether two ways can be connected based on bridge/tunnel status and layer/level compatibility.
     * @param way - The first way
     * @param way2 - The second way
     * @returns `true` if the ways are compatible for connection
     */
    function canConnectWays(way: OsmWay, way2: OsmWay): boolean {
      // allow self-connections
      if (way.id === way2.id) return true;

      // if one is bridge or tunnel, both must be bridge or tunnel
      if ((hasTag(way.tags, 'bridge') || hasTag(way2.tags, 'bridge')) &&
        !(hasTag(way.tags, 'bridge') && hasTag(way2.tags, 'bridge'))) return false;
      if ((hasTag(way.tags, 'tunnel') || hasTag(way2.tags, 'tunnel')) &&
        !(hasTag(way.tags, 'tunnel') && hasTag(way2.tags, 'tunnel'))) return false;

      // must have equivalent layers and levels
      const layer1 = way.tags.layer || '0';
      const layer2 = way2.tags.layer || '0';
      if (layer1 !== layer2) return false;

      const level1 = way.tags.level || '0';
      const level2 = way2.tags.level || '0';
      if (level1 !== level2) return false;

      return true;
    }


    /**
     * Tests whether extending a way's endpoint would intersect a nearby way segment.
     * @param   way - The way to extend
     * @param   endIndex - Index of the endpoint node (0 or last)
     * @return  Connection info with edge and crossing location, or `null`
     */
    function canConnectByExtend(way: OsmWay, endIndex: number): ConnectionInfo | null {
      const tipNodeID = way.nodes[endIndex];  // the 'tip' node for extension point
      const midNodeID = endIndex === 0 ? way.nodes[1] : way.nodes[way.nodes.length - 2];  // the other node of the edge
      const tipNode = graph.hasEntity(tipNodeID) as OsmNode;
      const midNode = graph.hasEntity(midNodeID) as OsmNode;
      if (!tipNode || !midNode) return null;

      const lon = tipNode.loc![0];
      const lat = tipNode.loc![1];
      const lon_range = geoMetersToLon(EXTEND_TH_METERS, lat) / 2;
      const lat_range = geoMetersToLat(EXTEND_TH_METERS) / 2;
      const queryExtent = new Extent(
        [lon - lon_range, lat - lat_range],
        [lon + lon_range, lat + lat_range]
      );

      // Extend the endpoint along [midNode -> tipNode] by EXTEND_TH_METERS
      const segLength = geoSphericalDistance(midNode.loc!, tipNode.loc!);
      const t1 = 1 + (EXTEND_TH_METERS / segLength);
      const farLoc = vecInterp(midNode.loc!, tipNode.loc!, t1);
      // We'll also test a position where the endpoint is pulled back by a small amount
      const t2 = 0.95;
      const nearLoc = vecInterp(midNode.loc!, tipNode.loc!, t2);

      // Check if the test [nearLoc -> farLoc] intersects any other ways
      const segmentInfos = editor.waySegments(queryExtent, graph);
      for (const segmentInfo of segmentInfos) {
        const way2 = graph.entity(segmentInfo.wayID) as OsmWay;

        if (!isHighway(way2)) continue;
        if (!canConnectWays(way, way2)) continue;

        const edge: [EntityID, EntityID] = segmentInfo.edge;
        if (edge[0] === tipNodeID || edge[1] === tipNodeID) continue;  // skip self

        const nA = graph.entity(edge[0]) as OsmNode;
        const nB = graph.entity(edge[1]) as OsmNode;
        const crossLoc = geomLineIntersection([nearLoc, farLoc], [nA.loc!, nB.loc!]);
        if (crossLoc) {
          return {
            mid: midNode,
            node: tipNode,
            wid: way2.id,
            edge: [nA.id, nB.id],
            cross_loc: crossLoc
          };
        }
      }
      return null;
    }
  };


  validator.type = type;
  return validator;
}
