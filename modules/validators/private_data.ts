import { utilTagDiff } from '@rapid-sdk/util';

import { actionChangeTags } from '../actions/change_tags.ts';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { OsmEntity, OsmTags } from '../data/types.ts';
import type { TagDiff } from '@rapid-sdk/util';
import type { ValidatorFunction } from './types.ts';


/**
 * Factory that creates a validator for detecting personal/private data
 * on private buildings (e.g. phone numbers, email addresses on residential buildings).
 * @param context
 * @returns Validator function
 */
export function validatePrivateData(context: Context): ValidatorFunction {
  const type = 'private_data' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const schema = context.systems.schema;


  /**
   * Checks whether a private building has tags containing personal data
   * that should not be publicly shared.
   * @param entity - The entity to validate
   * @returns Array of issues for personal data found on private buildings
   */
  const validator = function checkPrivateData(entity: OsmEntity): ValidationIssue[] {
    if (!schema) return [];

    const variables = schema.getScope('osm').variables;
    const privateBuildingValues = variables.get('private_building_values')?.asSet();
    if (!privateBuildingValues) return [];

    const tags = entity.tags;
    if (!tags.building || !privateBuildingValues.has(tags.building)) return [];  // not a private building

    const keepTags: OsmTags = {};
    const publicKeys = variables.get('public_feature_keys')?.asSet();
    const personalKeys = variables.get('personal_data_keys')?.asSet();
    if (!publicKeys || !personalKeys) return [];

    for (const [k, v] of Object.entries(tags)) {
      if (publicKeys.has(k)) return [];  // ignore, probably a public feature
      if (!personalKeys.has(k)) {
        keepTags[k] = v;
      }
    }

    const tagDiff = utilTagDiff(tags, keepTags);
    if (!tagDiff.length) return [];

    const fixID = tagDiff.length === 1 ? 'remove_tag' : 'remove_tags';

    return [new ValidationIssue(context, {
      type: type,
      severity: 'warning',
      message: showMessage,
      reference: showReference,
      entityIds: [entity.id],
      dynamicFixes: () => {
        return [
          new ValidationFix({
            icon: 'rapid-operation-delete',
            title: l10n.t(`issues.fix.${fixID}.title`),
            onClick: () => {
              editor.perform(doUpgrade);
              editor.commit({
                annotation: l10n.t('issues.fix.upgrade_tags.annotation'),
                selectedIDs: [entity.id]
              });
            }
          })
        ];
      }
    })];


    /**
     * Applies the tag removal to the graph.
     * @param graph - The current graph state
     * @returns Updated graph with personal data tags removed
     */
    function doUpgrade(graph: Graph): Graph {
      const currEntity = graph.hasEntity(entity.id);
      if (!currEntity) return graph;

      const newTags = Object.assign({}, currEntity.tags);  // shallow copy
      for (const diff of tagDiff) {
        if (diff.type === '-') {
          delete newTags[diff.key];
        } else if (diff.type === '+') {
          newTags[diff.key] = diff.newVal!;
        }
      }

      return actionChangeTags(currEntity.id, newTags)(graph);
    }


    /** Returns the localized issue message for display. */
    function showMessage(this: any): string {
      const graph = editor.staging.graph;
      const currEntity = graph.hasEntity(this.entityIds[0]);
      if (!currEntity) return '';

      return l10n.t('issues.private_data.contact.message',
        { feature: l10n.displayLabel(currEntity, graph) }
      );
    }


    /** Renders the issue reference text and suggested tag changes. */
    function showReference($selection: D3Selection): void {
      const $$enter = $selection.selectAll('.issue-reference')
        .data([0])
        .enter();

      $$enter
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.private_data.reference'));

      $$enter
        .append('strong')
        .text(l10n.t('issues.suggested'));

      $$enter
        .append('table')
        .attr('class', 'tagDiff-table')
        .selectAll('.tagDiff-row')
        .data(tagDiff)
        .enter()
        .append('tr')
        .attr('class', 'tagDiff-row')
        .append('td')
        .attr('class', (d: TagDiff) => {
          const klass = d.type === '+' ? 'add' : 'remove';
          return `tagDiff-cell tagDiff-cell-${klass}`;
        })
        .text((d: TagDiff) => d.display);
    }
  };


  validator.type = type;

  return validator;
}
