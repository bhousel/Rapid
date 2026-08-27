import { select } from 'd3-selection';
import { uiIcon } from '../icon.ts';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { utilHighlightEntities } from '../../util/util.ts';

import type { Context } from '../../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { OsmEntity } from '../../data/index.ts';


/**
 * `UiSectionSelectionList` appears when the user has multiple
 * entities selected.  It lives in the `UiEntityEditor`.
 */
export class UiSectionSelectionList extends AbstractUiSection {
  protected _selectedIDs: EntityID[];


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'selected-features');
    this._selectedIDs = [];

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._selectEntity = this._selectEntity.bind(this);
    this._deselectEntity = this._deselectEntity.bind(this);

    const editor = context.systems.editor!;
    editor.on('stablechange', this.renderInner);
  }


  /**
   * Gets or sets the selected entity IDs.
   * @param val - the new entity IDs, or omit to get the current value
   * @return the current entity IDs (getter) or `this` (setter)
   */
  public entityIDs(val?: EntityID[]): any {
    if (!arguments.length) return this._selectedIDs;
    this._selectedIDs = val as EntityID[];
    return this;
  }


  /**
   * Whether this section should display (more than one feature is selected).
   * @return `true` if multiple features are selected
   */
  public override shouldDisplay(): boolean {
    return this._selectedIDs.length > 1;
  }


  /**
   * The disclosure heading label — "Features (N)".
   * @return Localized heading text
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    const n = this._selectedIDs.length;
    const title = l10n.t('text.feature', { n });
    return l10n.t('inspector.title_count', { title: title, count: n });
  }


  /**
   * Selects a single feature from the list.
   * @param d3_event - the triggering click event
   * @param entity - the entity to select
   */
  protected _selectEntity(d3_event: Event, entity: OsmEntity): void {
    this.context.enter('select-osm', { selection: { osm: [entity.id] }} );
  }


  /**
   * Removes a feature from the current selection.
   * @param d3_event - the triggering click event
   * @param entity - the entity to deselect
   */
  protected _deselectEntity(d3_event: Event, entity: OsmEntity): void {
    const selectedIDs = this._selectedIDs.slice();
    const index = selectedIDs.indexOf(entity.id);
    if (index > -1) {
      selectedIDs.splice(index, 1);
      this.context.enter('select-osm', { selection: { osm: selectedIDs }} );
    }
  }


  /**
   * Renders the list of currently-selected features.
   * @param $selection - A d3-selection to the HTMLElement this content renders into
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const editor = context.systems.editor!;
    const l10n = context.systems.l10n!;
    const schema = context.systems.schema!;
    const graph = editor.staging.graph;

    let $list: D3Selection = $selection.selectAll('.feature-list')
      .data([0]);

    $list = $list.enter()
      .append('ul')
      .attr('class', 'feature-list')
      .merge($list);

    const entities = this._selectedIDs
      .map(d => graph.hasEntity(d))
      .filter(Boolean);

    let $items: D3Selection = $list.selectAll('.feature-list-item')
      .data(entities, (d: OsmEntity) => d.key);

    $items.exit()
      .remove();

    // Enter
    const $$items: D3EnterSelection = $items.enter()
      .append('li')
      .attr('class', 'feature-list-item')
      .each((d: OsmEntity, i, nodes) => {
        select(nodes[i])
          .on('mouseover', () => utilHighlightEntities(context, [d.id], true))
          .on('mouseout', () => utilHighlightEntities(context, [d.id], false));
      });

    const $$label: D3EnterSelection = $$items
      .append('button')
      .attr('class', 'label')
      .on('click', this._selectEntity);

    $$label
      .append('span')
      .attr('class', 'entity-geom-icon')
      .call(uiIcon('', 'pre-text'));

    $$label
      .append('span')
      .attr('class', 'entity-type');

    $$label
      .append('span')
      .attr('class', 'entity-name');

    $$items
      .append('button')
      .attr('class', 'close')
      .attr('title', l10n.t('icons.deselect'))
      .on('click', this._deselectEntity)
      .call(uiIcon('#rapid-icon-close'));

    // Update
    $items = $items.merge($$items);

    $items.selectAll('.entity-geom-icon use')
      .attr('href', (d, i, nodes) => {
        const el = select(nodes[i]) as any;
        const entity = el._groups[0][0].parentNode.parentNode.__data__;
        return '#rapid-icon-' + entity.geometry(graph);
      });

    $items.selectAll('.entity-type')
      .text((entity: OsmEntity) => schema.match(entity, graph)?.name);

    $items.selectAll('.entity-name')
      .text((entity: OsmEntity) => l10n.displayName(entity.tags));
  }
}
