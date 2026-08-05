import { drag as d3_drag } from 'd3-drag';
import { select as d3_select } from 'd3-selection';
import { vecLength, vecSubtract } from '@rapid-sdk/math';
import { utilUniqueString } from '@rapid-sdk/util';

import { actionChangeMember } from '../../actions/change_member.js';
import { actionDeleteMember } from '../../actions/delete_member.js';
import { actionMoveMember } from '../../actions/move_member.js';
import { uiIcon } from '../icon.js';
import { uiCombobox } from '../combobox.js';
import { AbstractUiSection } from '../AbstractUiSection.js';
import { utilHighlightEntities, utilIsColorValid, utilNoAuto } from '../../util/util.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { OsmEntity } from '../../data/index.ts';
import type { OsmRelation, OsmRelationMember } from '../../data/index.ts';

const MAX_MEMBERS = 1000;

interface MemberRowData {
  index: number;
  id: EntityID;
  type: string;
  role: string;
  relation: OsmRelation;
  member?: OsmEntity;
  uid: string;
}


export class UiSectionRawMemberEditor extends AbstractUiSection {
  protected _entityIDs: EntityID[];

  public constructor(context: Context) {
    super(context, 'raw-member-editor');
    this._entityIDs = [];

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._downloadMember = this._downloadMember.bind(this);
    this._zoomToMember = this._zoomToMember.bind(this);
    this._selectMember = this._selectMember.bind(this);
    this._changeRole = this._changeRole.bind(this);
    this._deleteMember = this._deleteMember.bind(this);
    this._bindCombo = this._bindCombo.bind(this);
    this._unbindCombo = this._unbindCombo.bind(this);
  }


  /**
   * Whether this section should display (only for a single selected relation).
   * @return `true` if the single selected entity is a relation
   */
  public override shouldDisplay(): boolean {
    const editor = this.context.systems.editor!;
    if (!this._entityIDs || this._entityIDs.length !== 1) return false;

    const graph = editor.staging.graph;  // the current graph
    const entity = graph.hasEntity(this._entityIDs[0]);
    return entity?.type === 'relation';
  }


  /**
   * The disclosure heading label — "Members (N)".
   * @return Localized heading text
   */
  public override label(): string {
    const editor = this.context.systems.editor!;
    const l10n = this.context.systems.l10n!;
    const graph = editor.staging.graph;  // the current graph
    const entity = graph.hasEntity(this._entityIDs[0]) as OsmRelation | undefined;
    if (!entity) return '';

    const gt = entity.members.length > MAX_MEMBERS ? '>' : '';
    const count = gt + entity.members.slice(0, MAX_MEMBERS).length;
    return l10n.t('inspector.title_count', { title: l10n.t('inspector.members'), count: count });
  }


  /**
   * Downloads an incomplete member entity, then re-renders.
   * @param d3_event - the triggering click event
   * @param d - the member row datum
   */
  protected _downloadMember(d3_event: Event, d: MemberRowData): void {
    d3_event.preventDefault();

    // display the loading indicator
    d3_select(d3_event.currentTarget.parentNode).classed('tag-reference-loading', true);
    this.context.loadEntityAsync(d.id)
      .then(() => this.reRender());
  }


  /**
   * Zooms the map to a member entity and highlights it.
   * @param d3_event - the triggering click event
   * @param d - the member row datum
   */
  protected _zoomToMember(d3_event: Event, d: MemberRowData): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    d3_event.preventDefault();

    const graph = editor.staging.graph;
    const entity = graph.entity(d.id);
    map.fitEntitiesEase(entity);

