import { descending as d3_descending, ascending as d3_ascending } from 'd3-array';
import { select as d3_select } from 'd3-selection';

import { AbstractUiSection } from '../AbstractUiSection.js';
import { uiTooltip } from '../tooltip.js';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/** UiSectionOverlayList
 *  This collapsable section displays a checkbox list of background overlays
 *  It lives in the Background Settings pane.
 *
 *  ⋁ Overlays
 *    ◻ Locator Overlay
 *    ◻ OpenRailwayMap Maxspeeds
 *    ◻ TIGER Roads 2022
 *    …
 */
export class UiSectionOverlayList extends AbstractUiSection {
  protected _overlayList: D3Selection;

  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'overlay-list');

    const imagery = context.systems.imagery!;
    const map = context.systems.map!;

    this._overlayList = d3_select(null);

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._drawListItems = this._drawListItems.bind(this);
    this._setTooltips = this._setTooltips.bind(this);
    this._updateLayerSelections = this._updateLayerSelections.bind(this);
    this._chooseOverlay = this._chooseOverlay.bind(this);
    this._renderIfVisible = this._renderIfVisible.bind(this);
    this._onMapDraw = this._onMapDraw.bind(this);
    this._deferredOnMapDraw = this._deferredOnMapDraw.bind(this);

    imagery.on('imagerychange', this._renderIfVisible);
    map.on('draw', this._deferredOnMapDraw);
  }


  /**
   * The section's heading label.
   * @return Localized section title
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('background.overlays');
  }


  /**
   * Filter predicate: whether an imagery source is an overlay.
   * @param d - the imagery source to test
   * @return `true` if the source is an overlay
   */
  protected _isOverlay(d: any): boolean {
    return !!d.props.overlay;
  }

  /**
   * Re-renders the disclosure content (skips rendering if the disclosure is closed).
   */
  protected _renderIfVisible(): void {
    this.reRender();
  }


  /**
   * Render the overlay list.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const $container: D3Selection = $selection.selectAll('.layer-overlay-list')
      .data([0]);

    this._overlayList = $container.enter()
      .append('ul')
      .attr('class', 'layer-list layer-overlay-list')
      .merge($container);

    this._overlayList
      .call(this._drawListItems);
  }


  /**
   * Applies tooltips to the overlay list items.
   * @param $selection - d3-selection to the list `li` elements
   */
  protected _setTooltips($selection: D3Selection): void {
    const context = this.context;

    $selection.each((d: any, i: number, nodes: any) => {
      const item = d3_select(nodes[i]).select('label');
      const span = item.select('span');
      const placement = (i < nodes.length / 2) ? 'bottom' : 'top';
      const isOverflowing = (span.property('clientWidth') !== span.property('scrollWidth'));

      item.call(uiTooltip(context).destroyAny);

      if (d.description || isOverflowing) {
        item.call((uiTooltip(context) as any)
          .placement(placement)
          .title(d.description || d.name)
        );
      }
    });
  }


  /**
   * Updates the active state / checkboxes for the overlay list items.
   * @param $selection - d3-selection to the overlay list `ul`
   */
  protected _updateLayerSelections($selection: D3Selection): void {
    const imagery = this.context.systems.imagery!;

    const isActive = (d: any): boolean => imagery.showsLayer(d);

    $selection.selectAll('li')
      .classed('active', isActive)
      .call(this._setTooltips)
      .selectAll('input')
      .property('checked', isActive);
  }


  /**
   * Draws the checkbox list of overlay imagery sources.
   * @param $selection - d3-selection to the overlay list `ul`
   */
  protected _drawListItems($selection: D3Selection): void {
    const imagery = this.context.systems.imagery!;

    const sources = imagery
      .visibleSources()
      .filter((d: any) => this._isOverlay(d));

    const sortSources = (a: any, b: any): number => {
      return d3_descending(a.area, b.area) || d3_ascending(a.name, b.name) || 0;
    };

    const $layerLinks: D3Selection = $selection.selectAll('li')
      .data(sources, (d: any) => d.name);

    $layerLinks.exit()
      .remove();

    const $$enter = $layerLinks.enter()
      .append('li');

    const $$label = $$enter
      .append('label');

    $$label
      .append('input')
      .attr('type', 'checkbox')
      .attr('name', 'layers')
      .on('change', this._chooseOverlay);

    $$label
      .append('span')
      .text((d: any) => d.name);


    $selection.selectAll('li')
      .sort(sortSources);

    $selection
      .call(this._updateLayerSelections);
  }


  /**
   * Toggles an overlay layer on or off.
   * @param d3_event - the change event
   * @param d        - ImagerySource being toggled
   */
  protected _chooseOverlay(d3_event: Event, d: any): void {
    const imagery = this.context.systems.imagery!;

    d3_event.preventDefault();
    imagery.toggleOverlayLayer(d);
    this._overlayList.call(this._updateLayerSelections);
  }


  /**
   * Redraw the list sometimes if the map has moved.
   */
  protected _onMapDraw(): void {
    const scheduler = this.context.systems.scheduler;

    if (scheduler) {
      scheduler.scheduleIdleTask(() => this._renderIfVisible())
        .catch((err: any) => {
          if (err?.name === 'AbortError') return;   // expected cancellation
          console.error(err);  // eslint-disable-line no-console
        });
    } else {
      this._renderIfVisible();
    }
  }


  /**
   * Redraw the list sometimes after the map has moved (throttled).
   */
  protected _deferredOnMapDraw(): void {
    const scheduler = this.context.systems.scheduler;
    scheduler?.throttle('OverlayList-mapDraw', this._onMapDraw, { ms: 1000 });
  }
}
