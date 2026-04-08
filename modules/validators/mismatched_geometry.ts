import { geoSphericalDistance } from '@rapid-sdk/math';
import { utilTagText } from '@rapid-sdk/util';
import deepEqual from 'fast-deep-equal';

import { actionAddVertex } from '../actions/add_vertex.ts';
import { actionChangeTags } from '../actions/change_tags.ts';
import { actionMergeNodes } from '../actions/merge_nodes.ts';
import { actionExtract } from '../actions/extract.ts';
import { osmJoinWays } from '../lib/multipolygon.ts';
import { geoHasSelfIntersections } from '../geo/geom.ts';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmNode, OsmRelation, OsmTags, OsmWay} from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting mismatches between an
 * entity's geometry and its tags — e.g. an open way tagged as an area,
 * a vertex that should be a detached point, or unclosed multipolygon parts.
 * @param context
 * @returns Validator function
 */
export function validateMismatchedGeometry(context: Context): ValidatorFunction {
  const type = 'mismatched_geometry' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const schema = context.systems.schema;

  /**
   * Returns the tag that suggests an open way should actually be an area.
   * Checks preset matches and filters out ambiguous cases.
   * @param entity - The entity to inspect
   * @returns The problematic tag object, or `null` if no mismatch
   */
  function tagSuggestingLineIsArea(entity: OsmEntity): OsmTags | null {
    const way = entity as OsmWay;
    if (way.type !== 'way' || way.isClosed()) return null;

    const tagSuggestingArea = way.tagSuggestingArea();
    if (!tagSuggestingArea) {
      return null;
    }

    const linePreset = schema!.matchTags(tagSuggestingArea, 'line');
    const areaPreset = schema!.matchTags(tagSuggestingArea, 'area');

    if (linePreset && areaPreset) {
      // If the same preset allows both lines and areas (e.g. barrier), ignore
      if (linePreset === areaPreset) return null;

      // If the line preset matches something like '*', (e.g. attraction), ignore
      const key = Object.keys(tagSuggestingArea)[0];
      if (linePreset.tags[key] === '*') return null;

      // If the entity matches only fallback presets,
      // then changing the geometry will not help.  iD#10523
      if (linePreset.isFallback() && areaPreset.isFallback() && !deepEqual(tagSuggestingArea, { area: 'yes' })) {
        return null;
      }
    }

    return tagSuggestingArea;
  }


  /**
   * Builds an `onClick` handler that closes an open way by either merging
   * its endpoints (when they are very close) or appending the first node
   * to the end.  Returns `null` if the operation would create a
   * self-intersection or the way has fewer than 3 nodes.
   * @param way - The open way to close
   * @param graph - The current graph
   * @returns Click handler, `null` if not possible, or `undefined`
   */
  function makeConnectEndpointsFixOnClick(way: OsmWay, graph: Graph): ((this: any) => void) | null | undefined {
    // must have at least three nodes to close this automatically
    if (way.nodes.length < 3) return null;

    const nodes: OsmNode[] = graph.childNodes(way);
    let testNodes: OsmNode[];
    const firstToLastDistanceMeters = geoSphericalDistance(nodes[0].loc!, nodes[nodes.length-1].loc!);

    // if the distance is very small, attempt to merge the endpoints
    if (firstToLastDistanceMeters < 0.75) {
      testNodes = nodes.slice();   // shallow copy
      testNodes.pop();
      testNodes.push(testNodes[0]);
      // make sure this will not create a self-intersection
      if (!geoHasSelfIntersections(testNodes, testNodes[0].id)) {
        return function(this: any) {
          const graph = editor.staging.graph;
          const way = graph.entity(this.issue.entityIds[0]) as OsmWay;
          editor.perform(actionMergeNodes([way.nodes[0], way.nodes[way.nodes.length-1]], nodes[0].loc!));
          editor.commit({
            annotation: l10n.t('issues.fix.connect_endpoints.annotation'),
            selectedIDs: [way.id]
          });
        };
      }
    }

    // if the points were not merged, attempt to close the way
    testNodes = nodes.slice();   // shallow copy
    testNodes.push(testNodes[0]);
    // make sure this will not create a self-intersection
    if (!geoHasSelfIntersections(testNodes, testNodes[0].id)) {
      return function(this: any) {
        const wayID = this.issue.entityIds[0];
        const graph = editor.staging.graph;
        const way = graph.entity(wayID) as OsmWay;
        const nodeID = way.nodes[0];
        const index = way.nodes.length;
        editor.perform(actionAddVertex(wayID, nodeID, index));
        editor.commit({
          annotation: l10n.t('issues.fix.connect_endpoints.annotation'),
          selectedIDs: [wayID]
        });
      };
    }
  }

  /**
   * Creates a validation issue for an open way whose tags suggest it
   * should be a closed area.
   * @param entity - The entity to check
   * @returns A validation issue, or `null` if no mismatch
   */
  function lineTaggedAsAreaIssue(entity: OsmEntity): ValidationIssue | null {
    const tagSuggestingArea = tagSuggestingLineIsArea(entity);
    if (!tagSuggestingArea) return null;

    return new ValidationIssue(context, {
      type: type,
      subtype: 'area_as_line',
      severity: 'warning',
      message: function(this: any) {
        const graph = editor.staging.graph;
        const entity = graph.hasEntity(this.entityIds[0]);
        return entity ? l10n.t('issues.tag_suggests_area.message', {
          feature: l10n.displayLabel(entity, 'area', true),   // true = verbose
          tag: utilTagText({ tags: tagSuggestingArea })
        }) : '';
      },
      reference: showReference,
      entityIds: [entity.id],
      hash: JSON.stringify(tagSuggestingArea),
      dynamicFixes: function(this: any) {
        const graph = editor.staging.graph;
        const fixes = [];
        const entity = graph.entity(this.entityIds[0]) as OsmWay;
        const connectEndsOnClick = makeConnectEndpointsFixOnClick(entity, graph);

        fixes.push(new ValidationFix({
          title: l10n.t('issues.fix.connect_endpoints.title'),
          onClick: connectEndsOnClick ?? undefined
        }));

        fixes.push(new ValidationFix({
          icon: 'rapid-operation-delete',
          title: l10n.t('issues.fix.remove_tag.title'),
          onClick: function(this: any) {
            const entityID = this.issue.entityIds[0];
            const graph = editor.staging.graph;
            const entity = graph.entity(entityID);
            const tags = { ...entity.tags };  // shallow copy
            for (const key in tagSuggestingArea) {
              delete tags[key];
            }
            editor.perform(actionChangeTags(entityID, tags));
            editor.commit({
              annotation: l10n.t('issues.fix.remove_tag.annotation'),
              selectedIDs: [entityID]
            });
          }
        }));

        return fixes;
      }
    });


    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.tag_suggests_area.reference'));
    }
  }

  /**
   * Creates a validation issue when a node's geometry (point vs vertex)
   * does not match what the presets expect for its tags.
   * @param entity - The entity to check
   * @param graph - The current graph
   * @returns A validation issue, or `null` if no mismatch
   */
  function vertexPointIssue(entity: OsmEntity, graph: Graph): ValidationIssue | null {
    // we only care about nodes
    if (entity.type !== 'node') return null;

    // ignore tagless points
    if (Object.keys(entity.tags).length === 0) return null;

    // address lines are special so just ignore them
    if ((entity as OsmNode).isOnAddressLine(graph)) return null;

    const geometry = entity.geometry(graph);
    const pointMatch = schema!.matchTags(entity.tags, 'point');
    const vertexMatch = schema!.matchTags(entity.tags, 'vertex');
    const allowsPoint = pointMatch && !pointMatch.isFallback();
    const allowsVertex = vertexMatch && !vertexMatch.isFallback();

    if (geometry === 'point' && !allowsPoint && allowsVertex) {

      return new ValidationIssue(context, {
        type: type,
        subtype: 'vertex_as_point',
        severity: 'warning',
        message: function(this: any) {
          const graph = editor.staging.graph;
          const entity = graph.hasEntity(this.entityIds[0]);
          return entity ? l10n.t('issues.vertex_as_point.message', {
            feature: l10n.displayLabel(entity, 'vertex', true /* verbose */)
          }) : '';
        },
        reference: function showReference($selection: D3Selection): void {
          $selection.selectAll('.issue-reference')
            .data([0])
            .enter()
            .append('div')
            .attr('class', 'issue-reference')
            .text(l10n.t('issues.vertex_as_point.reference'));
        },
        entityIds: [entity.id]
      });

    } else if (geometry === 'vertex' && !allowsVertex && allowsPoint) {

      return new ValidationIssue(context, {
        type: type,
        subtype: 'point_as_vertex',
        severity: 'warning',
        message: function(this: any) {
          const graph = editor.staging.graph;
          const entity = graph.hasEntity(this.entityIds[0]);
          return entity ? l10n.t('issues.point_as_vertex.message', {
            feature: l10n.displayLabel(entity, 'point', true /* verbose */)
          }) : '';
        },
        reference: function showReference($selection: D3Selection): void {
          $selection.selectAll('.issue-reference')
            .data([0])
            .enter()
            .append('div')
            .attr('class', 'issue-reference')
            .text(l10n.t('issues.point_as_vertex.reference'));
        },
        entityIds: [entity.id],
        dynamicFixes: extractPointDynamicFixes
      });
    }

    return null;
  }


  /**
   * Creates a validation issue when an entity's geometry does not match
   * the best preset for its tags and a different geometry would be a
   * better fit.
   * @param entity - The entity to check
   * @param graph - The current graph
   * @returns A validation issue, or `null` if no mismatch
   */
  function otherMismatchIssue(entity: OsmEntity, graph: Graph): ValidationIssue | null {
    // ignore boring features
    if (!entity.hasInterestingTags()) return null;

    if (entity.type !== 'node' && entity.type !== 'way') return null;

    // address lines are special so just ignore them
    if (entity.type === 'node' && (entity as OsmNode).isOnAddressLine(graph)) return null;

    let sourceGeom = entity.geometry(graph);
    const loc = (entity as any).extent(graph).center();

    const targetGeoms = entity.type === 'way' ? ['point', 'vertex'] : ['line', 'area'];

    if (sourceGeom === 'area') targetGeoms.unshift('line');

    const asSource = schema!.match(entity, graph);

    let targetGeom = targetGeoms.find(nodeGeom => {
      const asTarget = schema!.matchTags(entity.tags, nodeGeom as any, loc);
      // sometimes there are two presets with the same tags for different geometries
      if (!asSource || !asTarget || asSource === asTarget || deepEqual(asSource.tags, asTarget.tags)) return false;

      if (asTarget.isFallback()) return false;

      const primaryKey = Object.keys(asTarget.tags)[0];

      // special case: buildings-as-points not suggested by presets, but common in OSM, so ignore them
      if (primaryKey === 'building') return false;

      if (asTarget.tags[primaryKey] === '*') return false;

      return asSource.isFallback() || asSource.tags[primaryKey] === '*';
    });

    if (!targetGeom) return null;

    const subtype = targetGeom + '_as_' + sourceGeom;

    if (targetGeom === 'vertex') targetGeom = 'point';
    if (sourceGeom === 'vertex') sourceGeom = 'point';

    const referenceId = targetGeom + '_as_' + sourceGeom;

    let dynamicFixes: ((this: any) => ValidationFix[]) | undefined;
    if (targetGeom === 'point') {
      dynamicFixes = extractPointDynamicFixes;

    } else if (sourceGeom === 'area' && targetGeom === 'line') {
      dynamicFixes = lineToAreaDynamicFixes;
    }

    return new ValidationIssue(context, {
      type: type,
      subtype: subtype,
      severity: 'warning',
      message: function(this: any) {
        const graph = editor.staging.graph;
        const entity = graph.hasEntity(this.entityIds[0]);
        return entity ? l10n.t('issues.' + referenceId + '.message', {
          feature: l10n.displayLabel(entity, targetGeom!, true /* verbose */)
        }) : '';
      },
      reference: function showReference($selection: D3Selection): void {
        $selection.selectAll('.issue-reference')
          .data([0])
          .enter()
          .append('div')
          .attr('class', 'issue-reference')
          .text(l10n.t('issues.mismatched_geometry.reference'));
      },
      entityIds: [entity.id],
      dynamicFixes: dynamicFixes
    });
  }


  /**
   * Builds dynamic fixes for converting an area to a line by removing
   * the `area` tag.
   * @returns Array containing a convert-to-line fix
   */
  function lineToAreaDynamicFixes(this: any): ValidationFix[] {
    let convertOnClick = null;
    const entityID = this.entityIds[0];
    const graph = editor.staging.graph;
    const entity = graph.entity(entityID) as OsmWay;
    const tags = { ...entity.tags };  // shallow copy
    delete tags.area;

    if (!entity.tagSuggestingArea(tags)) {
      // if removing the area tag would make this a line, offer that as a quick fix
      convertOnClick = function(this: any) {
        const entityID = this.issue.entityIds[0];
        const graph = editor.staging.graph;
        const entity = graph.entity(entityID);
        const tags = { ...entity.tags };  // shallow copy
        if (tags.area) {
          delete tags.area;
        }
        editor.perform(actionChangeTags(entityID, tags));
        editor.commit({
          annotation: l10n.t('issues.fix.convert_to_line.annotation'),
          selectedIDs: [entityID]
        });
      };
    }

    return [
      new ValidationFix({
        icon: 'rapid-icon-line',
        title: l10n.t('issues.fix.convert_to_line.title'),
        onClick: convertOnClick ?? undefined
      })
    ];
  }


  /**
   * Builds dynamic fixes for extracting a vertex into a detached point.
   * @returns Array containing an extract-point fix
   */
  function extractPointDynamicFixes(this: any): ValidationFix[] {
    let extractOnClick = null;
    const entityID = this.entityIds[0];

    if (!context.hasHiddenConnections(entityID)) {
      extractOnClick = function(this: any) {
        const entityID = this.issue.entityIds[0];
        const action = actionExtract(entityID, context.viewport);
        editor.perform(action);
        editor.commit({
          annotation: l10n.t('operations.extract.annotation', { n: 1 }),
          selectedIDs: [entityID]
        });
        // re-enter mode to trigger updates
        context.enter('select-osm', { selection: { osm: [ action.getExtractedNodeID() ] }} );
      };
    }

    return [
      new ValidationFix({
        icon: 'rapid-operation-extract',
        title: l10n.t('issues.fix.extract_point.title'),
        onClick: extractOnClick ?? undefined
      })
    ];
  }


  /**
   * Detects unclosed parts of multipolygon relations.
   * @param entity - The entity to check (only relations are inspected)
   * @param graph - The current graph
   * @returns Array of issues for each unclosed sequence
   */
  function unclosedMultipolygonPartIssues(entity: OsmEntity, graph: Graph): ValidationIssue[] {
    if (entity.type !== 'relation') return [];

    const relation = entity as OsmRelation;
    if (!relation.isMultipolygon() ||
      entity.isDegenerate() ||
      // cannot determine issues for incompletely-downloaded relations
      !relation.isComplete(graph)) return [];

    const sequences = osmJoinWays(relation.members, graph);
    const issues = [];

    for (const i in sequences) {
      const sequence = sequences[i];

      if (!sequence.nodes) continue;

      const firstNode = sequence.nodes[0];
      const lastNode = sequence.nodes[sequence.nodes.length - 1];

      // part is closed if the first and last nodes are the same
      if (firstNode === lastNode) continue;

      const issue = new ValidationIssue(context, {
        type: type,
        subtype: 'unclosed_multipolygon_part',
        severity: 'warning',
        message: function(this: any) {
          const graph = editor.staging.graph;
          const entity = graph.hasEntity(this.entityIds[0]);
          return entity ? l10n.t('issues.unclosed_multipolygon_part.message', {
            feature: l10n.displayLabel(entity, graph, true /* verbose */)
          }) : '';
        },
        reference: showReference,
        loc: sequence.nodes[0].loc,
        entityIds: [entity.id],
        hash: sequence.map(function(way) {
          return way.id;
        }).join()
      });
      issues.push(issue);
    }

    return issues;

    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.unclosed_multipolygon_part.reference'));
    }
  }

  /**
   * Runs all mismatch checks in priority order: vertex/point, line-as-area,
   * other mismatch, then unclosed multipolygon parts.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Result object containing issues detected
   */
  const validator = function checkMismatchedGeometry(entity: OsmEntity, graph: Graph): ValidatorResult {
    if (!schema) return { issues: [] };

    const vertexPoint = vertexPointIssue(entity, graph);
    if (vertexPoint) return { issues: [vertexPoint] };

    const lineAsArea = lineTaggedAsAreaIssue(entity);
    if (lineAsArea) return { issues: [lineAsArea] };

    const mismatch = otherMismatchIssue(entity, graph);
    if (mismatch) return { issues: [mismatch] };

    return { issues: unclosedMultipolygonPartIssues(entity, graph) };
  };


  validator.type = type;
  return validator;
}
