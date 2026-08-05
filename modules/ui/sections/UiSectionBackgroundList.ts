import { select } from 'd3-selection';
import { easeCubicInOut } from 'd3-ease';
import { geoSphericalDistance, numWrap } from '@rapid-sdk/math';

import { AbstractUiSection } from '../AbstractUiSection.js';
import { ImagerySource } from '../../lib/ImagerySource.ts';
import { uiIcon } from '../icon.js';
import { UiSettingsCustomBackground } from '../settings/UiSettingsCustomBackground.js';
import { uiTooltip } from '../tooltip.js';
import { utilCmd } from '../../util/cmd.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { ImagerySourceCustom } from '../../lib/ImagerySource.ts';
import type { UiSettingsCustomBackground } from '../settings/UiSettingsCustomBackground.ts';
import type { Vec2 } from '@rapid-sdk/math';


/** UiSectionBackgroundList
 *  This collapsable section displays a radio button list of background imagery.
 *  (and some other checkboxes below it)
 *  Each list item also adds star buttons so users can select their favorite items.
 *  It lives in the Background Settings pane.
 *
 *  ⋁ Backgrounds
 *    ○ Bing Maps Aerial    ☆
 *    ○ Esri Wayback        ☆
 *    ○ Esri World Imagery  ☆
 *    …
 *    ○ None                ☆
 *    ○ Custom              …
 *
 *    ◻ Show Minimap
 *    ◻ Show 3d Map
 *    …
 */
