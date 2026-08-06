import { actionAddMidpoint, actionChangeTags, actionSplit} from '../actions/index.ts';
import { geoLatToMeters, geoLonToMeters, geoMetersToLat, geoMetersToLon } from '@rapid-sdk/math';
import { OsmNode } from '../data/OsmNode.ts';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';
import { uiIcon } from '../ui/icon.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { Midpoint } from '../actions/add_midpoint.ts';
import type { OsmEntity, OsmTags, OsmWay } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting crossing ways that are
 * missing curb (kerb) nodes at their endpoints. Suggests adding curb nodes
 * with various curb types (flush, lowered, raised).
 * @param context
 * @returns Validator function
 */
export function validateCurbNodes(context: Context): ValidatorFunction {
  const type = 'curb_nodes' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;


  /**
   * Checks the given entity for missing curb nodes on crossing ways.
   * @param entity - The entity to validate
   * @param graph - The graph we are validating
   * @returns Result object containing issues detected
   */
  const validator = function checkCurbNodes(entity: OsmEntity, graph: Graph): ValidatorResult {
    const result: ValidatorResult = { issues: [] };
    if (entity.type !== 'way' || entity.isDegenerate()) return result;

    result.issues = detectCurbCandidates(entity as OsmWay, graph);
    return result;
  };


  /**
   * Tests whether the given tags describe a crossing way.
   * @param tags - The tags to check
   * @returns `true` if the way has crossing tags
   */
  const isCrossingWay = (tags: OsmTags): boolean => {
    return (tags.highway === 'footway' && tags.footway === 'crossing') ||
      (tags.highway === 'cycleway' && tags.cycleway === 'crossing');
  };


  /**
   * Detects crossing ways that are missing curb nodes.
   * @param way - The way to validate
   * @param graph - The graph we are validating
   * @returns Array of validation issues
   */
  const detectCurbCandidates = (way: OsmWay, graph: Graph): ValidationIssue[] => {
    const issues: ValidationIssue[] = [];
    const wayID = way.id;
    if (!hasRoutableTags(way) || !isCrossingWay(way.tags)) return issues;

    // Check all nodes in the way for curb tags
    for (const nodeId of way.nodes) {
      const node = graph.entity(nodeId) as OsmNode;
      if (hasCurbTag(node)) {
        // If any node has a curb tag, skip this way as a candidate
        return issues;
      }
    }
    // If no curb nodes are found, suggest adding curbs
    issues.push(new ValidationIssue(context, {
      type,
      subtype: 'missing_curb_nodes',
      severity: 'suggestion',
      message: () => way ? l10n.t('issues.curb_nodes.message', { feature: l10n.displayLabel(way, graph) }) : '',
      reference: showReference,
      entityIds: [wayID],
      data: { crossingWayID: wayID },
      dynamicFixes: () => ['yes', 'flush', 'lowered', 'raised'].map(type => {
        const tags = { barrier: 'kerb', kerb: type };
        const iconID = getIconForCurbNode(tags);
        return new ValidationFix({
          icon: iconID,
          title: l10n.t('issues.curb_nodes.fix.add_curb_nodes', { type: l10n.t(`issues.curb_nodes.type.${type}`) }),
          onClick: () => {
            performCurbNodeFixes(wayID, tags);
            editor.commit({
              annotation: l10n.t('issues.curb_nodes.fix.annotation'),
              selectedIDs: [wayID]
            });
          }
        });
      })
    }));
    return issues;
  };


  /**
   * Tests whether the way has tags that make it routable.
   * @param way - The way to check
   * @returns `true` if the way has highway or cycleway tags
   */
  function hasRoutableTags(way: OsmWay): boolean {
    const routableTags = ['highway', 'cycleway'];
    return way.isArea() ? false : routableTags.some(tag => way.tags[tag]);
  }


  /**
   * Renders the issue reference text and wiki link into the given selection.
   * @param $selection - The D3 selection to append the reference to
   */
  function showReference($selection: D3Selection): void {
    const $$reference = $selection.selectAll('.issue-reference')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'issue-reference');

    $$reference
      .append('span')
      .text(l10n.t('issues.curb_nodes.reference.text'));

    $$reference
      .append('br');

    const $$link = $$reference
      .append('a')
      .attr('href', l10n.t('issues.curb_nodes.reference.link_url'))
      .attr('target', '_blank')
      .attr('title', l10n.t('issues.curb_nodes.reference.link_alt_text'))
      .call(uiIcon('#rapid-icon-out-link', 'inline'));

    $$link
      .append('span')
      .text(l10n.t('issues.curb_nodes.reference.link_text'));
  }


  /**
   * Tests whether the node has curb-related tags.
   * @param node - The node to check
   * @returns `true` if the node has kerb or barrier=kerb tags
   */
  function hasCurbTag(node: OsmNode): boolean {
    const tags = node.tags;
    return !!tags.kerb || tags.barrier === 'kerb';
  }


  /**
   * Adds curb nodes at the endpoints of a crossing way, either by
   * converting existing endpoints or inserting new nodes.
   * @param wayID - The ID of the crossing way to modify
   * @param tags - The curb tags to assign to new/modified nodes
   */
  function performCurbNodeFixes(wayID: EntityID, tags: OsmTags): void {
    const graph = editor.staging.graph;
    const way = graph.hasEntity(wayID) as OsmWay;
    if (!way) {
      console.error('Way not found:', wayID);  // eslint-disable-line no-console
      return;
    }

    const firstNode = graph.entity(way.first()!) as OsmNode;
    const lastNode = graph.entity(way.last()!) as OsmNode;
    const firstConnections = graph.parentWays(firstNode).filter(parent => parent.id !== wayID);
    const lastConnections = graph.parentWays(lastNode).filter(parent => parent.id !== wayID);
    const firstConnectsToRefugeIsland = firstConnections.some(parent => isRefugeIsland(parent));
    const lastConnectsToRefugeIsland = lastConnections.some(parent => isRefugeIsland(parent));

    // Handle the first node
    if (!firstConnections.length || firstConnectsToRefugeIsland) {
      updateNodeToCurb(firstNode, tags, graph);
    } else {
      insertCurbNode(firstNode, way, graph, tags);
    }

    // Handle the last node
    if (!lastConnections.length || lastConnectsToRefugeIsland) {
      updateNodeToCurb(lastNode, tags, graph);
    } else {
      insertCurbNode(lastNode, way, graph, tags);
    }
  }


  /**
   * Inserts a curb node into a way by splitting at a position near an existing node.
   * Used when the endpoint is connected to other ways and shouldn't be converted directly.
   * @param node - The existing node near where the curb should be added
   * @param way - The way to modify
   * @param graph - The current graph
   * @param curbTags - The curb tags to assign to the new node
   */
  function insertCurbNode(node: OsmNode, way: OsmWay, graph: Graph, curbTags: OsmTags): void {
    if (hasCurbTag(node)) return;  // Exit if curb already exists

    // Calculate the position for the new curb node
    const nodeIndex = way.nodes.indexOf(node.id);
    const adjacentNode = graph.entity(way.nodes[nodeIndex + 1] || way.nodes[nodeIndex - 1]) as OsmNode;
    const newNodePosition = calculateNewNodePosition(node, adjacentNode, 1);

    // Find connected ways and select the appropriate tags
    const connectedWays = graph.parentWays(node);
    let connectedWayTags = null;
    for (const connectedWay of connectedWays) {
      if (connectedWay.id !== way.id && !isCrossingWay(connectedWay.tags)) {
        connectedWayTags = connectedWay.tags;
        break;
      }
    }
    // Check if connectedWayTags is null and set default to "sidewalk"
    if (connectedWayTags === null) {
      connectedWayTags = { highway: 'footway' };
    }
    if (!newNodePosition) return;
    const newCurbNode = new OsmNode(context, {
      loc: [newNodePosition.lon, newNodePosition.lat],
      tags: curbTags,
      visible: true
    });
    // Add the new node to the graph
    editor.perform(actionAddMidpoint({ loc: newCurbNode.loc!, edge: [node.id, adjacentNode.id] } as Midpoint, newCurbNode));

    // Perform the split
    const splitAction = actionSplit([newCurbNode.id]);
    editor.perform(splitAction);

    const newWayIDs = splitAction.getCreatedWayIDs();
    if (newWayIDs.length > 0) {
      for (const wayID of newWayIDs) {
        editor.perform(actionChangeTags(wayID, connectedWayTags));
      }
    } else {
      console.error('No new ways created after split');  // eslint-disable-line no-console
    }
  }


  /**
   * Converts an existing node into a curb node by adding kerb tags.
   * @param node - The node to update
   * @param tags - The curb tags to apply
   * @param graph - The current graph
   */
  function updateNodeToCurb(node: OsmNode, tags: OsmTags, graph: Graph): void {
    const newTags = { ...node.tags, barrier: 'kerb', kerb: tags.kerb };
    editor.perform(actionChangeTags(node.id, newTags));
  }


  /**
   * Tests whether the given way is a refuge island (traffic island).
   * @param way - The way to check
   * @returns `true` if the way is tagged as a traffic island
   */
  function isRefugeIsland(way: OsmWay): boolean {
    const isTrafficIsland = way.tags.footway === 'traffic_island';
    return isTrafficIsland;
  }


  /**
   * Calculates a new node position offset from a start node toward an end node.
   * @param startNode - The starting node
   * @param endNode - The ending node
   * @param distance - Distance in meters from the start node
   * @param isLast - If `true`, offsets in the opposite direction
   * @returns The calculated position, or `null` if it cannot be computed
   */
  function calculateNewNodePosition(startNode: OsmNode, endNode: OsmNode, distance: number, isLast: boolean = false): { lon: number; lat: number } | null {
    if (!startNode || !endNode) return null;
    if (!startNode.loc || !endNode.loc) return null;

    const startLatMeters = geoLatToMeters(startNode.loc[1]);
    const startLonMeters = geoLonToMeters(startNode.loc[0], startNode.loc[1]);
    const endLatMeters = geoLatToMeters(endNode.loc[1]);
    const endLonMeters = geoLonToMeters(endNode.loc[0], endNode.loc[1]);

    const dxMeters = endLonMeters - startLonMeters;
    const dyMeters = endLatMeters - startLatMeters;
    const lengthMeters = Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);

    if (lengthMeters === 0) {
      return null;
    }

    const scale = distance / lengthMeters;
    const directionMultiplier = isLast ? -1 : 1;
    const newXMeters = startLonMeters + dxMeters * scale * directionMultiplier;
    const newYMeters = startLatMeters + dyMeters * scale * directionMultiplier;

    const newPosition = {
      lon: geoMetersToLon(newXMeters, geoMetersToLat(newYMeters)),
      lat: geoMetersToLat(newYMeters)
    };

    return newPosition;
  }


  /**
   * Returns the appropriate icon ID for a curb node based on its curb type.
   * @param tags - The curb node tags
   * @returns The icon identifier string
   */
  function getIconForCurbNode(tags: OsmTags): string {
    const val = tags.kerb || '';
    if (['flush', 'lowered', 'raised', 'rolled'].includes(val)) {
      return `temaki-kerb-${val}`;
    } else {
      return 'temaki-kerb-unspecified';
    }
  }


  validator.type = type;
  return validator;
}
