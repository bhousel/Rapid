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

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { Midpoint } from '../actions/add_midpoint.ts';
import type { OsmEntity, OsmNode, OsmTags, OsmWay } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';
import type { Vec2 } from '@rapid-sdk/math';


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

//todo: using tree like this may be problematic - it may not reflect the graph we are validating
    const tree = editor.tree;
    const way = entity as OsmWay;
    const extendableNodeInfos = findConnectableEndNodesByExtension(way, graph);

    for (const extendableNodeInfo of extendableNodeInfos) {
      result.issues.push(new ValidationIssue(context, {
        type,
        subtype: 'highway-highway',
        severity: 'warning',
        message: function(this: any) {
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
        data: {
          midId: extendableNodeInfo.mid.id,
          edge: extendableNodeInfo.edge,
          cross_loc: extendableNodeInfo.cross_loc
        },
        dynamicFixes: makeFixes
      }));
    }

    return result;


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
          if (closest && closest.distance < WELD_TH_METERS) {    // note: this will not be in meters
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
      if (osm && !osm.isDataLoaded(node.loc!)) {
        return false;
      }
      if (isTaggedAsNotContinuing(node) || graph.parentWays(node).length !== 1) {
        return false;
      }

      let occurrences = 0;
      for (const index in way.nodes) {
        if (way.nodes[index] === node.id) {
          occurrences += 1;
          if (occurrences > 1) {
            return false;
          }
        }
      }
      return true;
    }

    /**
     * Finds endpoints of a way that could be connected to nearby roads
     * by extending the last edge segment.
     * @param way - The way to check
     * @param graph - The current graph
     * @returns Array of connection info objects for extendable endpoints
     */
    function findConnectableEndNodesByExtension(way: OsmWay, graph: Graph): any[] {
      const results: any[] = [];
      if (way.isClosed()) return results;

      let testNodes: OsmNode[];
      const indices = [0, way.nodes.length - 1];
      indices.forEach(nodeIndex => {
        const nodeID = way.nodes[nodeIndex];
        const node = graph.entity(nodeID) as OsmNode;

        if (!isExtendableCandidate(node, way)) return;

        const connectionInfo = canConnectByExtend(way, nodeIndex);
        if (!connectionInfo) return;

        testNodes = graph.childNodes(way).slice();   // shallow copy
        testNodes[nodeIndex] = testNodes[nodeIndex].move(connectionInfo.cross_loc);

        // don't flag issue if connecting the ways would cause self-intersection
        if (geoHasSelfIntersections(testNodes, nodeID)) return;

        results.push(connectionInfo);
      });

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
     * @param way - The way to extend
     * @param endNodeIdx - Index of the endpoint node (0 or last)
     * @returns Connection info with edge and crossing location, or `null`
     */
    function canConnectByExtend(way: OsmWay, endNodeIdx: number): any | null {
      const tipNodeID = way.nodes[endNodeIdx];  // the 'tip' node for extension point
      const midNodeID = endNodeIdx === 0 ? way.nodes[1] : way.nodes[way.nodes.length - 2];  // the other node of the edge
      const tipNode = graph.entity(tipNodeID) as OsmNode;
      const midNode = graph.entity(midNodeID) as OsmNode;
      const lon = tipNode.loc![0];
      const lat = tipNode.loc![1];
      const lon_range = geoMetersToLon(EXTEND_TH_METERS, lat) / 2;
      const lat_range = geoMetersToLat(EXTEND_TH_METERS) / 2;
      const queryExtent = new Extent(
        [lon - lon_range, lat - lat_range],
        [lon + lon_range, lat + lat_range]
      );

      // first, extend the edge of [midNode -> tipNode] by EXTEND_TH_METERS and find the "extended tip" location
      const edgeLen = geoSphericalDistance(midNode.loc!, tipNode.loc!);
      const t = EXTEND_TH_METERS / edgeLen + 1.0;
      const extTipLoc = vecInterp(midNode.loc!, tipNode.loc!, t);

      // then, check if the extension part [tipNode.loc -> extTipLoc] intersects any other ways
      const segmentInfos = tree.waySegments(queryExtent, graph);
      for (const segmentInfo of segmentInfos) {
        const way2 = graph.entity(segmentInfo.wayId) as OsmWay;

        if (!isHighway(way2)) continue;
        if (!canConnectWays(way, way2)) continue;

        const edge: [EntityID, EntityID] = segmentInfo.nodes.slice(0, 2);
        if (edge[0] === tipNodeID || edge[1] === tipNodeID) continue;

        const nA = graph.entity(edge[0]) as OsmNode;
        const nB = graph.entity(edge[1]) as OsmNode;
        const crossLoc = geomLineIntersection([tipNode.loc!, extTipLoc], [nA.loc!, nB.loc!]);
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
