import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


interface IncompatibleRule {
  id: string;
  regex: RegExp;
  exceptRegex?: RegExp;
}


/**
 * Factory that creates a validator for detecting features sourced from
 * proprietary or incompatible data providers (e.g. Google, Baidu, Amap).
 * @param context
 * @returns Validator function
 */
export function validateIncompatibleSource(context: Context): ValidatorFunction {
  const type = 'incompatible_source' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;

  const incompatibleRules: IncompatibleRule[] = [
    {
      id: 'amap',
      regex: /(amap|autonavi|mapabc|高德)/i
    }, {
      id: 'baidu',
      regex: /(baidu|mapbar|百度)/i
    }, {
      id: 'google',
      regex: /google/i,
      exceptRegex: /((books|drive)\.google|google\s?(books|drive|plus))|(esri\/google)/i
    }
  ];


  /**
   * Checks whether the entity's `source` tag references a known incompatible data provider.
   * @param entity - The entity to validate
   * @returns Result object containing issues detected
   */
  const validator = function checkIncompatibleSource(entity: OsmEntity): ValidatorResult {
    const result: ValidatorResult = { issues: [] };
    const entitySources = entity.tags?.source && entity.tags.source.split(';');
    if (!entitySources) return result;

    const entityID = entity.id;

    for (const source of entitySources) {
      const matchRule = incompatibleRules.find(rule => {
        if (!rule.regex.test(source)) return false;
        if (rule.exceptRegex && rule.exceptRegex.test(source)) return false;
        return true;
      });
      if (!matchRule) continue;

      result.issues.push( new ValidationIssue(context, {
        type: type,
        severity: 'warning',
        message: () => {
          const graph = editor.staging.graph;
          const entity = graph.hasEntity(entityID);
          return entity ? l10n.t('issues.incompatible_source.feature.message', {
            feature: l10n.displayLabel(entity, graph, true),  // true = verbose
            value: source
          }) : '';
        },
        reference: getReference(matchRule.id),
        entityIds: [entityID],
        hash: source,
        dynamicFixes: () => {
          return [
            new ValidationFix({ title: l10n.t('issues.fix.remove_proprietary_data.title') })
          ];
        }
      }) );
    }

    return result;


    /**
     * Returns a reference renderer for the given incompatible source rule.
     * @param id - The rule identifier (e.g. 'google', 'baidu')
     * @returns A function that renders reference text into a D3 selection
     */
    function getReference(id: string): ($selection: D3Selection) => void {
      return function showReference($selection: D3Selection): void {
        $selection.selectAll('.issue-reference')
          .data([0])
          .enter()
          .append('div')
          .attr('class', 'issue-reference')
          .text(l10n.t(`issues.incompatible_source.reference.${id}`));
      };
    }
  };


  validator.type = type;
  return validator;
}
