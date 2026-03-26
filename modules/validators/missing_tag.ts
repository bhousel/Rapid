import { operationDelete } from '../operations/delete.js';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmNode } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting features that are missing
 * descriptive tags, have unknown road classifications, or have untyped relations.
 * @param context
 * @returns Validator function
 */
export function validateMissingTag(context: Context): ValidatorFunction {
  const type = 'missing_tag' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const ui = context.systems.ui;


  /**
   * Tests whether the entity has meaningful descriptive tags
   * (beyond just name/description/note attributes).
   * @param entity - The entity to check
   * @param graph - The current graph
   * @returns `true` if the entity has descriptive tags
   */
  function hasDescriptiveTags(entity: OsmEntity, graph: Graph): boolean {
    const onlyAttributeKeys = ['description', 'name', 'note', 'start_date'];
    const entityDescriptiveKeys = Object.keys(entity.tags).filter(k => {
      if (k === 'area' || !entity.isInterestingTag(k)) return false;
      return !onlyAttributeKeys.some(attributeKey => {
        return k === attributeKey || k.indexOf(attributeKey + ':') === 0;
      });
    });

    if (entity.type === 'relation' && entityDescriptiveKeys.length === 1 && entity.tags.type === 'multipolygon') {
      // this relation's only interesting tag just says it's a multipolygon, which is not descriptive enough
      // It's okay for a simple multipolygon to have no descriptive tags
      // if its outer way has them (old model, see `outdated_tags.ts`)
      return false;
    }

    return entityDescriptiveKeys.length > 0;
  }


  /** Tests whether the entity is a way with `highway=road` (unclassified road). */
  function isUnknownRoad(entity: OsmEntity): boolean {
    return entity.type === 'way' && entity.tags.highway === 'road';
  }

  /** Tests whether the entity is a relation without a `type` tag. */
  function isUntypedRelation(entity: OsmEntity): boolean {
    return entity.type === 'relation' && !entity.tags.type;
  }


  /**
   * Checks whether the entity is missing descriptive tags, has an unknown road
   * classification, or is a relation without a type.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Result object containing issues detected
   */
  const validator = function checkMissingTag(entity: OsmEntity, graph: Graph): ValidatorResult {
    const osm = context.services.osm;
    const isUnloadedNode = (entity.type === 'node') && osm && !osm.isDataLoaded((entity as OsmNode).loc!);
    let subtype;

    // we can't know if the node is a vertex if the tile is undownloaded
    if (!isUnloadedNode &&
      // allow untagged nodes that are part of ways
      entity.geometry(graph) !== 'vertex' &&
      // allow untagged entities that are part of relations
      !entity.hasParentRelations(graph)) {

      if (Object.keys(entity.tags).length === 0) {
        subtype = 'any';
      } else if (!hasDescriptiveTags(entity, graph)) {
        subtype = 'descriptive';
      } else if (isUntypedRelation(entity)) {
        subtype = 'relation_type';
      }
    }

    // flag an unknown road even if it's a member of a relation
    if (!subtype && isUnknownRoad(entity)) {
      subtype = 'highway_classification';
    }

    const result: ValidatorResult = { issues: [] };
    if (!subtype) return result;

    const messageID = subtype === 'highway_classification' ? 'unknown_road' : `missing_tag.${subtype}`;
    const referenceID = subtype === 'highway_classification' ? 'unknown_road' : 'missing_tag';

    // can always delete if the user created it in the first place..
    const canDelete = (entity.version === undefined || entity.v !== undefined);
    const severity = (canDelete && subtype !== 'highway_classification') ? 'error' : 'warning';

    result.issues = [new ValidationIssue(context, {
        type: type,
        subtype: subtype,
        severity: severity,
        message: function(this: any) {
          const graph = editor.staging.graph;
          const entity = graph.hasEntity(this.entityIds[0]);
          return entity ? l10n.t(`issues.${messageID}.message`, {
            feature: l10n.displayLabel(entity, graph)
          }) : '';
        },
        reference: showReference,
        entityIds: [entity.id],
        dynamicFixes: function(this: any) {
          const fixes = [];
          const selectFixType = subtype === 'highway_classification' ? 'select_road_type' : 'select_preset';
          fixes.push(new ValidationFix({
            icon: 'rapid-icon-search',
            title: l10n.t(`issues.fix.${selectFixType}.title`),
            onClick: function(this: any) {
              ui?.Sidebar?.showPresetList();
            }
          }));

          const id = this.entityIds[0];
          const operation = operationDelete(context, [id]);
          const disabledReasonID = operation.disabled();
          let deleteOnClick;
          if (!disabledReasonID) {
            deleteOnClick = function(this: any) {
              const id = this.issue.entityIds[0];
              const operation = operationDelete(context, [id]);
              if (!operation.disabled()) {
                operation();
              }
            };
          }

          fixes.push(
            new ValidationFix({
              icon: 'rapid-operation-delete',
              title: l10n.t('issues.fix.delete_feature.title'),
              disabledReason: disabledReasonID ? l10n.t(`operations.delete.${disabledReasonID}`, { n: 1 }) : undefined,
              onClick: deleteOnClick
            })
          );

          return fixes;
        }
    })];

    return result;

    /** Renders the issue reference text into the given selection. */
    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t(`issues.${referenceID}.reference`));
    }
  };


  validator.type = type;
  return validator;
}
