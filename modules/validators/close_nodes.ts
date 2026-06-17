import { actionMergeNodes } from '../actions/merge_nodes.ts';
import { Extent, projWgs84ToWorld, geoSphericalDistance } from '@rapid-sdk/math';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';
import type { Vec2 } from '@rapid-sdk/math';


type WayType = 'boundary' | 'indoor' | 'building' | 'path' | 'other';


/**
 * Factory that creates a validator for detecting nodes that are very close
 * together — either adjacent vertices within a way, or nearby detached points.
 * @param context
 * @returns Validator function
 */
export function validateCloseNodes(context: Context): ValidatorFunction {
  const type = 'close_nodes' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const schema = context.systems.schema;
  const spatial = context.systems.spatial!;

  const pointThresholdMeters = 0.2;

  // helpers
  /**
   * Tests whether a tag value is defined and not `'no'`.
   * @param v
   */
  function hasTag(v: string | undefined): boolean {
    return v !== undefined && v !== 'no';
  }


  /**
   * Checks for close nodes on the entity — dispatching to vertex or
   * detached point checks as appropriate.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Result object containing issues detected
   */
  const validator = function checkCloseNodes(entity: OsmEntity, graph: Graph): ValidatorResult {
    const result: ValidatorResult = { issues: [] };
    if (!schema) return result;

    if (entity.type === 'node') {
      const parentWays = graph.parentWays(entity);
      if (parentWays.length) {
        result.issues = getIssuesForVertex(entity as OsmNode, parentWays);
      } else {
        result.issues = getIssuesForPoint(entity as OsmNode);
      }
    } else if (entity.type === 'way') {
      result.issues = getIssuesForWay(entity as OsmWay);
    }
    return result;


    /**
     * Classifies a way by its primary type.
     * The result is used to choose a distance threshold for how close the nodes may be.
     * @param way - The way to classify
     * @returns The way type category
     */
    function wayTypeFor(way: OsmWay): WayType {
      const tags = way.tags;

      if (hasTag(tags.boundary)) return 'boundary';
      if (hasTag(tags.indoor)) return 'indoor';
      if (hasTag(tags.building) || hasTag(tags['building:part'])) return 'building';

      const pathHighway = schema!.getScope('osm').rulesets.get('path_highway');
      if (pathHighway?.match({ highway: tags.highway })) return 'path';

      const parentRelations = graph.parentRelations(way);
      for (const relation of parentRelations) {
        if (relation.tags.type === 'boundary') return 'boundary';
        if (relation.isMultipolygon()) {
          if (hasTag(relation.tags.indoor)) return 'indoor';
          if (hasTag(relation.tags.building) || hasTag(relation.tags['building:part'])) return 'building';
        }
      }

      return 'other';
    }


    /**
     * Tests whether a way should be checked for close nodes.
     * Skips ways that are too small or have too few nodes.
     * @param way - The way to check
     * @returns `true` if the way should be checked
     */
    function shouldCheckWay(way: OsmWay): boolean {
      // don't flag issues where merging would create degenerate ways
      if (way.nodes.length <= 2 || (way.isClosed() && way.nodes.length <= 4)) return false;

      // don't flag close nodes in very small ways
      const bbox = way.extent()!.bbox();
      const hypotenuseMeters = geoSphericalDistance([bbox.minX, bbox.minY], [bbox.maxX, bbox.maxY]);
      if (hypotenuseMeters < 1.5) return false;

      return true;
    }


    /**
     * Checks all adjacent node pairs in a way for closeness.
     * @param way - The way to check
     * @returns Array of close-node issues
     */
    function getIssuesForWay(way: OsmWay): ValidationIssue[] {
      if (!shouldCheckWay(way)) return [];

      const issues: ValidationIssue[] = [];
      const nodes = graph.childNodes(way);

      for (let i = 0; i < nodes.length - 1; i++) {
        const node1 = nodes[i];
        const node2 = nodes[i+1];
        const issue = getWayIssueIfAny(node1, node2, way);
        if (issue) {
          issues.push(issue);
        }
      }
      return issues;
    }


    /**
     * Checks a vertex's adjacent nodes in all parent ways for closeness.
     * @param node - The vertex node
     * @param parentWays - The parent ways of the node
     * @returns Array of close-node issues for this vertex
     */
    function getIssuesForVertex(node: OsmNode, parentWays: OsmWay[]): ValidationIssue[] {
      const issues: ValidationIssue[] = [];

      /**
       *
       * @param node1
       * @param node2
       * @param way
       */
      function checkForCloseness(node1: OsmNode, node2: OsmNode, way: OsmWay): void {
        const issue = getWayIssueIfAny(node1, node2, way);
        if (issue) {
          issues.push(issue);
        }
      }

      for (const parentWay of parentWays) {
        if (!shouldCheckWay(parentWay)) continue;

        const lastIndex = parentWay.nodes.length - 1;
        for (let j = 0; j < parentWay.nodes.length; j++) {
          if (j !== 0) {
            if (parentWay.nodes[j-1] === node.id) {
              checkForCloseness(node, graph.entity(parentWay.nodes[j]) as OsmNode, parentWay);
            }
          }
          if (j !== lastIndex) {
            if (parentWay.nodes[j+1] === node.id) {
              checkForCloseness(graph.entity(parentWay.nodes[j]) as OsmNode, node, parentWay);
            }
          }
        }
      }
      return issues;
    }


    /**
     * Returns the minimum distance threshold in meters for a way.
     * @param way - The way to get the threshold for
     * @returns Distance threshold in meters, or `0` to skip
     */
    function thresholdMetersForWay(way: OsmWay): number {
      if (!shouldCheckWay(way)) return 0;

      const wayType = wayTypeFor(way);

      // don't flag boundaries since they might be highly detailed and can't be easily verified
      if (wayType === 'boundary') return 0;

      // expect some features to be mapped with higher levels of detail
      if (wayType === 'indoor')   return 0.01;
      if (wayType === 'building') return 0.05;
      if (wayType === 'path')     return 0.1;

      return 0.2;
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


    /**
     * Checks a node for nearby other nodes within the threshold.
     * @param    node - The standalone point node
     * @returns  Array of close-node issues with nearby points
     */
    function getIssuesForPoint(node: OsmNode): ValidationIssue[] {
      const issues: ValidationIssue[] = [];

      const box = queryBox(node.loc!, pointThresholdMeters);
      const spatialID = editor.spatialIDForGraph(graph);
      const hits = spatial.getItemsAtBox(spatialID, box);

      const isNode1Stol = (node.tags['memorial:type'] === 'stolperstein' || node.tags['memorial'] === 'stolperstein');

      for (const hit of hits) {
        const other = hit.contents as OsmNode;
        if (other.id === node.id) continue;  // skip self
        if (other.type !== 'node' || other.geometry(graph) !== 'point') continue;   // standalone points only

        // Ignore stolperstein (https://wiki.openstreetmap.org/wiki/DE:Stolpersteine), they are expected to be close.
        const isNode2Stol = (other.tags['memorial:type'] === 'stolperstein' || other.tags['memorial'] === 'stolperstein');
        if (isNode1Stol && isNode2Stol) continue;

        // Allow very close points if tags indicate that they exist on different levels.
        const zAxisKeys = ['layer', 'level', 'addr:housenumber', 'addr:unit'];
        let isDifferentLevel = false;
        for (const key of zAxisKeys) {
          const nodeValue = node.tags[key] || '0';
          const nearbyValue = other.tags[key] || '0';
          if (nodeValue !== nearbyValue) {
            isDifferentLevel = true;
            break;
          }
        }
        if (isDifferentLevel) continue;

        if (other.loc === node.loc || geoSphericalDistance(node.loc!, other.loc!) < pointThresholdMeters) {
          issues.push(new ValidationIssue(context, {
            type: type,
            subtype: 'detached',
            severity: 'warning',
            message: function(this: any) {
              const graph = editor.staging.graph;
              const entity = graph.hasEntity(this.entityIds[0]);
              const entity2 = graph.hasEntity(this.entityIds[1]);
              return (entity && entity2) ? l10n.t('issues.close_nodes.detached.message', {
                feature: l10n.displayLabel(entity, graph),
                feature2: l10n.displayLabel(entity2, graph)
              }) : '';
            },
            reference: showReference,
            entityIds: [node.id, other.id],
            dynamicFixes: function() {
              return [
                new ValidationFix({
                  icon: 'rapid-operation-disconnect',
                  title: l10n.t('issues.fix.move_points_apart.title')
                }),
                new ValidationFix({
                  icon: 'rapid-icon-layers',
                  title: l10n.t('issues.fix.use_different_layers_or_levels.title')
                })
              ];
            }
          }));
        }
      }

      return issues;

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
          .text(l10n.t('issues.close_nodes.detached.reference'));
      }
    }


    /**
     * Returns a close-nodes issue between two adjacent vertices if they
     * are within the threshold distance, or `null` otherwise.
     * @param node1 - The first node
     * @param node2 - The second node
     * @param way - The parent way
     * @returns A validation issue, or `null` if nodes are not too close
     */
    function getWayIssueIfAny(node1: OsmNode, node2: OsmNode, way: OsmWay): ValidationIssue | null {
      if (node1.id === node2.id || (node1.hasInterestingTags() && node2.hasInterestingTags())) {
        return null;
      }

      if (node1.loc !== node2.loc) {
        const parentWays1 = graph.parentWays(node1);
        const parentWays2 = new Set<OsmWay>(graph.parentWays(node2));
        const sharedWays = parentWays1.filter(parentWay => parentWays2.has(parentWay));
        const thresholds = sharedWays.map(parentWay => thresholdMetersForWay(parentWay));
        const threshold = Math.min(...thresholds);
        const distance = geoSphericalDistance(node1.loc!, node2.loc!);
        if (distance > threshold) return null;
      }

      // This just wraps `actionMergeNodes`, but it checks that the nodes exist first.
      // During autofixing, the nodes involved may have been merged previously and not exist anymore.
      const actionTryMergeNodes = (nodeIDs: EntityID[]) => {
        return (graph: Graph) => {
          const nA = nodeIDs[0];
          const nB = nodeIDs[1];
          if (nA && nB && graph.hasEntity(nA) && graph.hasEntity(nB)) {
            return actionMergeNodes(nodeIDs)(graph);  // ok to merge
          } else {
            return graph;
          }
        };
      };

      return new ValidationIssue(context, {
        type: type,
        subtype: 'vertices',
        severity: 'warning',
        message: function(this: any) {
          const graph = editor.staging.graph;
          const entity = graph.hasEntity(this.entityIds[0]);
          return entity ? l10n.t('issues.close_nodes.message', { way: l10n.displayLabel(entity, graph) }) : '';
        },
        reference: showReference,
        entityIds: [way.id, node1.id, node2.id],
        loc: node1.loc,
        autoArgs: [
          actionTryMergeNodes([node1.id, node2.id]),
          l10n.t('issues.fix.merge_close_vertices.annotation')
        ],
        dynamicFixes: function(this: any) {
          return [
            new ValidationFix({
              icon: 'rapid-icon-plus',
              title: l10n.t('issues.fix.merge_points.title'),
              onClick: function(this: any) {
                const entityIds = this.issue.entityIds;
                editor.perform(actionMergeNodes([entityIds[1], entityIds[2]]));
                editor.commit({
                  annotation: l10n.t('issues.fix.merge_close_vertices.annotation'),
                  selectedIDs: [ entityIds[1], entityIds[2] ]
                });
              }
            }),
            new ValidationFix({
              icon: 'rapid-operation-disconnect',
              title: l10n.t('issues.fix.move_points_apart.title')
            })
          ];
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
          .text(l10n.t('issues.close_nodes.reference'));
      }
    }

  };


  validator.type = type;
  return validator;
}
