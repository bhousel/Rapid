import {
  Extent, geoSphericalClosestPoint, geoSphericalDistance, geomLineIntersection,
  projWgs84ToWorld, projWorldToWgs84, vecAngle, vecLength, vecProject
} from '@rapid-sdk/math';

import { actionAddMidpoint, actionChangeTags, actionMergeNodes, actionSplit, actionSyncCrossingTags } from '../actions/index.ts';
import { OsmNode } from '../data/OsmNode.ts';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { Midpoint } from '../actions/add_midpoint.ts';
import type { OsmEntity, OsmRelation, OsmTags, OsmWay } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';
import type { Vec2 } from '@rapid-sdk/math';


interface WayInfo {
  way: OsmWay;
  featureType: string;
  edge: [EntityID, EntityID];
}

interface CrossingInfo {
  wayInfos: [WayInfo, WayInfo];
  crossPoint: Vec2;
}

/**
 * Factory that creates a validator for detecting ways that cross each other
 * without proper connections (bridges, tunnels, fords, or shared nodes).
 * @param context
 * @returns Validator function
 */
export function validateCrossingWays(context: Context): ValidatorFunction {
  const type = 'crossing_ways' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const schema = context.systems.schema!;


  /**
   * Tests whether a tag value is defined and not `'no'`.
   * @param v
   */
  function hasTag(v: string | undefined): boolean {
    return v !== undefined && v !== 'no';
  }
  /**
   * Tests whether the given tags indicate an indoor feature.
   * @param tags
   */
  function taggedAsIndoor(tags: OsmTags): boolean {
    return hasTag(tags.indoor) || hasTag(tags.level) || tags.highway === 'corridor';
  }

  // lookups
  const allowBridge = new Set<string>(['aeroway', 'highway', 'railway', 'waterway']);
  const allowTunnel = new Set<string>(['highway', 'railway', 'waterway']);
  const disallowFord = new Set<string>([
    'motorway', 'motorway_link', 'trunk', 'trunk_link',
    'primary', 'primary_link', 'secondary', 'secondary_link'
  ]);



  /**
   * Tests whether the given tags contain crossing information on the node.
   * @param tags - The tags to check
   * @returns `true` if the tags indicate a crossing node
   */
  function isCrossingNode(tags: OsmTags): boolean {
    return tags.highway === 'crossing' || !!tags.railway?.includes('crossing');
  }


  /**
   * Tests whether the way is tagged as a crossing
   * (e.g. `highway=footway` + `footway=crossing`).
   * @param tags - The tags to check
   * @returns `true` if the tags indicate a crossing way
   */
  function isCrossingWay(tags: OsmTags): boolean {
    const pathVals = schema.getScope('osm').variables.get('path_highway_values')?.asSet();
    if (!pathVals) return false;
    for (const k of pathVals) {
      if (tags.highway === k && tags[k] === 'crossing') {
        return true;
      }
    }
    return false;
  }


  /**
   * Checks the given entity for problematic way crossings.
   * @param entity - The entity to validate
   * @param graph - The graph we are validating
   * @returns Result object containing issues detected
   */
  const validator = function checkCrossingWays(entity: OsmEntity, graph: Graph): ValidatorResult {
    const result: ValidatorResult = { issues: [] };
    if (!schema) return result;

// note: using tree like this may be problematic - it may not reflect the graph we are validating.
// update: it's probably ok, as `tree.waySegments` will reset the tree to the graph are using..
// (although this will surely hurt performance)
    const tree = editor.tree;

    for (const way of waysToCheck(entity, graph)) {
      for (const crossing of detectCandidateCrossings(way, graph, tree)) {
        result.issues.push(createIssue(crossing, graph));
      }
    }
    return result;
  };


  /**
   * Returns the set of ways to check for problem crossings.
   * For a way entity, returns that way; for a multipolygon, returns member ways.
   * @param entity - The entity to inspect
   * @param graph - The current graph
   * @returns Set of ways to check
   */
  function waysToCheck(entity: OsmEntity, graph: Graph): Set<OsmWay> {
    if (!getFeatureType(entity, graph)) {   // no type - not worth checking
      return new Set<OsmWay>();

    } else if (entity.type === 'way') {
      return new Set<OsmWay>([entity as OsmWay]);

    } else if (entity.type === 'relation' && entity.tags.type === 'multipolygon') {
      const result = new Set<OsmWay>();
      for (const member of (entity as OsmRelation).members) {
        // also include no role, these are treated as 'outer'
        if (member.type === 'way' && (!member.role || member.role === 'outer' || member.role === 'inner')) {
          const child = graph.hasEntity(member.id) as OsmWay;
          if (child) {
            result.add(child);  // useful: Set prevents duplicates
          }
        }
      }
      return result;

    } else {
      return new Set<OsmWay>();  // nothing to check
    }
  }


  /**
   * Returns the way or its parent relation, whichever has a useful feature type.
   * @param way - The way involved in the crossing
   * @param graph - The current graph
   * @returns The tagged entity for feature type identification
   */
  function getTaggedEntityForWay(way: OsmWay, graph: Graph): OsmEntity {
    if (getFeatureType(way, graph) === null) {
      // if the way doesn't match a feature type, check its parent relations
      const parentRels = graph.parentRelations(way);
      for (const rel of parentRels) {
        if (getFeatureType(rel, graph) !== null) {
          return rel;
        }
      }
    }
    return way;
  }


  /**
   * Determines the feature type of the given entity.
   * @param entity - The entity to classify
   * @param graph - The current graph
   * @returns One of `'aeroway'`, `'building'`, `'highway'`, `'railway'`, `'waterway'`, or `null`
   */
  function getFeatureType(entity: OsmEntity, graph: Graph): string | null {
    const geometry = entity.geometry(graph);
    if (geometry !== 'line' && geometry !== 'area') return null;

    const tags = entity.tags;

    const rulesets = schema.getScope('osm').rulesets;
    const variables = schema.getScope('osm').variables;
    const lifecyclePrefixes = variables.get('lifecycle_prefixes')?.asSet();

    const routeAero = rulesets.get('connected_aeroway');
    if (routeAero?.match({ aeroway: tags.aeroway })) return 'aeroway';
    if (hasTag(tags.building) && !lifecyclePrefixes?.has(tags.building)) return 'building';

    const routeHwy = rulesets.get('connected_highway');
    if (hasTag(tags.highway) && routeHwy?.match({ highway: tags.highway })) return 'highway';

    // don't check railway or waterway areas
    if (geometry !== 'line') return null;

    const railTrack = rulesets.get('connected_railway');
    if (hasTag(tags.railway) && railTrack?.match({ railway: tags.railway })) return 'railway';

    const flowWater = rulesets.get('connected_waterway');
    if (hasTag(tags.waterway) && flowWater?.match({ waterway: tags.waterway })) return 'waterway';

    return null;
  }


  /**
   * Determines whether a crossing between two features is acceptable
   * based on OSM tagging conventions (layers, bridges, tunnels, indoor levels).
   * @param tags1 - Tags of the first entity
   * @param type1 - Feature type of the first entity
   * @param tags2 - Tags of the second entity
   * @param type2 - Feature type of the second entity
   * @returns `true` if the crossing is legitimate and should not be flagged
   */
  function isLegitCrossing(tags1: OsmTags, type1: string, tags2: OsmTags, type2: string): boolean {
    // assume 0 by default
    const level1 = tags1.level || '0';
    const level2 = tags2.level || '0';

    // Allow indoor features to cross if they're indoor on different levels
    if (taggedAsIndoor(tags1) && taggedAsIndoor(tags2) && level1 !== level2) return true;

    // assume 0 by default; don't use way.layer() since we account for structures here
    const layer1 = tags1.layer || '0';
    const layer2 = tags2.layer || '0';

    // Allow highways to cross if they're on different layers (regardless of bridge/tunnel tags)
    if ((type1 === 'highway' && type2 === 'highway') && layer1 !== layer2) return true;

    // Allow bridges to cross on different layers
    const bridge1 = allowBridge.has(type1) && hasTag(tags1.bridge);
    const bridge2 = allowBridge.has(type2) && hasTag(tags2.bridge);
    if ((bridge1 && !bridge2) || (!bridge1 && bridge2)) return true;  // one has a bridge, one doesnt
    if (bridge1 && bridge2 && layer1 !== layer2) return true;         // both have bridges on different layers

    // Allow tunnels to cross on different layers
    const tunnel1 = allowTunnel.has(type1) && hasTag(tags1.tunnel);
    const tunnel2 = allowTunnel.has(type2) && hasTag(tags2.tunnel);
    if ((tunnel1 && !tunnel2) || (!tunnel1 && tunnel2)) return true;  // one has a tunnel, one doesnt
    if (tunnel1 && tunnel2 && layer1 !== layer2) return true;         // both have tunnels on different layers

    // Allow waterways to cross highways tagged with 'pier'
    if (type1 === 'waterway' && type2 === 'highway' && tags2.man_made === 'pier') return true;
    if (type2 === 'waterway' && type1 === 'highway' && tags1.man_made === 'pier') return true;

    // Allow anything to cross buildings if on different layers
    if ((type1 === 'building' || type2 === 'building') && layer1 !== layer2) return true;

    return false;
  }


  /**
   * Determines whether two entities are allowed to cross, and if so,
   * what tags should be suggested on the connecting node.
   * @param entity1 - First crossing entity
   * @param entity2 - Second crossing entity
   * @param graph - The current graph
   * @returns Suggested tags for the connection node, or `null` if disallowed
   */
  function getConnectionTags(entity1: OsmEntity, entity2: OsmEntity, graph: Graph): OsmTags | null {
    const type1 = getFeatureType(entity1, graph);
    const type2 = getFeatureType(entity2, graph);
    if (!type1 || !type2) return null;

    const crossingType = [type1, type2].sort().join('-');  // a string like 'highway-highway'

    const geometry1 = entity1.geometry(graph);
    const geometry2 = entity2.geometry(graph);
    const bothLines = geometry1 === 'line' && geometry2 === 'line';

    const rulesets = schema.getScope('osm').rulesets;
    const pathHighway = rulesets.get('path_highway');
    const isPathHighway = (val: string | undefined): boolean => !!pathHighway?.match({ highway: val });

    if (crossingType === 'aeroway-aeroway') {
      return {};  // allowed, no tag suggestion

    } else if (crossingType === 'aeroway-highway') {
      const isService = entity1.tags.highway === 'service' || entity2.tags.highway === 'service';
      const isPath = isPathHighway(entity1.tags.highway) || isPathHighway(entity2.tags.highway);
      // Only significant roads get the `aeroway=aircraft_crossing` tag
      return (isService || isPath) ? {} : { aeroway: 'aircraft_crossing' };

    } else if (crossingType === 'aeroway-railway') {
      return { aeroway: 'aircraft_crossing', railway: 'level_crossing' };

    } else if (crossingType === 'aeroway-waterway') {
      return null;  // not allowed

    } else if (crossingType === 'highway-highway') {
      const entity1IsPath = isPathHighway(entity1.tags.highway);
      const entity2IsPath = isPathHighway(entity2.tags.highway);

      // One feature is a path but not both
      if ((entity1IsPath || entity2IsPath) && entity1IsPath !== entity2IsPath) {
        const road = entity1IsPath ? entity2 : entity1;

        // No crossing suggestion in some situations
        if (!bothLines || road.tags.highway === 'track') {
          return {};  // allowed, no tag suggestion
        }

        // Suggest joining them with a `highway=crossing` node.
        // We'll run the `actionsyncCrossingTags` afterwards to make sure the tags are synced.
        return { highway: 'crossing' };

      } else {      // road-road or path-path
        return {};  // allowed, no tag suggestion
      }

    } else if (crossingType === 'highway-railway') {
      if (!bothLines) {
        return {};  // allowed, no tag suggestion
      }

      const isTram = entity1.tags.railway === 'tram' || entity2.tags.railway === 'tram';
      const isPath = isPathHighway(entity1.tags.highway) || isPathHighway(entity2.tags.highway);

      if (isPath) {
        if (isTram) {
          return { railway: 'tram_crossing' };  // path-tram connections use this tag
        } else {
          return { railway: 'crossing' };       // other path-rail connections use this tag
        }
      } else {
        if (isTram) {
          return { railway: 'tram_level_crossing' };  // road-tram connections use this tag
        } else {
          return { railway: 'level_crossing' };       // other road-rail connections use this tag
        }
      }

    } else if (crossingType === 'highway-waterway') {
      // Do not suggest fords on structures
      if (hasTag(entity1.tags.tunnel) && hasTag(entity2.tags.tunnel)) return null;
      if (hasTag(entity1.tags.bridge) && hasTag(entity2.tags.bridge)) return null;

      // Do not suggest fords on major highways (secondry and higher)
      if (disallowFord.has(entity1.tags.highway) || disallowFord.has(entity2.tags.highway)) {
        return null;
      }
      return bothLines ? { ford: 'yes' } : {};

    } else if (crossingType === 'railway-railway') {
      return {};  // allowed, no tag suggestion

    } else if (crossingType === 'railway-waterway') {
      return null;  // not allowed

    } else if (crossingType === 'waterway-waterway') {
      return {};  // allowed, no tag suggestion
    }

    return null;
  }


  /**
   * Finds locations where a way's segments intersect segments of other ways.
   * @param way1 - The way to check
   * @param graph - The current graph
   * @param tree - The spatial index tree
   * @returns Array of crossing details
   */
  function detectCandidateCrossings(way1: OsmWay, graph: Graph, tree: any): CrossingInfo[] {
    if (way1.type !== 'way') return [];

    const entity1 = getTaggedEntityForWay(way1, graph);
    const tags1 = entity1.tags;
    const type1 = getFeatureType(entity1, graph);
    if (type1 === null) return [];

    const seenWayIDs = new Set<EntityID>();
    const crossings: CrossingInfo[] = [];
    const way1Nodes = graph.childNodes(way1);

    for (let i = 0; i < way1Nodes.length - 1; i++) {
      const n1 = way1Nodes[i];
      const n2 = way1Nodes[i + 1];
      const extent = new Extent(
        [ Math.min(n1.loc![0], n2.loc![0]), Math.min(n1.loc![1], n2.loc![1]) ],
        [ Math.max(n1.loc![0], n2.loc![0]), Math.max(n1.loc![1], n2.loc![1]) ]
      );

      // Optimize by only checking overlapping segments, not every segment of overlapping ways
      const segments = tree.waySegments(extent, graph);

      for (const segment of segments) {
        // Don't check for self-intersection in this validation
        if (segment.wayId === way1.id) continue;

        // Skip if this way was already checked and only one issue is needed
        if (seenWayIDs.has(segment.wayId)) continue;

        const way2 = graph.hasEntity(segment.wayId) as OsmWay | undefined;
        if (!way2) continue;

        const entity2 = getTaggedEntityForWay(way2, graph);
        const type2 = getFeatureType(entity2, graph);
        const tags2 = entity2.tags;
        if (type2 === null || isLegitCrossing(tags1, type1, tags2, type2)) continue;

        const nAId = segment.nodes[0];
        const nBId = segment.nodes[1];

        // n1 or n2 is a connection node; skip
        if (nAId === n1.id || nAId === n2.id || nBId === n1.id || nBId === n2.id) continue;

        const nA = graph.hasEntity(nAId);
        const nB = graph.hasEntity(nBId);
        if (!nA || !nB) continue;

        const line1 = [n1.loc!, n2.loc!];
        const line2 = [(nA as OsmNode).loc!, (nB as OsmNode).loc!];
        const point = geomLineIntersection(line1, line2);

        if (point) {
          crossings.push({
            wayInfos: [
              {
                way: way1,
                featureType: type1,
                edge: [n1.id, n2.id]
              }, {
                way: way2,
                featureType: type2,
                edge: [nA.id, nB.id]
              }
            ],
            crossPoint: point
          });

          // create only one issue for building crossings
          const oneOnly = (type1 === 'building' || type2 === 'building');
          if (oneOnly) {
            seenWayIDs.add(way2.id);
            break;
          }
        }
      }
    }

    return crossings;
  }


  /**
   * Creates a ValidationIssue for a detected crossing.
   * @param crossing - The crossing details
   * @param graph - The current graph
   * @returns A validation issue with appropriate fixes
   */
  function createIssue(crossing: CrossingInfo, graph: Graph): ValidationIssue {
    // use the entities with the tags that define the feature type
    crossing.wayInfos.sort((way1Info: WayInfo, way2Info: WayInfo) => {
      const type1 = way1Info.featureType;
      const type2 = way2Info.featureType;
      if (type1 === type2) {
        return l10n.displayLabel(way1Info.way, graph) > l10n.displayLabel(way2Info.way, graph) ? 1 : -1;
      } else if (type1 === 'waterway') {
        return 1;
      } else if (type2 === 'waterway') {
        return -1;
      }
      return type1 < type2 ? -1 : 1;
    });

    const entities = crossing.wayInfos.map((wayInfo: WayInfo) => getTaggedEntityForWay(wayInfo.way, graph));
    const [entity1, entity2] = entities;

    const tags1 = entity1.tags;
    const tags2 = entity2.tags;
    const type1 = crossing.wayInfos[0].featureType;
    const type2 = crossing.wayInfos[1].featureType;
    const geom1 = entity1.geometry(graph);
    const geom2 = entity2.geometry(graph);

    const edges = [crossing.wayInfos[0].edge, crossing.wayInfos[1].edge];
    const featureTypes = [type1, type2];

    const connectionTags = getConnectionTags(entity1, entity2, graph);

    const isCrossingIndoors = taggedAsIndoor(tags1) && taggedAsIndoor(tags2);

    const bridge1 = allowBridge.has(type1) && hasTag(tags1.bridge);
    const bridge2 = allowBridge.has(type2) && hasTag(tags2.bridge);
    const isCrossingBridges = bridge1 && bridge2;

    const tunnel1 = allowTunnel.has(type1) && hasTag(tags1.tunnel);
    const tunnel2 = allowTunnel.has(type2) && hasTag(tags2.tunnel);
    const isCrossingTunnels = tunnel1 && tunnel2;

    const isMinorCrossing = (tags1.highway === 'service' || tags2.highway === 'service') &&
      connectionTags?.highway === 'crossing';

    // If we are trying to create a crossing node, and one of the crossing ways is already a tagged crossing,
    // sync that parent way's tags to the new crossing node that we are creating - Rapid#1271
    let crossingWayID: EntityID | null = null;
    if (connectionTags?.highway === 'crossing') {
      if (isCrossingWay(tags1)) {
        crossingWayID = entity1.id;
      } else if (isCrossingWay(tags2)) {
        crossingWayID = entity2.id;
      }
    }

    const subtype = [type1, type2].sort().join('-');

    let crossingTypeID = subtype;

    if (isCrossingIndoors) {
      crossingTypeID = 'indoor-indoor';
    } else if (isCrossingTunnels) {
      crossingTypeID = 'tunnel-tunnel';
    } else if (isCrossingBridges) {
      crossingTypeID = 'bridge-bridge';
    }
    if (connectionTags && (isCrossingIndoors || isCrossingTunnels || isCrossingBridges)) {
      crossingTypeID += '_connectable';
    }

    // Differentiate based on the loc rounded to 4 digits, since two ways can cross multiple times.
    const uniqueID = '' + crossing.crossPoint[0].toFixed(4) + ',' + crossing.crossPoint[1].toFixed(4);

    // Support autofix for some kinds of connections
    let autoArgs: any = null;
    if (isMinorCrossing) {
      autoArgs = getConnectWaysAction(crossing.crossPoint, edges, null, {});  // untagged connection
    } else if (connectionTags && !connectionTags.ford) {
      autoArgs = getConnectWaysAction(crossing.crossPoint, edges, crossingWayID, connectionTags); // suggested tagged connection
    }

    return new ValidationIssue(context, {
      type: type,
      subtype: subtype,
      severity: 'warning',
      message: function(this: any) {
        const graph = editor.staging.graph;
        const entity1 = graph.hasEntity(this.entityIds[0]);
        const entity2 = graph.hasEntity(this.entityIds[1]);
        return (entity1 && entity2) ? l10n.t('issues.crossing_ways.message', {
          feature: l10n.displayLabel(entity1, graph),
          feature2: l10n.displayLabel(entity2, graph)
        }) : '';
      },
      reference: showReference,
      entityIds: [ entity1.id, entity2.id ],
      data: {
        edges: edges,
        featureTypes: featureTypes,
        crossingWayID: crossingWayID,
        connectionTags: connectionTags
      },
      hash: uniqueID,
      loc: crossing.crossPoint,
      autoArgs: autoArgs,
      dynamicFixes: function(this: any) {
        const selectedIDs = context.selectedIDs();
        if (context.mode?.id !== 'select-osm' || selectedIDs.length !== 1) return [];

        const selectedIndex = this.entityIds[0] === selectedIDs[0] ? 0 : 1;
        const selectedType = this.data.featureTypes[selectedIndex];
        const otherType = this.data.featureTypes[selectedIndex === 0 ? 1 : 0];
        const fixes = [];

        // For crossings between sidewalk and service road, offer an untagged connection fix - iD#9650, iD#8463
        if (isMinorCrossing) {
          fixes.push(makeConnectWaysFix({}));
        }

        if (connectionTags) {
          fixes.push(makeConnectWaysFix(connectionTags));
        }

        if (isCrossingIndoors) {
          fixes.push(new ValidationFix({
            icon: 'rapid-icon-layers',
            title: l10n.t('issues.fix.use_different_levels.title')
          }));

        } else if (isCrossingTunnels || isCrossingBridges || type1 === 'building' || type2 === 'building')  {
          fixes.push(makeChangeLayerFix('higher'));
          fixes.push(makeChangeLayerFix('lower'));

        // only suggest bridge/tunnel if both features are lines
        } else if (geom1 === 'line' && geom2 === 'line') {
          // don't recommend adding bridges to waterways since they're uncommon
          if (allowBridge.has(selectedType) && selectedType !== 'waterway') {
            fixes.push(makeAddBridgeOrTunnelFix('add_a_bridge', 'temaki-bridge', 'bridge'));
          }
          // don't recommend adding tunnels under waterways since they're uncommon
          const skipTunnelFix = otherType === 'waterway' && selectedType !== 'waterway';
          if (allowTunnel.has(selectedType) && !skipTunnelFix) {
            fixes.push(makeAddBridgeOrTunnelFix('add_a_tunnel', 'temaki-tunnel', 'tunnel'));
          }
        }

        // repositioning the features is always an option
        fixes.push(new ValidationFix({
          icon: 'rapid-operation-move',
          title: l10n.t('issues.fix.reposition_features.title')
        }));

        return fixes;
      }
    });

    /**
     *
     * @param $selection
     */
    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t(`issues.crossing_ways.${crossingTypeID}.reference`));
    }
  }


  /**
   * Creates a fix to add a bridge or tunnel structure over/under cross traffic.
   * @param titleID - The localization key suffix for the fix title
   * @param iconName - The icon identifier
   * @param bridgeOrTunnel - `'bridge'` or `'tunnel'`
   * @returns A validation fix
   */
  function makeAddBridgeOrTunnelFix(titleID: string, iconName: string, bridgeOrTunnel: string): ValidationFix {
    return new ValidationFix({
      icon: iconName,
      title: l10n.t(`issues.fix.${titleID}.title`),
      onClick: function(this: any) {
        if (context.mode?.id !== 'select-osm') return;

        const selectedIDs = context.selectedIDs();
        if (selectedIDs.length !== 1) return;

        const selectedWayID = selectedIDs[0];
        const graph = editor.staging.graph;
        if (!graph.hasEntity(selectedWayID)) return;

        const resultWayIDs: EntityID[] = [selectedWayID];

        const selectedIsFirst = (this.issue.entityIds[0] === selectedWayID);
        const edge = this.issue.data.edges[selectedIsFirst ? 0 : 1] as [EntityID, EntityID];
        const crossedEdge = this.issue.data.edges[selectedIsFirst ? 1 : 0] as [EntityID, EntityID];
        const crossedWayID = this.issue.entityIds[selectedIsFirst ? 1 : 0] as EntityID;

        const crossingLoc = this.issue.loc;

        /**
         * An Action that splits the crossed way around the crossed edge nodes,
         * and tags the middle segment with appropriate "bridge" or "tunnel" tagging.
         * @param   graph - input graph
         * @return  graph - modified graph
         */
        const actionAddStructure = (graph: Graph): Graph => {
          // Gather the entities involved.
          const edgeNode0 = graph.hasEntity(edge[0]) as OsmNode;
          const edgeNode1 = graph.hasEntity(edge[1]) as OsmNode;
          const crossedNode0 = graph.hasEntity(crossedEdge[0]) as OsmNode;
          const crossedNode1 = graph.hasEntity(crossedEdge[1]) as OsmNode;

          const crossedWay = graph.hasEntity(crossedWayID) as OsmWay;
          if (!edgeNode0 || !edgeNode1 || !crossedNode0 || !crossedNode1 || !crossedWay) return graph;

          // World coordinates of the nodes involved.
          const edge0 = edgeNode0.geoms.parts[0].world?.coords as Vec2;
          const edge1 = edgeNode1.geoms.parts[0].world?.coords as Vec2;
          const crossed0 = crossedNode0.geoms.parts[0].world?.coords as Vec2;
          const crossed1 = crossedNode1.geoms.parts[0].world?.coords as Vec2;
          if (!edge0 || !edge1 || !crossed0 || !crossed1) return graph;


          // Use 'width' tag of the crossed feature if available, otherwise use the implied width.
          const explicitWidth = parseFloat(crossedWay.tags.width ?? '');
          let structLengthMeters = Number.isFinite(explicitWidth) && explicitWidth > 0 ? explicitWidth :
            (crossedWay.impliedLineWidthMeters() || 0);
          if (structLengthMeters) {
            if (getFeatureType(crossedWay, graph) === 'railway') {  // bridges over railways..
              structLengthMeters *= 2;   // generally much longer than the rail bed itself, compensate.
            }
          } else {  // Should ideally never land here, `impliedLineWidthMeters` should return something.
            structLengthMeters = 8;
          }

          const a1 = vecAngle(edge0, edge1) + Math.PI;
          const a2 = vecAngle(crossed0, crossed1) + Math.PI;
          let crossingAngle = Math.max(a1, a2) - Math.min(a1, a2);
          if (crossingAngle > Math.PI) crossingAngle -= Math.PI;
          // lengthen the structure to account for the angle of the crossing
          structLengthMeters = ((structLengthMeters / 2) / Math.sin(crossingAngle)) * 2;

          // add padding since the structure must extend past the edges of the crossed feature
          structLengthMeters += 4;

          // clamp the length to a reasonable range
          structLengthMeters = Math.min(Math.max(structLengthMeters, 4), 50);

          const edgeWorldLength = vecLength(edge0, edge1);
          if (!edgeWorldLength) return graph;

          const edgeWorldDirection: Vec2 = [
            (edge1[0] - edge0[0]) / edgeWorldLength,
            (edge1[1] - edge0[1]) / edgeWorldLength
          ];
          const worldUnitsPerSphericalMeter = edgeWorldLength /
            geoSphericalDistance(edgeNode0.loc!, edgeNode1.loc!);

          const crossingWorld = projWgs84ToWorld(crossingLoc) as Vec2;
          const projectedCrossing = vecProject(crossingWorld, [edge0, edge1]);
          if (!projectedCrossing) return graph;
          const projectedCrossingPoint = projectedCrossing.point;

          /**
           *
           * @param directionSign
           * @param distanceMeters
           */
          function locDistanceFromCrossingLoc(directionSign: -1 | 1, distanceMeters: number): Vec2 {
            const worldDistance = distanceMeters * worldUnitsPerSphericalMeter;
            return projWorldToWgs84([
              projectedCrossingPoint[0] + directionSign * edgeWorldDirection[0] * worldDistance,
              projectedCrossingPoint[1] + directionSign * edgeWorldDirection[1] * worldDistance
            ] as Vec2);
          }

          const endpointLocGetter1 = (lengthMeters: number): Vec2 => locDistanceFromCrossingLoc(1, lengthMeters);
          const endpointLocGetter2 = (lengthMeters: number): Vec2 => locDistanceFromCrossingLoc(-1, lengthMeters);

          // avoid creating very short edges from splitting too close to another node
          const minEdgeLengthMeters = 0.55;

          /**
           *
           * @param node
           */
          function countIncidentEdges(node: OsmNode): number {
            let edgeCount = 0;

            for (const way of node.parentIntersectionWays(graph) as OsmWay[]) {
              for (const nodeID of way.nodes) {
                if (nodeID !== node.id) continue;

                if ((node.id === way.first() && node.id !== way.last()) ||
                  (node.id === way.last() && node.id !== way.first())) {
                  edgeCount += 1;
                } else {
                  edgeCount += 2;
                }
              }
            }

            return edgeCount;
          }

          // decide where to bound the structure along the way, splitting as necessary
          /**
           *
           * @param edgeToSplit
           * @param endNode
           * @param locGetter
           */
          function determineEndpoint(edgeToSplit: [EntityID, EntityID], endNode: OsmNode, locGetter: (len: number) => Vec2): OsmNode {
            let newNode: OsmNode | undefined;
            const idealLengthMeters = structLengthMeters / 2;

            // distance between the crossing location and the end of the edge,
            // the maximum length of this side of the structure
            const crossingToEdgeEndDistance = geoSphericalDistance(crossingLoc, endNode.loc!);
            if (crossingToEdgeEndDistance - idealLengthMeters > minEdgeLengthMeters) {
              // the edge is long enough to insert a new node
              // the loc that would result in the full expected length
              const idealNodeLoc = locGetter(idealLengthMeters);
              newNode = new OsmNode(context);
              graph = actionAddMidpoint({ loc: idealNodeLoc, edge: edgeToSplit } as Midpoint, newNode)(graph);

            } else {
              const edgeCount = countIncidentEdges(endNode);
              if (edgeCount >= 3) {
                // the end node is a junction, try to leave a segment
                // between it and the structure - iD#7202
                const insetLength = crossingToEdgeEndDistance - minEdgeLengthMeters;
                if (insetLength > minEdgeLengthMeters) {
                  const insetNodeLoc = locGetter(insetLength);
                  newNode = new OsmNode(context);
                  graph = actionAddMidpoint({ loc: insetNodeLoc, edge: edgeToSplit } as Midpoint, newNode)(graph);
                }
              }
            }

            // if the edge is too short to subdivide as desired, then
            // just bound the structure at the existing end node
            if (!newNode) newNode = endNode;

            const splitAction = actionSplit([newNode.id])
              .limitWays(resultWayIDs); // only split selected or created ways

            // do the split
            graph = splitAction(graph);
            if (splitAction.getCreatedWayIDs().length) {
              resultWayIDs.push(splitAction.getCreatedWayIDs()[0]);
            }

            return newNode;
          }

          const structEndNode1 = determineEndpoint(edge, edgeNode1, endpointLocGetter1);
          const structEndNode2 = determineEndpoint([edgeNode0.id, structEndNode1.id], edgeNode0, endpointLocGetter2);

          const structureWay = resultWayIDs
            .map(id => graph.entity(id))
            .find(way => (way as OsmWay).nodes.includes(structEndNode1.id) && (way as OsmWay).nodes.includes(structEndNode2.id)) as OsmWay;

          const tags = { ...structureWay.tags };  // copy tags
          if (bridgeOrTunnel === 'bridge') {
            tags.bridge = 'yes';
            tags.layer = '1';
          } else {
            const type = getFeatureType(structureWay, graph);   // use `tunnel=culvert` for waterways by default
            tags.tunnel = (type === 'waterway') ? 'culvert' : 'yes';
            tags.layer = '-1';
          }
          // apply the structure tags to the way
          graph = actionChangeTags(structureWay.id, tags)(graph);
          return graph;
        };

        editor.perform(actionAddStructure);
        editor.commit({
          annotation: l10n.t(`issues.fix.${titleID}.annotation`),
          selectedIDs: [selectedWayID]
        });
        context.enter('select-osm', { selection: { osm: resultWayIDs }} );
      }
    });
  }


  /**
   * Builds an action to connect crossing ways at a location, inserting
   * or merging a connection node along the relevant edges.
   * @param loc - The [lon, lat] location for the connection
   * @param edges - Edge pairs that participate in the connection
   * @param crossingWayID - Optionally, a way whose crossing tags should be synced
   * @param tags - Tags to assign to the new connection node
   * @returns A `[action, annotation]` tuple
   */
  function getConnectWaysAction(loc: Vec2, edges: [EntityID, EntityID][], crossingWayID: EntityID | null, tags: OsmTags): any[] {

    const actionConnectCrossingWays = (graph: Graph): Graph => {
      // Create a new candidate junction node which will be inserted at the connection location..
      const newNode = new OsmNode(context, { loc: loc, tags: tags });
      graph = graph.replace(newNode);

      const mergeNodeIDs: EntityID[] = [newNode.id];
      const mergeThresholdInMeters = 0.75;

      // Insert the new node along the edges (or reuse one already there)..
      for (const edge of edges) {
        const n0 = graph.hasEntity(edge[0]) as OsmNode | undefined;
        const n1 = graph.hasEntity(edge[1]) as OsmNode | undefined;
        if (!n0 || !n1) continue;  // graph has changed and these nodes are no longer there?

        // Look for a suitable existing node nearby to reuse..
        let canReuse = false;
        const edgeNodes = [n0, n1];
        const closest = geoSphericalClosestPoint([n0.loc!, n1.loc!], loc);
        if (closest && closest.distance < mergeThresholdInMeters) {
          const closeNode = edgeNodes[closest.index];
          // Reuse the close node if it has no interesting tags or if it is already a crossing - iD#8326
          if (!closeNode.hasInterestingTags() || isCrossingNode(closeNode.tags)) {
            canReuse = true;
            mergeNodeIDs.push(closeNode.id);
          }
        }

        if (!canReuse) {
          graph = actionAddMidpoint({ loc, edge } as Midpoint, newNode)(graph);  // Insert the new node
        }
      }

      // If we're reusing nearby nodes, merge them with the new node.
      if (mergeNodeIDs.length > 1) {
        graph = actionMergeNodes(mergeNodeIDs, loc)(graph);
      }

      // If the parent way is tagged as a crossing, sync its crossing tags to the node we just added.
      if (crossingWayID) {
        graph = actionSyncCrossingTags(crossingWayID)(graph);
      }

      return graph;
    };

    return [actionConnectCrossingWays, l10n.t('issues.fix.connect_crossing_features.annotation')];
  }


  /**
   * Creates a fix to connect the crossing ways at their intersection.
   * @param connectionTags - Tags to assign to the new connection node
   * @returns A validation fix
   */
  function makeConnectWaysFix(connectionTags: OsmTags): ValidationFix {
    let titleID = 'connect_features';
    let iconID = 'rapid-icon-connect';

    if (connectionTags.ford) {
      titleID = 'connect_using_ford';
    } else if (connectionTags.highway === 'crossing') {
      titleID = 'connect_using_crossing';
      iconID = 'temaki-pedestrian';
    }

    return new ValidationFix({
      icon: iconID,
      title: l10n.t(`issues.fix.${titleID}.title`),
      onClick: function(this: any) {
        const loc = this.issue.loc;
        const edges = this.issue.data.edges;
        const crossingWayID = this.issue.data.crossingWayID;
        const [action, annotation] = getConnectWaysAction(loc, edges, crossingWayID, connectionTags);

        // result contains [function, annotation]
        editor.perform(action);
        editor.commit({
          annotation: annotation,
          selectedIDs: this.issue.entityIds
        });
      }
    });
  }


  /**
   * Creates a fix to change the layer tag of the selected feature.
   * @param higherOrLower - `'higher'` or `'lower'`
   * @returns A validation fix
   */
  function makeChangeLayerFix(higherOrLower: string): ValidationFix {
    return new ValidationFix({
      icon: 'rapid-icon-' + (higherOrLower === 'higher' ? 'up' : 'down'),
      title: l10n.t(`issues.fix.tag_this_as_${higherOrLower}.title`),
      onClick: function(this: any) {
        if (context.mode?.id !== 'select-osm') return;

        const selectedIDs = context.selectedIDs();
        if (selectedIDs.length !== 1) return;

        const selectedID = selectedIDs[0];
        if (!this.issue.entityIds.some((entityID: EntityID) => entityID === selectedID)) return;

        const graph = editor.staging.graph;
        const entity = graph.hasEntity(selectedID);
        if (!entity) return;

        const tags = { ...entity.tags };   // shallow copy
        let layer = tags.layer && Number(tags.layer);
        if (layer && !isNaN(layer)) {
          if (higherOrLower === 'higher') {
            layer += 1;
          } else {
            layer -= 1;
          }
        } else {
          if (higherOrLower === 'higher') {
            layer = 1;
          } else {
            layer = -1;
          }
        }
        tags.layer = layer.toString();
        editor.perform(actionChangeTags(entity.id, tags));
        editor.commit({
          annotation: l10n.t('operations.change_tags.annotation'),
          selectedIDs: [selectedID]
        });
      }
    });
  }


  validator.type = type;
  return validator;
}
