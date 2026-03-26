import { Extent, geoSphericalDistance } from '@rapid-sdk/math';

import { operationDelete } from '../operations/delete.js';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmNode, OsmWay } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting short roads that may
 * have been drawn by mistake or left incomplete.
 * @param context
 * @returns Validator function
 */
export function validateShortRoad(context: Context): ValidatorFunction {
  const type = 'short_road' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const map = context.systems.map;

  // Thresholds for number of nodes and total length for a short road. A road
  // is considered as "short" only if it has less than 7 nodes and is shorter
  // than 20 meters.
  const SHORT_WAY_NODES_THD = 7;
  const SHORT_WAY_LENGTH_THD_METERS = 20;


  /**
   * Computes the total length of a way in meters.
   * @param way - The way to measure
   * @param graph - The current graph
   * @returns Total length in meters
   */
  function wayLength(way: OsmWay, graph: Graph): number {
    let length = 0;
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const n1 = graph.entity(way.nodes[i]) as OsmNode;
      const n2 = graph.entity(way.nodes[i + 1]) as OsmNode;
      length += geoSphericalDistance(n1.loc!, n2.loc!);
    }
    return length;
  }

  /**
   * Activates draw-line mode to continue drawing from the given vertex.
   * Also attempts to pas the map if the vertex is not visible.
   */
  function continueDrawing(way: OsmWay, vertex: OsmNode, context: Context): void {
    if (!context.editable()) return;

    // make sure the vertex is actually visible and editable
    if (!(map?.trimmedExtent() as Extent).contains(new Extent(vertex.loc!))) {
      map?.fitEntitiesEase(vertex);
    }

    context.enter('draw-line', { continueWayID: way.id, continueNodeID: vertex.id });
  }


  /**
   * Checks whether a way is a short road with open endpoints.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns  Result object containing issues detected
   */
  const validator = function checkShortRoad(entity: OsmEntity, graph: Graph): ValidatorResult {
    const result: ValidatorResult = { issues: [] };
    if (entity.type !== 'way') return result;

    const way = entity as OsmWay;
    if (!way.tags.highway || way.isClosed() || way.nodes.length >= SHORT_WAY_NODES_THD) return result;

    const firstNode = graph.entity(way.first()!) as OsmNode;
    const lastNode = graph.entity(way.last()!) as OsmNode;
    const pwaysStart = graph.parentWays(firstNode);
    const pwaysEnd = graph.parentWays(lastNode);
    const firstNodeOK = pwaysStart.length > 1 || firstNode.tags.noexit === 'yes';
    const lastNodeOK = pwaysEnd.length > 1 || lastNode.tags.noexit === 'yes';

    // only do check on roads with open ends
    if ((firstNodeOK && lastNodeOK) || wayLength(way, graph) >= SHORT_WAY_LENGTH_THD_METERS) return result;

    const fixes: ValidationFix[] = [];
    if (!firstNodeOK) {
      fixes.push(new ValidationFix({
        icon: 'rapid-operation-continue-left',
        title: l10n.t('issues.fix.continue_from_start.title'),
        entityIds: [way.first()!],
        onClick: function(this: any) {
          const graph = editor.staging.graph;
          const vertex = graph.entity(way.first()!) as OsmNode;
          continueDrawing(way, vertex, context);
        }
      }));
    }

    if (!lastNodeOK) {
      fixes.push(new ValidationFix({
        icon: 'rapid-operation-continue',
        title: l10n.t('issues.fix.continue_from_end.title'),
        entityIds: [way.last()!],
        onClick: function(this: any) {
          const graph = editor.staging.graph;
          const vertex = graph.entity(way.last()!) as OsmNode;
          continueDrawing(way, vertex, context);
        }
      }));
    }

    if (!operationDelete(context, [way.id]).disabled()) {
      fixes.push(new ValidationFix({
        icon: 'rapid-operation-delete',
        title: l10n.t('issues.fix.delete_feature.title'),
        entityIds: [way.id],
        onClick: function(this: any) {
          const id = this.issue.entityIds[0];
          const operation = operationDelete(context, [id]);
          if (!operation.disabled()) {
            operation();
          }
        }
      }));
    }

    result.issues = [new ValidationIssue(context, {
      type: type,
      severity: 'warning',
      message: function(this: any) {
        const graph = editor.staging.graph;
        const entity = graph.hasEntity(this.entityIds[0]);
        if (!entity) return '';
        const entityLabel = l10n.displayLabel(entity, graph);
        return l10n.t('issues.short_road.message', { highway: entityLabel });
      },
      reference: ($selection: D3Selection) => {
        $selection.selectAll('.issue-reference')
          .data([0])
          .enter()
          .append('div')
          .attr('class', 'issue-reference')
          .text(l10n.t('issues.short_road.reference'));
      },
      entityIds: [way.id],
      dynamicFixes: function(this: any) {
        return fixes;
      }
    })];

    return result;
  };


  validator.type = type;
  return validator;
}
