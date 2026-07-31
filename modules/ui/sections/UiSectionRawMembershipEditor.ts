import { select as d3_select } from 'd3-selection';
import { utilArrayGroupBy, utilArrayIntersection, utilUniqueString } from '@rapid-sdk/util';

import { actionAddEntity } from '../../actions/add_entity.js';
import { actionAddMember } from '../../actions/add_member.js';
import { actionChangeMember } from '../../actions/change_member.js';
import { actionDeleteMembers } from '../../actions/delete_members.js';
import { OsmEntity, OsmRelation } from '../../data/index.ts';
import { uiIcon } from '../icon.js';
import { uiCombobox } from '../combobox.js';
import { AbstractUiSection } from '../AbstractUiSection.js';
import { uiTooltip } from '../tooltip.js';
import { utilNoAuto, utilIsColorValid, utilHighlightEntities } from '../../util/util.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';

const MAX_MEMBERSHIPS = 1000;


export class UiSectionRawMembershipEditor extends AbstractUiSection {
  protected _nearbyCombo: any;
  protected _inChange: boolean;
  protected _entityIDs: EntityID[];
  protected _showBlank: boolean;

  public constructor(context: Context) {
    super(context, 'raw-membership-editor');
    this._inChange = false;
    this._entityIDs = [];
    this._showBlank = false;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._fetchNearbyRelations = this._fetchNearbyRelations.bind(this);
    this._selectRelation = this._selectRelation.bind(this);
    this._zoomToRelation = this._zoomToRelation.bind(this);
    this._changeRole = this._changeRole.bind(this);
    this._deleteMembership = this._deleteMembership.bind(this);

    this._nearbyCombo = uiCombobox(context, 'parent-relation')
      .minItems(1)
      .fetcher(this._fetchNearbyRelations)
      .itemsMouseEnter((d3_event: Event, d: any) => {
        if (d.relation) utilHighlightEntities(context, [d.relation.id], true);
      })
      .itemsMouseLeave((d3_event: Event, d: any) => {
        if (d.relation) utilHighlightEntities(context, [d.relation.id], false);
      });
  }


  /**
   * Whether this section should display (any entities are selected).
   * @return `true` if there is at least one selected entity
   */
  public override shouldDisplay(): boolean {
    return this._entityIDs && this._entityIDs.length > 0;
  }


  /**
   * The disclosure heading label — "Relations (N)".
   * @return Localized heading text
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    const parents = this._getSharedParentRelations();
    const gt = parents.length > MAX_MEMBERSHIPS ? '>' : '';
    const count = gt + parents.slice(0, MAX_MEMBERSHIPS).length;
    return l10n.t('inspector.title_count', { title: l10n.t('inspector.relations'), count: count });
  }


  /**
   * Returns the relations shared as parents by all selected entities.
   * @return the shared parent relations
   */
  protected _getSharedParentRelations(): any[] {
    const editor = this.context.systems.editor!;
    let parents: any[] = [];
    for (let i = 0; i < this._entityIDs.length; i++) {
      const graph = editor.staging.graph;
      const entity = graph.hasEntity(this._entityIDs[i]);
      if (!entity) continue;

      if (i === 0) {
        parents = graph.parentRelations(entity);
      } else {
        parents = utilArrayIntersection(parents, graph.parentRelations(entity));
      }
      if (!parents.length) break;
    }
    return parents;
  }


