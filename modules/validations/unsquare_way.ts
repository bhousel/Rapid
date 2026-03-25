//import { actionChangeTags } from '../actions/change_tags.ts';
import { actionOrthogonalize } from '../actions/orthogonalize.ts';
import { geoOrthoCanOrthogonalize } from '../geo/ortho.ts';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmWay } from '../data/types.ts';
import type { ValidatorFunction } from './types.ts';


/**
 * Factory that creates a validator for detecting building outlines that have
 * near-right angles that should be squared. Uses orthogonalization to
 * determine if corners deviate from 90 degrees beyond a configurable threshold.
 * @param context
 * @returns Validator function
 */
export function validationUnsquareWay(context: Context): ValidatorFunction {
  const type = 'unsquare_way' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const DEFAULT_DEG_THRESHOLD = 5;   // see also issues.js

  // use looser epsilon for detection to reduce warnings of buildings that are essentially square already
  const epsilon = 0.05;
  const nodeThreshold = 10;

  /**
   * Tests whether the entity is a building area.
   * @param entity - The entity to check
   * @param graph - The current graph
   * @returns `true` if the entity is a building polygon
   */
  function isBuilding(entity: OsmEntity, graph: Graph): boolean {
    if (entity.type !== 'way' || entity.geometry(graph) !== 'area') return false;
    return !!entity.tags.building && entity.tags.building !== 'no';
  }


  /**
   * Checks whether a building outline has corners out of square.
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Array of issues for unsquare buildings
   */
  const validation = function checkUnsquareWay(entity: OsmEntity, graph: Graph): ValidationIssue[] {
    if (!isBuilding(entity, graph)) return [];

    // don't flag ways marked as physically unsquare
    if (entity.tags.nonsquare === 'yes') return [];

    const way = entity as OsmWay;
    const isClosed = way.isClosed();
    if (!isClosed) return [];        // this building has bigger problems

    // don't flag ways with lots of nodes since they are likely detail-mapped
    const nodes = graph.childNodes(way).slice();    // shallow copy
    if (nodes.length > nodeThreshold + 1) return [];   // +1 because closing node appears twice

    // Bail out if map not fully loaded here - we won't know all the node's parentWays.
    // Don't worry, as more map tiles are loaded, we'll have additional chances to validate it.
    const osm = context.services.osm;
    if (!osm || nodes.some(node => !osm.isDataLoaded(node.loc!))) return [];

    // don't flag connected ways to avoid unresolvable unsquare loops
    const hasConnectedSquarableWays = nodes.some(node => {
      return graph.parentWays(node).some(parentWay => {
        if (parentWay.id === entity.id) return false;
        if (isBuilding(parentWay, graph)) return true;

        return graph.parentRelations(parentWay).some(parentRelation => {
          return parentRelation.isMultipolygon() &&
            parentRelation.tags.building &&
            parentRelation.tags.building !== 'no';
        });
      });
    });
    if (hasConnectedSquarableWays) return [];


    // user-configurable square threshold
    const storage = context.systems.storage;
    const storedStr = storage?.getItem('validate-square-degrees');
    const parsed = storedStr != null ? parseFloat(storedStr) : NaN;  // eslint-disable-line no-eq-null
    const degreeThreshold = isNaN(parsed) ? DEFAULT_DEG_THRESHOLD : parsed;

    const points = nodes.map(node => context.viewport.project(node.loc!));
    if (!geoOrthoCanOrthogonalize(points, isClosed, epsilon, degreeThreshold, true)) return [];

    let autoArgs;
    // don't allow autosquaring features linked to wikidata
    if (!entity.tags.wikidata) {
      // important to use the same `degreeThreshold` as for detection:
      const action = actionOrthogonalize(entity.id, context.viewport, undefined, degreeThreshold);
      const annotation = l10n.t('operations.orthogonalize.annotation.feature', { n: 1 });
      autoArgs = [ action, annotation ];
    }

    return [new ValidationIssue(context, {
      type: type,
      subtype: 'building',
      severity: 'warning',
      message: function(this: any) {
        const graph = editor.staging.graph;
        const entity = graph.hasEntity(this.entityIds[0]);
        return entity ? l10n.t('issues.unsquare_way.message', {
          feature: l10n.displayLabel(entity, graph)
        }) : '';
      },
      reference: showReference,
      entityIds: [entity.id],
      hash: String(degreeThreshold),
      autoArgs: autoArgs,
      dynamicFixes: function(this: any) {
        return [
          new ValidationFix({
            icon: 'rapid-operation-orthogonalize',
            title: l10n.t('issues.fix.square_feature.title'),
            onClick: function(this: any) {
              const entityID = this.issue.entityIds[0];
              // important to use the same `degreeThreshold` as for detection:
              const action = actionOrthogonalize(entityID, context.viewport, undefined, degreeThreshold);
              const annotation = l10n.t('operations.orthogonalize.annotation.feature', { n: 1 });

              editor
                .performAsync(action)
                .then(() => editor.commit({ annotation: annotation, selectedIDs: [entityID] }));
            }
          }),
/*
          new ValidationFix({     // Tag as unnsquare
            title: l10n.t('issues.fix.tag_as_unsquare.title'),
            onClick: function() {
              const graph = editor.staging.graph;
              const entityID = this.issue.entityIds[0];
              const entity = graph.entity(entityID);
              const tags = Object.assign({}, entity.tags);  // shallow copy
              tags.nonsquare = 'yes';
              editor.perform(actionChangeTags(entityID, tags));
              editor.commit({
                annotation: l10n.t('issues.fix.tag_as_unsquare.annotation'),
                selectedIDs: [entityID]
              });
            }
          })
*/
        ];
      }
    })];

    /** Renders the issue reference text into the given selection. */
    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.unsquare_way.buildings.reference'));
    }
  };

  validation.type = type;

  return validation;
}
