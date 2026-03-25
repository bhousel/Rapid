import { actionChangeTags } from '../actions/change_tags.ts';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmEntity, OsmTags } from '../data/types.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting features with generic or
 * incorrect names. Generic names match raw tag keys/values (e.g. naming a
 * park "Park") or are flagged by the name-suggestion-index.
 * @param context
 * @returns Validator function
 */
export function validateSuspiciousName(context: Context): ValidatorFunction {
  const type = 'suspicious_name' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;
  const schema = context.systems.schema;

  const keysToTestForGenericValues = [
    'aerialway', 'aeroway', 'amenity', 'building', 'craft', 'highway',
    'leisure', 'railway', 'man_made', 'office', 'shop', 'tourism', 'waterway'
  ];
  let _waitingForNsi = false;


  /**
   * Attempts to match a generic record in the name-suggestion-index.
   * @param tags - The tags to check
   * @returns `true` if the tags match a generic name in NSI
   */
  function isGenericMatchInNsi(tags: OsmTags): boolean {
    const nsi = context.services.nsi;
    if (nsi) {
      _waitingForNsi = (nsi.status === 'loading');
      if (!_waitingForNsi) {
        return nsi.isGenericName(tags);
      }
    }
    return false;
  }


  /**
   * Tests if the name is just the key or tag value (e.g. "park" for `leisure=park`).
   * @param lowercaseName - The lowercased name to check
   * @param tags - The entity tags
   * @returns `true` if the name matches a raw tag key or value
   */
  function nameMatchesRawTag(lowercaseName: string, tags: OsmTags): boolean {
    for (const key of keysToTestForGenericValues) {
      let val = tags[key];
      if (val) {
        val = val.toLowerCase();
        if (key === lowercaseName ||
          val === lowercaseName ||
          key.replace(/\_/g, ' ') === lowercaseName ||
          val.replace(/\_/g, ' ') === lowercaseName) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Tests whether a name is generic by checking raw tag matches and NSI.
   * @param name - The name value to check
   * @param tags - The entity tags
   * @returns `true` if the name is considered generic
   */
  function isGenericName(name: string, tags: OsmTags): boolean {
    name = name.toLowerCase();
    return nameMatchesRawTag(name, tags) || isGenericMatchInNsi(tags);
  }

  /**
   * Creates a validation issue for a feature with a generic name.
   * @param entityID - The entity ID
   * @param nameKey - The tag key containing the generic name (e.g. 'name', 'name:en')
   * @param genericName - The generic name value
   * @param langCode - The language code suffix, or `null` for the primary name
   * @returns A validation issue with a fix to remove the name
   */
  function makeGenericNameIssue(entityID: EntityID, nameKey: string, genericName: string, langCode: string | null): ValidationIssue {
    return new ValidationIssue(context, {
      type: type,
      subtype: 'generic_name',
      severity: 'warning',
      message: function(this: any) {
        const graph = editor.staging.graph;
        const entity = graph.hasEntity(this.entityIds[0]);
        if (!entity) return '';
        const preset = schema?.match(entity, graph);
        const langName = langCode && l10n.languageName(langCode);
        return l10n.t('issues.generic_name.message' + (langName ? '_language' : ''),
          { feature: preset?.name, name: genericName, language: langName || undefined }
        );
      },
      reference: showReference,
      entityIds: [entityID],
      hash: `${nameKey}=${genericName}`,
      dynamicFixes: function(this: any) {
        return [
          new ValidationFix({
            icon: 'rapid-operation-delete',
            title: l10n.t('issues.fix.remove_the_name.title'),
            onClick: function(this: any) {
              const graph = editor.staging.graph;
              const entityID = this.issue.entityIds[0];
              const entity = graph.entity(entityID);
              const tags = Object.assign({}, entity.tags);   // shallow copy
              delete tags[nameKey];
              editor.perform(actionChangeTags(entityID, tags));
              editor.commit({
                annotation: l10n.t('issues.fix.remove_generic_name.annotation'),
                selectedIDs: [entityID]
              });
            }
          })
        ];
      }
    });

    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.generic_name.reference'));
    }
  }

  /**
   * Creates a validation issue for a feature whose name appears in `not:name`.
   * @param entityID - The entity ID
   * @param nameKey - The tag key containing the incorrect name
   * @param incorrectName - The incorrect name value
   * @param langCode - The language code suffix, or `null` for the primary name
   * @returns A validation issue with a fix to remove the name
   */
  function makeIncorrectNameIssue(entityID: EntityID, nameKey: string, incorrectName: string, langCode: string | null): ValidationIssue {
    return new ValidationIssue(context, {
      type: type,
      subtype: 'not_name',
      severity: 'warning',
      message: function(this: any) {
        const graph = editor.staging.graph;
        const entity = graph.hasEntity(this.entityIds[0]);
        if (!entity) return '';
        const preset = schema?.match(entity, graph);
        const langName = langCode && l10n.languageName(langCode);
        return l10n.t('issues.incorrect_name.message' + (langName ? '_language' : ''),
          { feature: preset?.name, name: incorrectName, language: langName || undefined }
        );
      },
      reference: showReference,
      entityIds: [entityID],
      hash: `${nameKey}=${incorrectName}`,
      dynamicFixes: function(this: any) {
        return [
          new ValidationFix({
            icon: 'rapid-operation-delete',
            title: l10n.t('issues.fix.remove_the_name.title'),
            onClick: function(this: any) {
              const graph = editor.staging.graph;
              const entityID = this.issue.entityIds[0];
              const entity = graph.entity(entityID);
              const tags = Object.assign({}, entity.tags);   // shallow copy
              delete tags[nameKey];
              editor.perform(actionChangeTags(entityID, tags));
              editor.commit({
                annotation: l10n.t('issues.fix.remove_mistaken_name.annotation'),
                selectedIDs: [entityID]
              });
            }
          })
        ];
      }
    });

    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.generic_name.reference'));
    }
  }


  /**
   * Checks whether the entity has generic or incorrect name tags.
   * @param entity - The entity to validate
   * @returns Array of issues, with `provisional` set if NSI is still loading
   */
  const validator = function checkGenericName(entity: OsmEntity): ValidatorResult {
    const tags = entity.tags;

    // a generic name is allowed if it's a known brand or entity
    const hasWikidata = (!!tags.wikidata || !!tags['brand:wikidata'] || !!tags['operator:wikidata']);
    if (hasWikidata) return [];

    const issues: ValidatorResult = [];
    const notNames = new Set((tags['not:name'] ?? '').split(';').map(s => s.trim()).filter(Boolean));

    for (const [k, v] of Object.entries(tags)) {
      if (!v) continue;   // no value
      const m = k.match(/^name(?:(?::)([a-zA-Z_-]+))?$/);
      if (!m) continue;   // not a namelike tag
      const langCode = m.length >= 2 ? m[1] : null;

      if (notNames.has(v)) {
        issues.push(makeIncorrectNameIssue(entity.id, k, v, langCode));
      }
      if (isGenericName(v, tags)) {
        issues.provisional = _waitingForNsi;  // retry later if we are waiting on NSI to finish loading
        issues.push(makeGenericNameIssue(entity.id, k, v, langCode));
      }
    }

    return issues;
  };


  validator.type = type;

  return validator;
}
