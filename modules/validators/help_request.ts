import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting features with `fixme` tags.
 * These tags indicate unresolved issues that need attention.
 * @param context
 * @returns Validator function
 */
export function validateHelpRequest(context: Context): ValidatorFunction {
  const type = 'help_request' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;


  /**
   * Checks whether the entity has a `fixme` tag that was not added by the current user.
   * @param entity - The entity to validate
   * @returns Result object containing issues detected
   */
  const validator = function checkHelpRequest(entity: OsmEntity): ValidatorResult {
    const result: ValidatorResult = { issues: [] };
    if (!entity.tags.fixme) return result;

    // don't flag fixmes on features added by the user
    if (entity.version === undefined) return result;

    if (entity.v !== undefined) {
      const baseEntity = editor.base.graph.hasEntity(entity.id);
      // don't flag fixmes added by the user on existing features
      if (!baseEntity || !baseEntity.tags.fixme) return result;
    }

    result.issues = [new ValidationIssue(context, {
      type: type,
      subtype: 'fixme_tag',
      severity: 'warning',
      message: function(this: any) {
        const graph = editor.staging.graph;
        const entity = graph.hasEntity(this.entityIds[0]);
        return entity ? l10n.t('issues.fixme_tag.message', {
          feature: l10n.displayLabel(entity, graph, true)    // true = verbose
        }) : '';
      },
      dynamicFixes: () => {
        return [
          new ValidationFix({ title: l10n.t('issues.fix.address_the_concern.title') })
        ];
      },
      reference: showReference,
      entityIds: [entity.id]
    })];

    return result;


    /** Renders the issue reference text into the given selection. */
    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.fixme_tag.reference'));
    }
  };


  validator.type = type;
  return validator;
}