    // highlight the feature in case it wasn't previously on-screen
    utilHighlightEntities(context, [d.id], true);
  }


  /**
   * Selects a member entity (zooming to it if off-screen).
   * @param d3_event - the triggering click event
   * @param d - the member row datum
   */
  protected _selectMember(d3_event: Event, d: MemberRowData): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const map = context.systems.map!;
    const viewport = context.viewport;
    d3_event.preventDefault();

    // remove the hover-highlight styling
    utilHighlightEntities(context, [d.id], false);

    const graph = editor.staging.graph;
    const entity = graph.entity(d.id);
    const extent = viewport.visibleExtent();
    if (!entity.intersects(extent, graph)) {
      // zoom to the entity if its extent is not visible now
      map.fitEntitiesEase(entity);
    }

    context.enter('select-osm', { selection: { osm: [d.id] }} );
  }


  /**
   * Changes a member's role and commits the edit.
   * @param d3_event - the triggering blur/change event
   * @param d - the member row datum
   */
  protected _changeRole(d3_event: Event, d: MemberRowData): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const oldRole = d.role;
    const newRole = context.cleanRelationRole(d3_select(d3_event.currentTarget).property('value'));

    if (oldRole !== newRole) {
      const member = { id: d.id, type: d.type, role: newRole };
      editor.perform(actionChangeMember(d.relation.id, member, d.index));
      editor.commit({
        annotation: l10n.t('operations.change_role.annotation', { n: 1 }),
        selectedIDs: [d.relation.id]
      });
    }
  }


  /**
   * Deletes a member from the relation (may delete the relation and exit select mode).
   * @param d3_event - the triggering click event
   * @param d - the member row datum
   */
  protected _deleteMember(d3_event: Event, d: MemberRowData): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    utilHighlightEntities(context, [d.id], false);  // remove the hover-highlight styling

    editor.perform(actionDeleteMember(d.relation.id, d.index));
    editor.commit({
      annotation: l10n.t('operations.delete_member.annotation', { n: 1 }),
      selectedIDs: [d.relation.id]
    });

    const graph = editor.staging.graph;  // the current graph, after the edit was performed

    // Removing the last member will also delete the relation. If this happens we need to exit select mode
    if (!graph.hasEntity(d.relation.id)) {
      context.enter('browse');
    }
  }


  /**
   * Renders the member list (labels, roles, drag-to-reorder).
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const taginfo = context.services.taginfo;

    const graph = editor.staging.graph;  // the current graph
    const entityID = this._entityIDs[0];
    const entity = graph.entity(entityID) as OsmRelation;
    const memberships: MemberRowData[] = [];

    entity.members.slice(0, MAX_MEMBERS).forEach((member: OsmRelationMember, index: number) => {
      memberships.push({
        index: index,
        id: member.id,
        type: member.type,
        role: member.role,
        relation: entity,
        member: graph.hasEntity(member.id),
        uid: utilUniqueString(`${entityID}-member-${index}`)
      });
    });

    let $list: D3Selection = $selection.selectAll('.member-list')
      .data([0]);

    $list = $list.enter()
      .append('ul')
      .attr('class', 'member-list')
      .merge($list);


    let $items: D3Selection = $list.selectAll('li')
      .data(memberships, (d: MemberRowData) => {
        const parentKey = d.relation.key;
        const childKey = d.member?.key || 'incomplete';
        return `${parentKey},${d.index},${childKey}`;
      });

    $items.exit()
      .each(this._unbindCombo)
      .remove();

    const $$items = $items.enter()
      .append('li')
      .attr('class', 'member-row form-field')
      .classed('member-incomplete', (d: MemberRowData) => !d.member);

    $$items
      .each((d: MemberRowData, i, nodes) => {
        const $item = d3_select(nodes[i]);

        const $label = $item
          .append('label')
          .attr('class', 'field-label')
          .attr('for', d.uid);

        if (d.member) {    // if the child has been loaded
          $item
            .on('mouseover', () => utilHighlightEntities(context, [d.id], true))
            .on('mouseout', () => utilHighlightEntities(context, [d.id], false));

          const $labelLink = $label
            .append('span')
            .attr('class', 'label-text')
            .append('a')
            .attr('href', '#')
            .on('click', this._selectMember);

          $labelLink
            .append('span')
            .attr('class', 'member-entity-type')
            .text((d: MemberRowData) => {
              const preset = schema.match(d.member, graph);
              return preset?.name || l10n.displayType(d.member!.id);
            });

          $labelLink
            .append('span')
            .attr('class', 'member-entity-name')
            .classed('has-color', (d: MemberRowData) => !!this._getColor(d.member))
            .style('border-color', (d: MemberRowData) => this._getColor(d.member))
            .text((d: MemberRowData) => (d.member ? l10n.displayName(d.member.tags) : ''));

          $label
            .append('button')
            .attr('title', l10n.t('icons.remove'))
            .attr('class', 'remove member-delete')
            .call(uiIcon('#rapid-operation-delete'));

          $label
            .append('button')
            .attr('class', 'member-zoom')
            .attr('title', l10n.t('icons.zoom_to'))
            .call(uiIcon('#rapid-icon-framed-dot', 'monochrome'))
            .on('click', this._zoomToMember);

        } else {   // if the child has not yet loaded
          const $labelText = $label
            .append('span')
            .attr('class', 'label-text');

          $labelText
            .append('span')
            .attr('class', 'member-entity-type')
            .text(l10n.t(`inspector.${d.type}`, { id: d.id }));

          $labelText
            .append('span')
            .attr('class', 'member-entity-name')
            .text(l10n.t('inspector.incomplete', { id: d.id }));

          $label
            .append('button')
            .attr('class', 'member-download')
            .attr('title', l10n.t('icons.download'))
            .call(uiIcon('#rapid-icon-load'))
            .on('click', this._downloadMember);
        }
      });

    const $$wrap = $$items
      .append('div')
      .attr('class', 'form-field-input-wrap form-field-input-member');

    $$wrap
      .append('input')
      .attr('class', 'member-role')
      .attr('id', (d: MemberRowData) => d.uid)
      .property('type', 'text')
      .attr('placeholder', l10n.t('inspector.role'))
      .call(utilNoAuto);

    if (taginfo) {
      $$wrap.each(this._bindCombo);
    }

    // update
    $items = $items
      .merge($$items)
      .order();

    $items.select('input.member-role')
      .property('value', (d: MemberRowData) => d.role)
      .on('blur', this._changeRole)
      .on('change', this._changeRole);

    $items.select('button.member-delete')
      .on('click', this._deleteMember);

    let x0: number, y0: number, targetIndex: number | null;

    $items.call(d3_drag()
      .on('start', function(d3_event: Event) {
        x0 = d3_event.x as number;
        y0 = d3_event.y as number;
        targetIndex = null;
      })
      .on('drag', function(this: any, d3_event: any) {
        const [x1, y1] = [d3_event.x, d3_event.y];
        const [dx, dy] = vecSubtract([x1, y1], [x0, y0]);

        // don't display drag until dragging beyond a distance threshold
        if (!d3_select(this).classed('dragging') && vecLength([dx, dy]) <= 5) return;

        const index = $items.nodes().indexOf(this);

        d3_select(this)
          .classed('dragging', true);

        targetIndex = null;

        $selection.selectAll('li.member-row')
          .style('transform', function(this: any, d2: MemberRowData, index2: number) {
            const node = d3_select(this).node();
            if (index === index2) {
              return `translate(${dx}px, ${dy}px)`;
            } else if (index2 > index && y1 > node.offsetTop) {
              if (targetIndex === null || index2 > targetIndex) {
                targetIndex = index2;
              }
              return 'translateY(-100%)';
            } else if (index2 < index && y1 < node.offsetTop + node.offsetHeight) {
              if (targetIndex === null || index2 < targetIndex) {
                targetIndex = index2;
              }
              return 'translateY(100%)';
            }
            return null;
          });
      })
      .on('end', function(this: any, d3_event: any, d: MemberRowData) {
        if (!d3_select(this).classed('dragging')) return;

        const index = $items.nodes().indexOf(this);

        d3_select(this)
          .classed('dragging', false);

        $selection.selectAll('li.member-row')
          .style('transform', null);

        if (targetIndex !== null) {   // dragged to a new position, reorder
          editor.perform(actionMoveMember(d.relation.id, index, targetIndex));
          editor.commit({
            annotation: l10n.t('operations.reorder_members.annotation'),
            selectedIDs: [d.relation.id]
          });
        }
      })
    );
  }


  /**
   * Gets or sets the entity IDs being edited.
   * @param val - the new entity IDs, or omit to get the current value
   * @return the current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._entityIDs;
    this._entityIDs = val || [];
    return this;
  }


  /**
   * Returns the border color for a member, if it has a valid `colour` tag.
   * @param entity - the member entity
   * @return a valid color string, or `null`
   */
  protected _getColor(entity: OsmEntity | undefined): string | null {
    const val = entity?.type === 'relation' && entity?.tags.colour;
    return (val && utilIsColorValid(val)) ? val : null;
  }


  /**
   * Binds the role-input combobox (taginfo role autocomplete) to a member row.
   * @param d - the member row datum
   * @param i - the row index within the selection
   * @param nodes - the selection's DOM nodes
   */
  protected _bindCombo(d: MemberRowData, i: number, nodes: ArrayLike<HTMLElement>): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const taginfo = context.services.taginfo;

    const $row = d3_select(nodes[i]);
    const $role = $row.selectAll('input.member-role');
    const origValue = $role.property('value');

    function sort(value: string, data: any[]): any[] {
      const sameletter = [];
      const other = [];
      for (const item of data) {
        if (item.value.substring(0, value.length) === value) {
          sameletter.push(item);
        } else {
          other.push(item);
        }
      }
      return sameletter.concat(other);
    }

    $role.call(uiCombobox(context, 'member-role')
      .fetcher(function(role: string, callback: (data: any[]) => void) {
        // The `geometry` param is used in the `taginfo.js` interface for
        // filtering results, as a key into the `tag_members_fractions`
        // object.  If we don't know the geometry because the member is
        // not yet downloaded, it's ok to guess based on type.
        let geometry;
        if (d.member) {
          const graph = editor.staging.graph;  // the current graph
          geometry = d.member.geometry(graph);
        } else if (d.type === 'relation') {
          geometry = 'relation';
        } else if (d.type === 'way') {
          geometry = 'line';
        } else {
          geometry = 'point';
        }

        taginfo!.roles({
          debounce: true,
          rtype: d.relation.tags.type || '',
          geometry: geometry,
          query: role
        }, (err: any, data: any) => {
          if (!err) callback(sort(role, data));
        });
      })
      .on('cancel', () => {
        $role.property('value', origValue);
      })
    );
  }


  /**
   * Unbinds the role-input combobox from a member row (on exit).
   * @param d - the member row datum
   * @param i - the row index within the selection
   * @param nodes - the selection's DOM nodes
   */
  protected _unbindCombo(d: MemberRowData, i: number, nodes: ArrayLike<HTMLElement>): void {
    const $row = d3_select(nodes[i]);
    $row.selectAll('input.member-role')
      .call(uiCombobox.off, this.context);
  }
}
