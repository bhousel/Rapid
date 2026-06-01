import { ValidationIssue } from '../lib/ValidationIssue.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmEntity } from '../data/OsmEntity.ts';
import type { ValidatorFunction, ValidatorResult } from './types.ts';


/**
 * Factory that creates a validator for detecting invalid tag value formats,
 * such as malformed email addresses.
 * @param context
 * @returns Validator function
 */
export function validateInvalidFormat(context: Context): ValidatorFunction {
  const type = 'invalid_format' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;


  /**
   * Checks whether the entity has tags with improperly formatted values.
   * Currently validates email addresses.
   * @param entity - The entity to validate
   * @returns Result object containing issues detected
   */
  const validator = function checkInvalidFormat(entity: OsmEntity): ValidatorResult {
    const result: ValidatorResult = { issues: [] };

    /**
     * Tests whether the given string is a valid email address.
     * An empty string is considered valid.
     * @param email - The email string to validate
     * @returns `true` if the email is valid or empty
     */
    function isValidEmail(email: string): boolean {
      // Emails in OSM are going to be official so they should be pretty simple
      // Using negated lists to better support all possible unicode characters - iD#6494
      const validEmail = /^[^\(\)\\,":;<>@\[\]]+@[^\(\)\\,":;<>@\[\]\.]+(?:\.[a-z0-9-]+)*$/i;
      // An empty value is also acceptable
      return (!email || validEmail.test(email));
    }

    /*
    function isSchemePresent(url) {
      let valid_scheme = /^https?:\/\//i;
      return (!url || valid_scheme.test(url));
    }
    */

    /**
     * Renders the email format issue reference text into the given selection.
     * @param $selection
     */
    function showReferenceEmail($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.invalid_format.email.reference'));
    }

    /*
    function showReferenceWebsite($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.invalid_format.website.reference'));
    }

    if (entity.tags.website) {
      // Multiple websites are possible
      const websites = entity.tags.website
        .split(';')
        .map(s => s.trim())
        .filter(s => !isSchemePresent(s));

      if (websites.length) {
        result.issues.push(new ValidationIssue(context, {
          type: type,
          subtype: 'website',
          severity: 'warning',
          message: function() {
            const graph = editor.staging.graph;
            const entity = graph.hasEntity(this.entityIds[0]);
            return entity ? l10n.t('issues.invalid_format.website.message', {
              n: websites.length,
              feature: l10n.displayLabel(entity, graph),
              email: websites.join(', ')
            }) : '';
          },
          reference: showReferenceWebsite,
          entityIds: [entity.id],
          hash: websites.join()
        }));
      }
    }
    */

    if (entity.tags.email) {
      // Multiple emails are possible
      const emails = entity.tags.email
        .split(';')
        .map(s => s.trim())
        .filter(s => !isValidEmail(s));

      if (emails.length) {
        result.issues.push(new ValidationIssue(context, {
          type: type,
          subtype: 'email',
          severity: 'warning',
          message: function(this: any) {
            const graph = editor.staging.graph;
            const entity = graph.hasEntity(this.entityIds[0]);
            return entity ? l10n.t('issues.invalid_format.email.message', {
              n: emails.length,
              feature: l10n.displayLabel(entity, graph),
              email: emails.join(', ')
            }) : '';
          },
          reference: showReferenceEmail,
          entityIds: [entity.id],
          hash: emails.join()
        }));
      }
    }

    return result;
  };


  validator.type = type;
  return validator;
}
