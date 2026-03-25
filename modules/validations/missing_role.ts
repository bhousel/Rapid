import { actionChangeMember } from '../actions/change_member.ts';
import { actionDeleteMember } from '../actions/delete_member.ts';
import { ValidationIssue } from '../lib/ValidationIssue.ts';
import { ValidationFix } from '../lib/ValidationFix.ts';

import type { Context } from '../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { Graph } from '../lib/Graph.ts';
import type { IndexedMember, OsmEntity, OsmRelation, OsmWay } from '../data/types.ts';
import type { ValidatorFunction } from './types.ts';


/**
 * Factory that creates a validator for detecting multipolygon members
 * that are missing their `inner` or `outer` role.
 * @param context
 * @returns Validator function
 */
export function validationMissingRole(context: Context): ValidatorFunction {
  const type = 'missing_role' as ValidatorID;
  const editor = context.systems.editor!;
  const l10n = context.systems.l10n!;


  /**
   * Checks whether multipolygon relation members have assigned roles.
   * Inspects the entity as both a way (checking parent relations) and as
   * a multipolygon relation (checking its own members).
   * @param entity - The entity to validate
   * @param graph - The current graph
   * @returns Array of issues for members missing roles
   */
  const validation = function checkMissingRole(entity: OsmEntity, graph: Graph): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (entity.type === 'way') {
      for (const relation of graph.parentRelations(entity)) {
        if (!relation.isMultipolygon()) continue;

        const member = relation.memberById(entity.id);
        if (member && isMissingRole(member)) {
          issues.push(makeIssue(entity as OsmWay, relation, member));
        }
      }

    } else if (entity.type === 'relation' && (entity as OsmRelation).isMultipolygon()) {
      for (const member of (entity as OsmRelation).indexedMembers()) {
        const way = graph.hasEntity(member.id);
        if (way && isMissingRole(member)) {
          issues.push(makeIssue(way as OsmWay, entity as OsmRelation, member));
        }
      }
    }

    return issues;
  };


  /**
   * Tests whether a relation member has an empty or missing role.
   * @param member - The indexed member to check
   * @returns `true` if the role is missing or blank
   */
  function isMissingRole(member: IndexedMember): boolean {
    return !member.role || !member.role.trim().length;
  }


  /**
   * Creates a validation issue for a multipolygon member with a missing role.
   * @param way - The way that is missing a role
   * @param relation - The parent multipolygon relation
   * @param member - The indexed member entry
   * @returns A validation issue with fixes to set the role or remove the member
   */
  function makeIssue(way: OsmWay, relation: OsmRelation, member: IndexedMember): ValidationIssue {
    return new ValidationIssue(context, {
      type: type,
      severity: 'warning',
      message: function(this: any) {
        const graph = editor.staging.graph;
        const member = graph.hasEntity(this.entityIds[1]);
        const relation = graph.hasEntity(this.entityIds[0]);
        return (member && relation) ? l10n.t('issues.missing_role.message', {
          member: l10n.displayLabel(member, graph),
          relation: l10n.displayLabel(relation, graph)
        }) : '';
      },
      reference: showReference,
      entityIds: [relation.id, way.id],
      data:  { member: member },
      hash: member.index.toString(),
      dynamicFixes: function(this: any) {
        return [
          makeAddRoleFix('inner'),
          makeAddRoleFix('outer'),
          new ValidationFix({
            icon: 'rapid-operation-delete',
            title: l10n.t('issues.fix.remove_from_relation.title'),
            onClick: () => {
              const parentID = this.issue.entityIds[0];
              editor.perform(actionDeleteMember(parentID, this.issue.data.member.index));
              editor.commit({
                annotation: l10n.t('operations.delete_member.annotation', { n: 1 }),
                selectedIDs: [parentID]
              });
            }
          })
        ];
      }
    });


    /** Renders the issue reference text into the given selection. */
    function showReference($selection: D3Selection): void {
      $selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .text(l10n.t('issues.missing_role.multipolygon.reference'));
    }
  }


  /**
   * Creates a fix that sets the member's role to the given value.
   * @param role - The role to assign (e.g. 'inner' or 'outer')
   * @returns A validation fix that applies the role change
   */
  function makeAddRoleFix(this: any, role: string): ValidationFix {
    return new ValidationFix({
      title: l10n.t(`issues.fix.set_as_${role}.title`),
      onClick: () => {
        const oldMember = this.issue.data.member;
        const member = { id: this.issue.entityIds[1], type: oldMember.type, role: role };
        editor.perform(actionChangeMember(this.issue.entityIds[0], member, oldMember.index));
        editor.commit({
          annotation: l10n.t('operations.change_role.annotation', { n: 1 }),
          selectedIDs: [member.id]
        });
      }
    });
  }

  validation.type = type;

  return validation;
}