export class UiSectionBackgroundList extends AbstractUiSection {
  protected _backgroundList: D3Selection;
  protected _keys: string[] | null;
  protected _waybackPromise: Promise<void> | null;  // only allow one at a time
  protected _waybackDates: string[];
  protected _waybackLoc: Vec2 | null;
  protected _favoriteIDs: Set<string>;
  protected _settingsCustomBackground: UiSettingsCustomBackground;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'background-list');

    const imagery = context.systems.imagery!;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const settings = context.systems.settings;

    this._backgroundList = select(null);
    this._keys = null;
    this._waybackPromise = null;
    this._waybackDates = [];
    this._waybackLoc = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this._isNotOverlay = this._isNotOverlay.bind(this);
    this._renderIfVisible = this._renderIfVisible.bind(this);
    this._setTooltips = this._setTooltips.bind(this);
    this._sortSources = this._sortSources.bind(this);
    this._drawListItems = this._drawListItems.bind(this);
    this._chooseBackground = this._chooseBackground.bind(this);
    this._customChanged = this._customChanged.bind(this);
    this._clickCustom = this._clickCustom.bind(this);
    this._waybackDateChange = this._waybackDateChange.bind(this);
    this._toggleFavorite = this._toggleFavorite.bind(this);
    this._stepBackground = this._stepBackground.bind(this);
    this._swapBackground = this._swapBackground.bind(this);
    this._nextBackground = this._nextBackground.bind(this);
    this._prevBackground = this._prevBackground.bind(this);
    this._refreshWaybackDates = this._refreshWaybackDates.bind(this);
    this._onMapDraw = this._onMapDraw.bind(this);
    this._deferredOnMapDraw = this._deferredOnMapDraw.bind(this);
    this._setupKeybinding = this._setupKeybinding.bind(this);

    this._settingsCustomBackground = new UiSettingsCustomBackground(context);
    this._settingsCustomBackground.on('change', this._customChanged);

    const stored: unknown = settings?.get('imagery.favorites') ?? [];
    // note: older versions stored favorites as an object, but we only need the keys of this object
    const vals = Array.isArray(stored) ? stored as string[] : Object.keys(stored as object);
    this._favoriteIDs = new Set<string>(vals);

    // Event listeners
    imagery.off('imagerychange', this._renderIfVisible);
    imagery.on('imagerychange', this._renderIfVisible);
    map.off('draw', this._deferredOnMapDraw);
    map.on('draw', this._deferredOnMapDraw);
    l10n.off('localechange', this._setupKeybinding);
    l10n.on('localechange', this._setupKeybinding);

    this._setupKeybinding();
  }


  /**
   * The section's heading label.
   * @return Localized section title
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('background.backgrounds');
  }


  /**
   * Returns the ID of the previously-used background (for the swap shortcut).
   * @return The stored last-used background ID, if any
   */
  protected _previousBackgroundID(): string | undefined {
    const settings = this.context.systems.settings;
    return settings?.get('imagery.lastUsedToggle') as string | undefined;
  }


  /**
   * Filter predicate: whether an imagery source is not an overlay.
   * @param d - the imagery source to test
   * @return `true` if the source is a base layer (not an overlay)
   */
  protected _isNotOverlay(d: ImagerySource): boolean {
    return !d.props.overlay;
  }


  /**
   * Re-renders the disclosure content, but only if the section is currently visible.
   * It skips actual rendering if the disclosure is closed.
   */
  protected _renderIfVisible(): void {
    if (this._isVisible()) {
      this.reRender();
    }
  }


  /**
   * Checks if the pane and disclosure section are both visible.
   * @return `true` if both the background pane and this disclosure are open
   */
  protected _isVisible(): boolean {
    const context = this.context;

    const $container = context.container();
    if ($container.selectAll('.map-pane.background-pane.hide').size()) return false;
    if (this.$container.selectAll('.disclosure-wrap.hide').size()) return false;
    return true;
  }


  /**
   * Render the background list and the checkboxes below it.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const map3d = context.systems.map3d;
    const ui = context.systems.ui;

    const BackgroundCard = ui.InfoCards.BackgroundCard;
    const LocationCard = ui.InfoCards.LocationCard;

    // the main background list
    const $container: D3Selection = $selection.selectAll('.layer-background-list')
      .data([0]);

    this._backgroundList = $container.enter()
      .append('ul')
      .attr('class', 'layer-list layer-background-list')
      .merge($container) as D3Selection;

    // extra checkboxes below the list
    const $$extrasList = $selection.selectAll('.bg-extras-list')
      .data([0])
      .enter()
      .append('ul')
      .attr('class', 'layer-list bg-extras-list');

    const $$minimapLabel = $$extrasList
      .append('li')
      .attr('class', 'minimap-toggle-item')
      .append('label')
      .call(uiTooltip(context)
        .title(l10n.t('background.minimap.tooltip'))
        .shortcut(l10n.t('shortcuts.command.toggle_minimap.key'))
        .placement('top')
      );

    $$minimapLabel
      .append('input')
      .attr('type', 'checkbox')
      .on('change', (d3_event: Event) => {
        d3_event.preventDefault();
        ui.Minimap.toggle();
      });

    $$minimapLabel
      .append('span');


    const $$map3dLabel = $$extrasList
      .append('li')
      .attr('class', 'map3d-toggle-item')
      .append('label')
      .call(uiTooltip(context)
        .title(l10n.t('background.3dmap.tooltip'))
        .shortcut(utilCmd('⌘' + l10n.t('shortcuts.command.toggle_3dmap.key')))
        .placement('top')
      );

    $$map3dLabel
      .append('input')
      .attr('type', 'checkbox')
      .attr('class', 'map3d-toggle-checkbox')
      .on('change', (d3_event: Event) => {
        d3_event.preventDefault();
        const input = d3_event.currentTarget as HTMLInputElement;
        map3d.visible = input.checked;
      });

    $$map3dLabel
      .append('span');


    const $$panelLabel = $$extrasList
      .append('li')
      .attr('class', 'background-panel-toggle-item')
      .append('label')
      .call(uiTooltip(context)
        .title(l10n.t('background.panel.tooltip'))
        .shortcut(utilCmd('⌘⇧' + l10n.t('shortcuts.command.toggle_background_card.key')))
        .placement('top')
      );

    $$panelLabel
      .append('input')
      .attr('type', 'checkbox')
      .on('change', BackgroundCard.toggle);

    $$panelLabel
      .append('span');

    const $$locPanelLabel = $$extrasList
      .append('li')
      .attr('class', 'location-panel-toggle-item')
      .append('label')
      .call(uiTooltip(context)
        .title(l10n.t('background.location_panel.tooltip'))
        .shortcut(utilCmd('⌘⇧' + l10n.t('shortcuts.command.toggle_location_card.key')))
        .placement('top')
      );

    $$locPanelLabel
      .append('input')
      .attr('type', 'checkbox')
      .on('change', LocationCard.toggle);

    $$locPanelLabel
      .append('span');


    // "Info / Report a Problem" link
    $selection.selectAll('.imagery-faq')
      .data([0])
      .enter()
      .append('div')
      .attr('class', 'imagery-faq')
      .append('a')
      .attr('target', '_blank')
      .call(uiIcon('#rapid-icon-out-link', 'inline'))
      .attr('href', 'https://github.com/openstreetmap/iD/blob/develop/FAQ.md#how-can-i-report-an-issue-with-background-imagery')
      .append('span');

    this._backgroundList
      .call(this._drawListItems);


    // update
    const $extrasList = $selection.selectAll('.bg-extras-list');

    // Set localized descriptions on the update selection so they re-localize on language change.
    $extrasList.selectAll('.minimap-toggle-item span')
      .text(l10n.t('background.minimap.description'));
    $extrasList.selectAll('.map3d-toggle-item span')
      .text(l10n.t('background.3dmap.description'));
    $extrasList.selectAll('.background-panel-toggle-item span')
      .text(l10n.t('background.panel.description'));
    $extrasList.selectAll('.location-panel-toggle-item span')
      .text(l10n.t('background.location_panel.description'));
    $selection.selectAll('.imagery-faq span')
      .text(l10n.t('background.imagery_problem_faq'));

    $extrasList.selectAll('.map3d-toggle-item')
      .classed('active', map3d.visible)
      .selectAll('input')
      .property('checked', map3d.visible);

    $extrasList.selectAll('.background-panel-toggle-item')
      .classed('active', BackgroundCard.visible)
      .selectAll('input')
      .property('checked', BackgroundCard.visible);

    $extrasList.selectAll('.location-panel-toggle-item')
      .classed('active', LocationCard.visible)
      .selectAll('input')
      .property('checked', LocationCard.visible);
  }


  /**
   * Applies tooltips to the background list items.
   * @param $selection - d3-selection to the list `li` elements
   */
  protected _setTooltips($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    $selection.each((d: ImagerySource, i, nodes) => {
      const $item = select(nodes[i]).select('label');
      const placement = (i < nodes.length / 2) ? 'bottom' : 'top';

      const tooltip: any = uiTooltip(context).placement(placement);
      $item.call(tooltip.destroyAny);

      let titleHtml = '';
      if (d.description) {
        titleHtml += d.description;
      };
      if (d.id === this._previousBackgroundID()) {
        titleHtml += '<br/><br/>' + l10n.t('background.switch');
        tooltip.shortcut(utilCmd('⌘' + l10n.t('shortcuts.command.background_switch.key')));
      }

      if (titleHtml) {
        tooltip.title(titleHtml);
        $item.call(tooltip);
      }
    });
  }


  /**
   * Comparator that sorts imagery sources (favorites, then best, then area, then name).
   * @param a - first imagery source
   * @param b - second imagery source
   * @return Negative, zero, or positive sort order
   */
  protected _sortSources(a: ImagerySource, b: ImagerySource): number {
    const _favoriteIDs = this._favoriteIDs;

    return _favoriteIDs.has(a.id) && !_favoriteIDs.has(b.id) ? -1
      : _favoriteIDs.has(b.id) && !_favoriteIDs.has(a.id) ? 1
      : a.props.best && !b.props.best ? -1
      : b.props.best && !a.props.best ? 1
      : (b.area !== a.area) ? b.area - a.area   // descending
      : a.name.localeCompare(b.name);
  }


  /**
   * Draws the radio-button list of background imagery sources.
   * @param $selection - d3-selection to the background list `ul`
   */
  protected _drawListItems($selection: D3Selection): void {
    const context = this.context;
    const imagery = context.systems.imagery!;
    const l10n = context.systems.l10n!;
    const wayback = context.services.wayback;

    const sources = imagery
      .visibleSources()
      .filter(this._isNotOverlay);

    let $listItems: D3Selection = $selection.selectAll('li')
      .data(sources, (d: ImagerySource) => d.id);

    // exit
    $listItems.exit()
      .remove();

    // enter
    const $$listItems = $listItems.enter()
      .append('li')
      .classed('layer-custom', (d: ImagerySource) => d.id === 'custom')
      .classed('best', (d: ImagerySource) => d.props.best);

    const $$label = $$listItems
      .append('label');

    $$label
      .append('input')
      .attr('type', 'radio')
      .attr('name', 'layers')
      .on('change', this._chooseBackground);

    $$label
      .append('span')
      .attr('class', 'background-name')
      .text((d: ImagerySource) => d.name);

    $$listItems
      .each((d: ImagerySource, i, nodes) => {
        const $li = select(nodes[i]);

        // Wayback gets an extra dropdown for picking the date
        if (d.id === 'EsriWayback') {
          $li
            .selectAll('label')
            .append('select')
            .attr('class', 'wayback-date')
            .on('change', this._waybackDateChange);
        }

        // Add favorite button
        if (d.id !== 'custom') {
          $li
            .append('button')
            .attr('class', 'favorite-background')
            .attr('tabindex', -1)
            .call(uiIcon('', undefined, l10n.t('icons.favorite')))
            .on('click', this._toggleFavorite);
        }

        // Custom gets a different button: '...'
        if (d.id === 'custom') {
          $li
            .append('button')
            .attr('class', 'layer-browse')
            .call(uiTooltip(context)
              .title(l10n.t('settings.custom_background.tooltip'))
              .placement(l10n.isRTL ? 'right' : 'left')
            )
            .on('click', this._clickCustom)
            .call(uiIcon('#rapid-icon-more'));
        }

        // "Best" backgrounds get a badge
        if (d.props.best) {
          $li
            .selectAll('label')
            .append('span')
            .attr('class', 'best')
            .call(uiIcon('#rapid-icon-best-background', undefined, l10n.t('background.best_imagery')));
        }
      });


    // update
    $listItems = $listItems
      .merge($$listItems)
      .sort(this._sortSources) as D3Selection;

    $listItems
      .each((d: ImagerySource, i, nodes) => {
        const $li = select(nodes[i]);

        $li
          .classed('active', (d: ImagerySource) => imagery.showsLayer(d))
          .call(this._setTooltips)
          .selectAll('input')
          .property('checked', (d: ImagerySource) => imagery.showsLayer(d));

        // Update the Wayback release date options
        if (d.id === 'EsriWayback') {
          const currDate = d.date;

          // If we don't know the locally changed dates yet, just show all dates in the dropdown
          if (wayback && !this._waybackDates.length) {
            this._waybackDates = wayback.allDates.slice().reverse();  // copy and sort descending
            this._refreshWaybackDates();
          }

          const $dropdown = $li.selectAll('.wayback-date');
          const $options: D3Selection = $dropdown.selectAll('option')
            .data(this._waybackDates, (d: string) => d);

          $options.exit()
            .remove();

          const $$options: D3Selection = $options.enter()
            .append('option')
            .attr('value', (d: string) => d)
            .text((d: string) => d);

          $options.merge($$options)
            .attr('selected', (d: string) => (d === currDate ? '' : null))
            .order();
        }

        // Update the favorite button
        const isFavorite = this._favoriteIDs.has(d.id);
        $li.selectAll('button.favorite-background svg.icon')
          .classed('favorite', isFavorite)
          .selectAll('use')
          .attr('href', isFavorite ? '#fas-star' : '#far-star');
      });
  }


  /**
   * Chooses a background imagery source.
   * @param d3_event         - change event, if called from a change handler (unused)
   * @param sourceOrSourceID - `string` or `ImagerySource` being chosen
   */
  protected _chooseBackground(d3_event: Event | undefined, sourceOrSourceID: ImagerySource | string): void {
    const context = this.context;
    const imagery = context.systems.imagery!;
    const settings = context.systems.settings;

    let source: ImagerySource | undefined;
    let sourceID: string;
    if (sourceOrSourceID instanceof ImagerySource) {
      source = sourceOrSourceID;
      sourceID = sourceOrSourceID.id;
    } else {
      sourceID = sourceOrSourceID;
    }

    // If no custom template, open the custom settings dialog..
    if (sourceID === 'custom' && !source?.template) {
      return this._clickCustom();
    }

    const previousBackground = imagery.baseLayerSource();
    if (previousBackground instanceof ImagerySource) {
      settings?.set('imagery.lastUsedToggle', previousBackground.id);
    }
    settings?.set('imagery.lastUsed', sourceID);
    imagery.setSourceByID(sourceID);
  }


  /**
   * Handles a change to the custom imagery settings.
   * @param d - object containing settings for the custom imagery
   */
  protected _customChanged(d: { template?: string }): void {
    const imagery = this.context.systems.imagery!;

    const customSource = imagery.getSourceByID('custom') as ImagerySourceCustom;
    if (d?.template) {
      customSource.template = d.template;
      this._chooseBackground(undefined, customSource);
    } else {
      customSource.template = '';
      this._chooseBackground(undefined, 'none');
    }
  }


  /**
   * Opens the custom background settings dialog.
   * @param d3_event - click event, if called by a click handler
   */
  protected _clickCustom(d3_event?: Event): void {
    const context = this.context;

    if (d3_event) d3_event.preventDefault();
    context.container().call(this._settingsCustomBackground.render);
  }


  /**
   * Handles a change to the selected Wayback release date.
   * @param d3_event - change event, if called from a change handler
   */
  protected _waybackDateChange(d3_event: Event): void {
    let sourceID = 'EsriWayback';
    const selectedDate = (d3_event.target as HTMLSelectElement).value;
    if (selectedDate) {
      sourceID += '_' + selectedDate;
    }

    this._chooseBackground(undefined, sourceID);
  }


  /**
   * Toggles whether an imagery source is a favorite.
   * @param d3_event - click event, if called from a click handler
   * @param d        - ImagerySource being toggled
   */
  protected _toggleFavorite(d3_event: Event, d: ImagerySource): void {
    const context = this.context;
    const settings = context.systems.settings;

    d3_event.preventDefault();

    const target = d3_event.currentTarget as HTMLElement;
    const $selection = select(target);
    ($selection.node() as HTMLElement).blur();  // remove focus after click

    if (this._favoriteIDs.has(d.id)) {
      $selection.classed('favorite', false);
      this._favoriteIDs.delete(d.id);
    } else {
      $selection.classed('favorite', true);
      this._favoriteIDs.add(d.id);
    }

    const vals = [...this._favoriteIDs];
    settings?.set('imagery.favorites', vals);

    select(target.parentElement)
      .transition()
      .duration(300)
      .ease(easeCubicInOut)
      .style('background-color', 'orange')
        .transition()
        .duration(300)
        .ease(easeCubicInOut)
        .style('background-color', null);

    this._renderIfVisible();
  }


  /**
   * This is used to cycle through imagery sources in the list.
   * @param step - item to step to '1' or '-1'
   */
  protected _stepBackground(step: number): void {
    const imagery = this.context.systems.imagery!;

    const backgrounds = imagery
      .visibleSources()
      .filter(this._isNotOverlay);

    backgrounds.sort(this._sortSources);
    const currentBackground = imagery.baseLayerSource() as ImagerySource;
    const currIndex = backgrounds.indexOf(currentBackground);

    // Can't find the current background, bail out (shouldn't happen)
    if (currIndex === -1) return;

    let index = numWrap(currIndex + step, 0, backgrounds.length);
    let choice = backgrounds[index];
    if (choice.id === 'custom' && !choice.template) {   // step past empty custom imagery
      index = numWrap(index + step, 0, backgrounds.length);
      choice = backgrounds[index];
    }

    this._chooseBackground(undefined, choice);
  }


  /**
   * Swap to last used background.
   */
  protected _swapBackground(): void {
    const sourceID = this._previousBackgroundID();
    if (sourceID) this._chooseBackground(undefined, sourceID);
  }


  /**
   * Step to the next background in the list.
   */
  protected _nextBackground(): void {
    this._stepBackground(1);
  }

  /**
   * Step to the previous background in the list.
   */
  protected _prevBackground(): void {
    this._stepBackground(-1);
  }


  /**
   * Refresh the list locally-changed Wayback dates.
   * This is used as the source data for the dropdown.
   */
  protected _refreshWaybackDates(): void {
    const context = this.context;
    const imagery = context.systems.imagery!;
    const wayback = context.services.wayback as any;

    const source = imagery.getSourceByID('EsriWayback') as any;
    if (!wayback || !source) return;

    const lastLoc: Vec2 = this._waybackLoc || [Infinity, Infinity];
    const currLoc = context.viewport.centerLoc();
    const needsRefresh = (geoSphericalDistance(currLoc, lastLoc) > 5000);  // map moved > 5000 meters

    if (needsRefresh && !this._waybackPromise) {
      this._waybackPromise = wayback.getLocalDatesAsync()
        .then((result: Record<string, unknown>) => {
          if (!Array.isArray(result)) return;

          const allDates = wayback.allDates;
          const currDate = source.date;
          const keepDates = new Set(result);

          // Make sure to always include oldest, newest, and currently selected date.
          keepDates.add(allDates.at(0));
          keepDates.add(allDates.at(-1));
          if (currDate) keepDates.add(currDate);

          this._waybackDates = [...keepDates].sort().reverse();   // sort as strings decending
          this._waybackLoc = currLoc;
          this._renderIfVisible();
        })
        .finally(() => {
          this._waybackPromise = null;  // can try again
        });
    }
  }


  /**
   * Redraw the content sometimes after the map has moved.
   */
  protected _onMapDraw(): void {
    const scheduler = this.context.systems.scheduler;

    const fn = () => {
      if (this._isVisible()) {
        this._refreshWaybackDates();
        this._renderIfVisible();
      }
    };
    if (scheduler) {
      scheduler.scheduleIdleTask(fn)
        .catch((err: unknown) => {
          if (err?.name === 'AbortError') return;   // expected cancellation
          console.error(err);  // eslint-disable-line no-console
        });
    } else {
      fn();
    }
  }


  /**
   * Redraw the content sometimes after the map has moved (throttled).
   */
  protected _deferredOnMapDraw(): void {
    const scheduler = this.context.systems.scheduler;
    scheduler?.throttle('BackgroundList-mapDraw', this._onMapDraw, { ms: 1000 });
  }


  /**
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const keybinding = context.keybinding();

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    const swapBackgroundKey = utilCmd('⌘' + l10n.t('shortcuts.command.background_switch.key'));
    const nextBackgroundKey = l10n.t('shortcuts.command.background_next.key');
    const prevBackgroundKey = l10n.t('shortcuts.command.background_previous.key');

    this._keys = [swapBackgroundKey, nextBackgroundKey, prevBackgroundKey];

    keybinding
      .on(swapBackgroundKey, this._swapBackground)
      .on(nextBackgroundKey, this._nextBackground)
      .on(prevBackgroundKey, this._prevBackground);
  }
}
