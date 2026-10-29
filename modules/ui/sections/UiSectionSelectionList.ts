import { select } from 'd3-selection';
import { uiIcon } from '../icon.ts';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { osmEntityID, splitDataID } from '../../data/dataID.ts';
import { OsmEntity } from '../../data/index.ts';
import { utilHighlightEntities } from '../../util/util.ts';

import type { AbstractData } from '../../data/AbstractData.ts';
import type { Context } from '../../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';

/** Icon names for the geometry types of data that isn't in the OSM graph */
const GEOMETRY_ICONS: Record<string, string> = {
  Point: 'point',
  LineString: 'line',
  Polygon: 'area'
};


/**
 * `UiSectionSelectionList` appears when the user has multiple
 * features selected.  It lives in the `UiEntityEditor` and the `UiSelectionInspector`.
 * Features are identified by their data IDs, so the list can show data from any source.
 */
export class UiSectionSelectionList extends AbstractUiSection {
  protected _selectedIDs: DataID[];
  public rerender: () => void;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'selected-features');
    this._selectedIDs = [];

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._selectDatum = this._selectDatum.bind(this);
    this._deselectDatum = this._deselectDatum.bind(this);
    this.rerender = () => this.renderInner();

    const editor = context.systems.editor!;
    editor.on('stablechange', this.rerender);
  }


  /**
   * Gets or sets the data IDs of the selected features.
   * @param val - the new data IDs, or omit to get the current value
   * @return the current data IDs (getter) or `this` (setter)
   */
  public dataIDs(val?: DataID[]): any {
    if (!arguments.length) return this._selectedIDs;
    this._selectedIDs = val as DataID[];
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
   * @param e - the triggering click event
   * @param d - the feature to select
   */
  protected _selectDatum(e: PointerEvent, d: AbstractData): void {
    this.context.enter('select', { selection: [d.dataID] });
  }


  /**
   * Removes a feature from the current selection.
   * @param e - the triggering click event
   * @param d - the feature to deselect
   */
  protected _deselectDatum(e: PointerEvent, d: AbstractData): void {
    const selectedIDs = this._selectedIDs.filter(dataID => dataID !== d.dataID);
    utilHighlightEntities(this.context, [d.dataID], false);
    if (selectedIDs.length < this._selectedIDs.length) {
      this.context.enter('select', { selection: selectedIDs });
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
    const rapid = context.systems.rapid;
    const schema = context.systems.schema!;
    const spatial = context.systems.spatial!;
    const graph = editor.staging.graph;

    // OSM entities are described by their preset; other data by its dataset, or its namespace.
    const isOsm = (d: AbstractData): boolean => (d instanceof OsmEntity && !!osmEntityID(d.dataID));

    const geometryOf = (d: AbstractData): string => {
      if (isOsm(d)) return (d as OsmEntity).geometry(graph);
      return GEOMETRY_ICONS[d.geoms.parts[0]?.type ?? ''] ?? 'point';
    };

    const typeOf = (d: AbstractData): string => {
      if (isOsm(d)) return schema.match(d as OsmEntity, graph)?.name ?? '';
      const datasetID = d.props.datasetID as DatasetID | undefined;
      const dataset = datasetID ? rapid?.catalog.get(datasetID) : undefined;
      return dataset?.getLabel() ?? splitDataID(d.dataID)[0];
    };

    const nameOf = (d: AbstractData): string => {
      const tags = (d as any).tags ?? (d as any).properties ?? {};
      return l10n.displayName(tags);
    };

    let $list: D3Selection = $selection.selectAll('.feature-list')
      .data([0]);

    $list = $list.enter()
      .append('ul')
      .attr('class', 'feature-list')
      .merge($list);

    const data = this._selectedIDs
      .map(dataID => spatial.getData(dataID))
      .filter(d => d !== undefined);

    let $items: D3Selection = $list.selectAll('.feature-list-item')
      .data(data, (d: AbstractData) => `${d.dataID}v${d.v}`);

    $items.exit()
      .remove();

    // Enter
    const $$items: D3EnterSelection = $items.enter()
      .append('li')
      .attr('class', 'feature-list-item')
      .each((d: AbstractData, i, nodes) => {
        select(nodes[i])
          .on('mouseover', () => utilHighlightEntities(context, [d.dataID], true))
          .on('mouseout', () => utilHighlightEntities(context, [d.dataID], false));
      });

    const $$label: D3EnterSelection = $$items
      .append('button')
      .attr('class', 'label')
      .on('click', this._selectDatum);

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
      .on('click', this._deselectDatum)
      .call(uiIcon('#rapid-icon-close'));

    // Update
    $items = $items.merge($$items);

    $items.selectAll('.entity-geom-icon use')
      .attr('href', (d, i, nodes) => {
        const el = select(nodes[i]) as any;
        const datum = el._groups[0][0].parentNode.parentNode.__data__;
        return '#rapid-icon-' + geometryOf(datum);
      });

    $items.selectAll('.entity-type')
      .text((d: AbstractData) => typeOf(d));

    $items.selectAll('.entity-name')
      .text((d: AbstractData) => nameOf(d));

    $items.selectAll('.close')
      .attr('title', l10n.t('icons.deselect'));
  }
}