  /**
   * Builds the membership rows (one per relation, or per membership for single selections).
   * @return the membership row data
   */
  protected _getMemberships(): any[] {
    const memberships: any[] = [];
    const relations = this._getSharedParentRelations().slice(0, MAX_MEMBERSHIPS);

    const isMultiselect = this._entityIDs.length > 1;

    let membership, member, indexedMember;
    for (const relation of relations) {
      membership = {
        relation: relation,
        members: [] as any[],
        hash: relation.key
      };
      for (let index = 0; index < relation.members.length; index++) {
        member = relation.members[index];
        if (this._entityIDs.indexOf(member.id) !== -1) {
          indexedMember = Object.assign({}, member, { index: index });
          membership.members.push(indexedMember);
          membership.hash += ',' + index.toString();

          if (!isMultiselect) {
            // For single selections, list one entry per membership per relation.
            // For multiselections, list one entry per relation.

            memberships.push(membership);
            membership = {
              relation: relation,
              members: [] as any[],
              hash: relation.key
            };
          }
        }
      }
      if (membership.members.length) memberships.push(membership);
    }

    memberships.forEach(function(membership: any) {
      membership.uid = utilUniqueString('membership-' + membership.relation.id);
      const roles: any[] = [];
      membership.members.forEach(function(member: any) {
        if (roles.indexOf(member.role) === -1) roles.push(member.role);
      });
      membership.role = roles.length === 1 ? roles[0] : roles;
    });

    return memberships;
  }


  /**
   * Selects the parent relation for a membership row.
   * @param d3_event - the triggering click event
   * @param d - the membership row datum
   */
  protected _selectRelation(d3_event: Event, d: any): void {
    const context = this.context;
    d3_event.preventDefault();

    // remove the hover-highlight styling
    utilHighlightEntities(context, [d.relation.id], false);

    context.enter('select-osm', { selection: { osm: [d.relation.id] }} );
  }


  /**
   * Zooms the map to a parent relation and highlights it.
   * @param d3_event - the triggering click event
   * @param d - the membership row datum
   */
  protected _zoomToRelation(d3_event: Event, d: any): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    d3_event.preventDefault();

    const graph = editor.staging.graph;
    const entity = graph.entity(d.relation.id);
    map.fitEntitiesEase(entity);

    // highlight the relation in case it wasn't previously on-screen
    utilHighlightEntities(context, [d.relation.id], true);
  }


  /**
   * Returns the border color for a relation, if it has a valid `colour` tag.
   * @param entity - the relation entity
   * @return a valid color string, or `null`
   */
  protected _getColor(entity: any): string | null {
    const val = entity?.type === 'relation' && entity?.tags.colour;
    return (val && utilIsColorValid(val)) ? val : null;
  }


  /**
   * Changes the role for the selected entities within a relation and commits.
   * @param d3_event - the triggering blur/change event
   * @param d - the membership row datum
   */
  protected _changeRole(d3_event: any, d: any): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    if (d === 0) return;    // called on newrow (shouldn't happen)
    if (this._inChange) return;  // avoid accidental recursive call iD#5731

    const newRole = context.cleanRelationRole(d3_select(d3_event.currentTarget).property('value'));

    if (!newRole.trim() && typeof d.role !== 'string') return;

    const membersToUpdate = d.members.filter(function(member: any) {
      return member.role !== newRole;
    });

    if (membersToUpdate.length) {
      this._inChange = true;

      const changeMemberRoles = (graph: any) => {
        for (const member of membersToUpdate) {
          const newMember = Object.assign({}, member, { role: newRole });
          delete newMember.index;
          graph = actionChangeMember(d.relation.id, newMember, member.index)(graph);
        }
        return graph;
      };

      editor.perform(changeMemberRoles);
      editor.commit({
        annotation: l10n.t('operations.change_role.annotation', { n: membersToUpdate.length }),
        selectedIDs: [d.relation.id]
      });
    }
    this._inChange = false;
  }


  /**
   * Adds the selected entities to a relation (creating a new relation if needed).
   * @param d - the membership row datum (or new-row datum with a null relation)
   * @param role - the role to assign
   */
  protected _addMembership(d: any, role: string): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    (document.activeElement as HTMLElement | null)?.blur();   // avoid keeping focus on the button
    this._showBlank = false;

    const entityIDs = this._entityIDs;
    function actionAddMembers(relationId: EntityID, ids: EntityID[], role: string) {
      return function(graph: any) {
        for (const i in ids) {
          const member = { id: ids[i], type: graph.entity(ids[i]).type, role: role };
          graph = actionAddMember(relationId, member)(graph);
        }
        return graph;
      };
    }

    if (d.relation) {
      editor.perform(actionAddMembers(d.relation.id, entityIDs, role));
      editor.commit({
        annotation: l10n.t('operations.add_member.annotation', { n: entityIDs.length }),
        selectedIDs: [d.relation.id]
      });

    } else {
      const relation = new OsmRelation(context);
      editor.perform(
        actionAddEntity(relation),
        actionAddMembers(relation.id, entityIDs, role)
      );
      editor.commit({
        annotation: l10n.t('operations.add.annotation.relation'),
        selectedIDs: [relation.id]
      });
      context.enter('select-osm', { selection: { osm: [relation.id] }, newFeature: true });
    }
  }


  /**
   * Removes the selected entities' memberships from a relation and commits.
   * @param d3_event - the triggering click event
   * @param d - the membership row datum
   */
  protected _deleteMembership(d3_event: any, d: any): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;

    d3_event.currentTarget.blur();   // avoid keeping focus on the button
    if (d === 0) return;   // called on newrow (shouldn't happen)

    // remove the hover-highlight styling
    utilHighlightEntities(context, [d.relation.id], false);

    const indexes = d.members.map(function(member: any) {
      return member.index;
    });

    editor.perform(actionDeleteMembers(d.relation.id, indexes));
    editor.commit({
      annotation: l10n.t('operations.delete_member.annotation', { n: this._entityIDs.length }),
      selectedIDs: [d.relation.id]
    });
  }


  /**
   * Combobox fetcher: returns nearby relations matching the query.
   * @param q - the search query
   * @param callback - receives the combobox result data
   */
  protected _fetchNearbyRelations(q: string, callback: (data: any[]) => void): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;
    const l10n = context.systems.l10n!;

    const newRelation = {
      relation: null,
      value: l10n.t('inspector.new_relation'),
      display: l10n.t('inspector.new_relation')
    };

    const entityID = this._entityIDs[0];
    const result: any[] = [];
    const graph = editor.staging.graph;

    function baseDisplayValue(entity: any): string {
      const preset = schema.match(entity, graph);
      const presetName = preset?.name || l10n.t('inspector.relation');
      const entityName = l10n.displayName(entity.tags) || '';
      return presetName + ' ' + entityName;
    }

    const baseDisplayLabel = (entity: any): ($selection: D3Selection) => void => {
      const preset = schema.match(entity, graph);
      const presetName = preset?.name || l10n.t('inspector.relation');
      const entityName = l10n.displayName(entity.tags) || '';
      const color = this._getColor(entity);

      return ($selection: D3Selection) => {
        $selection
          .append('b')
          .text(presetName + ' ');
        $selection
          .append('span')
          .classed('has-color', !!color)
          .style('border-color', color as any)
          .text(entityName);
      };
    };

    const explicitRelation = q && graph.hasEntity(q.toLowerCase());
    if (explicitRelation && explicitRelation.type === 'relation' && explicitRelation.id !== entityID) {
      // loaded relation is specified explicitly, only show that
      result.push({
        relation: explicitRelation,
        value: baseDisplayValue(explicitRelation) + ' ' + explicitRelation.id,
        display: baseDisplayLabel(explicitRelation)
      });

    } else {
      editor.intersects().forEach(function(entity: any) {
        if (entity.type !== 'relation' || entity.id === entityID) return;

        const value = baseDisplayValue(entity);
        if (q && (value + ' ' + entity.id).toLowerCase().indexOf(q.toLowerCase()) === -1) return;

        result.push({
          relation: entity,
          value: value,
          display: baseDisplayLabel(entity)
        });
      });

      result.sort(function(a, b) {
        return OsmEntity.creationOrder(a.relation, b.relation);
      });

      // Dedupe identical names by appending relation id - see iD#2891
      const dupeGroups = Object.values(utilArrayGroupBy(result, 'value'))
        .filter(function(v: any) { return v.length > 1; });

      dupeGroups.forEach(function(group: any) {
        group.forEach(function(obj: any) {
          obj.value += ' ' + obj.relation.id;
        });
      });
    }

    result.forEach(function(obj: any) {
      obj.title = obj.value;
    });

    result.unshift(newRelation);
    callback(result);
  }


  /**
   * Renders the membership list plus the add-to-relation controls.
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const schema = context.systems.schema!;
    const l10n = context.systems.l10n!;
    const taginfo = context.services.taginfo;
    const addMembership = this._addMembership.bind(this);
    const entityIDs = this._entityIDs;

    const graph = editor.staging.graph;

    const memberships = this._getMemberships();
    let $list: D3Selection = $selection.selectAll('.member-list')
      .data([0]);

    $list = $list.enter()
      .append('ul')
      .attr('class', 'member-list')
      .merge($list);


    const $items: D3Selection = $list.selectAll('li.member-row-normal')
      .data(memberships, function(d: any) {
        return d.hash;
      });

    $items.exit()
      .each(unbind)
      .remove();

    // Enter
    const $$items = $items.enter()
      .append('li')
      .attr('class', 'member-row member-row-normal form-field');

    // highlight the relation in the map while hovering on the list item
    $$items
      .on('mouseover', function(d3_event: Event, d: any) {
        utilHighlightEntities(context, [d.relation.id], true);
      })
      .on('mouseout', function(d3_event: Event, d: any) {
        utilHighlightEntities(context, [d.relation.id], false);
      });

    const $$label = $$items
      .append('label')
      .attr('class', 'field-label')
      .attr('for', (d: any) => d.uid);

    const $$labelLink = $$label
      .append('span')
      .attr('class', 'label-text')
      .append('a')
      .attr('href', '#')
      .on('click', this._selectRelation);

    $$labelLink
      .append('span')
      .attr('class', 'member-entity-type')
      .text((d: any) => {
        const preset = schema.match(d.relation, graph);
        return preset?.name || l10n.t('inspector.relation');
      });

    $$labelLink
      .append('span')
      .attr('class', 'member-entity-name')
      .classed('has-color', (d: any) => !!this._getColor(d.relation))
      .style('border-color', (d: any) => this._getColor(d.relation))
      .text((d: any) => {
        const preset = schema.match(d.relation, graph);
        const isNsiPreset = preset?.suggestion;
        // For NSI presets, we dont want to display the network name twice
        return l10n.displayName(d.relation.tags, isNsiPreset);
      });

    $$label
      .append('button')
      .attr('class', 'remove member-delete')
      .call(uiIcon('#rapid-operation-delete'))
      .on('click', this._deleteMembership);

    $$label
      .append('button')
      .attr('class', 'member-zoom')
      .attr('title', l10n.t('icons.zoom_to'))
      .call(uiIcon('#rapid-icon-framed-dot', 'monochrome'))
      .on('click', this._zoomToRelation);

    const $$wrap = $$items
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-member');

    $$wrap
      .append('input')
      .attr('class', 'member-role')
      .attr('id', function(d: any) {
        return d.uid;
      })
      .property('type', 'text')
      .property('value', function(d: any) {
        return typeof d.role === 'string' ? d.role : '';
      })
      .attr('title', function(d: any) {
        return Array.isArray(d.role) ? d.role.filter(Boolean).join('\n') : d.role;
      })
      .attr('placeholder', function(d: any) {
        return Array.isArray(d.role) ? l10n.t('inspector.multiple_roles') : l10n.t('inspector.role');
      })
      .classed('mixed', function(d: any) {
        return Array.isArray(d.role);
      })
      .call(utilNoAuto)
      .on('blur', this._changeRole)
      .on('change', this._changeRole);

    if (taginfo) {
      $$wrap.each(bindTypeahead);
    }

    let $newMembership: D3Selection = $list.selectAll('.member-row-new')
      .data(this._showBlank ? [0] : []);

    // Exit
    $newMembership.exit()
      .remove();

    // Enter
    const $$newMembership = $newMembership.enter()
      .append('li')
      .attr('class', 'member-row member-row-new form-field');

    const $$newLabel = $$newMembership
      .append('label')
      .attr('class', 'field-label');

    $$newLabel
      .append('input')
      .attr('type', 'text')
      .attr('class', 'member-entity-input')
      .call(utilNoAuto);

    $$newLabel
      .append('button')
      .attr('class', 'remove member-delete')
      .call(uiIcon('#rapid-operation-delete'))
      .on('click', () => {
        $list.selectAll('.member-row-new')
          .remove();
      });

    const $$newWrap = $$newMembership
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-member');

    $$newWrap
      .append('input')
      .attr('class', 'member-role')
      .property('type', 'text')
      .call(utilNoAuto);

    // Update
    $newMembership = $newMembership
      .merge($$newMembership);

    // set localized placeholders on the update selection so they re-localize on language change
    $newMembership.selectAll('.member-entity-input')
      .attr('placeholder', l10n.t('inspector.choose_relation'));

    $newMembership.selectAll('.member-role')
      .attr('placeholder', l10n.t('inspector.role'));

    $newMembership.selectAll('.member-entity-input')
      .on('blur', cancelEntity)   // if it wasn't accepted normally, cancel it
      .call(this._nearbyCombo
        .on('accept', acceptEntity)
        .on('cancel', cancelEntity)
      );


    // Container for the Add button
    let $addRow: D3Selection = $selection.selectAll('.add-row')
      .data([0]);

    // enter
    const $$addRow = $addRow.enter()
      .append('div')
      .attr('class', 'add-row');

    const $$addRelationButton = $$addRow
      .append('button')
      .attr('class', 'add-relation');

    $$addRelationButton
      .call(uiIcon('#rapid-icon-plus', 'light'));
    $$addRelationButton
      .call(uiTooltip(context)
        .title(l10n.t('inspector.add_to_relation'))
        .placement(l10n.isRTL ? 'left' : 'right')
       );

    $$addRow
      .append('div')
      .attr('class', 'space-value');   // preserve space

    $$addRow
      .append('div')
      .attr('class', 'space-buttons');  // preserve space

    // update
    $addRow = $addRow
      .merge($$addRow);

    $addRow.select('.add-relation')
      .on('click', () => {
        this._showBlank = true;
        this.reRender();
        ($list.selectAll('.member-entity-input').node() as HTMLElement).focus();
      });


    function acceptEntity(d: any): void {
      if (!d) {
        cancelEntity();
        return;
      }
      // remove hover-higlighting
      if (d.relation) utilHighlightEntities(context, [d.relation.id], false);

      const role = context.cleanRelationRole($list.selectAll('.member-row-new .member-role').property('value'));
      addMembership(d, role);
    }


    function cancelEntity(): void {
      const $input = $newMembership.selectAll('.member-entity-input');
      $input.property('value', '');

      // remove hover-higlighting
      // old
      //context.surface().selectAll('.highlighted')
      //    .classed('highlighted', false);
    }


    function bindTypeahead(this: any, d: any): void {
      const $row = d3_select(this);
      const $role = $row.selectAll('input.member-role');
      const origValue = $role.property('value');

      function sort(value: string, data: any[]): any[] {
        const sameletter = [];
        const other = [];
        for (const d of data) {
          if (d.value.substring(0, value.length) === value) {
            sameletter.push(d);
          } else {
            other.push(d);
          }
        }
        return sameletter.concat(other);
      }

      $role.call(uiCombobox(context, 'member-role')
        .fetcher(function(role: string, callback: (data: any[]) => void) {
          const graph = editor.staging.graph;
          const entity = graph.hasEntity(entityIDs[0]);
          const geometry = entity?.geometry(graph);
          const rtype = d.relation.tags.type;
          taginfo!.roles({
            debounce: true,
            rtype: rtype || '',
            geometry: geometry || undefined,
            query: role
          }, function(err: any, data: any) {
            if (!err) callback(sort(role, data));
          });
        })
        .on('cancel', function() {
          $role.property('value', origValue);
        })
      );
    }


    function unbind(this: any): void {
      const $row = d3_select(this);

      $row.selectAll('input.member-role')
        .call(uiCombobox.off, context);
    }
  }


  /**
   * Gets or sets the entity IDs being edited.
   * @param val - the new entity IDs, or omit to get the current value
   * @return the current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;
    this._entityIDs = val ?? [];
    this._showBlank = false;
    return this;
  }
}
