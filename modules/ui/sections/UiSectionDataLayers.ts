import { select } from 'd3-selection';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { uiTooltip } from '../tooltip.ts';
import { uiIcon } from '../icon.ts';
import { UiSettingsCustomData } from '../settings/UiSettingsCustomData.ts';
import { utilCmd } from '../../util/cmd.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';
import type { AbstractPixiLayer } from '../../pixi/AbstractPixiLayer.ts';
import type { PixiLayerCustomData } from '../../pixi/PixiLayerCustomData.ts';


/** A base-layer item binding: id, optional layer reference, and keyboard-shortcut key path */
interface BaseLayerItem {
  id: LayerID;
  layer: AbstractPixiLayer | undefined;
  key: string;
}


/** UiSectionDataLayers
 *  This collapsable section displays various checkboxes for toggleable data layers.
 *  (and some other checkboxes below it)
 *  There was some attempt made at grouping them logically.
 *  It lives in the Map Data pane.
 *
 *  ⋁ Data Layers
 *    ◻ OpenStreetMap Data
 *    ◻ OpenStreetMap Notes
 *    ◻ Rapid Data
 *
 *    ◻ KeepRight Issues
 *    …
 *
 *    ◻ Custom Map Data      …
 *
 *    ◻ Show History Panel
 *    ◻ Show Measurement Panel
 */
export class UiSectionDataLayers extends AbstractUiSection {
  protected _previousLayerStates: Map<string, boolean>;
  protected _keys: string[] | null;
  protected _settingsCustomData: UiSettingsCustomData;


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'data-layers');

    const scene = context.systems.gfx!.scene!;
    const l10n = context.systems.l10n!;

    this._previousLayerStates = new Map();
    this._keys = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._drawBaseItems = this._drawBaseItems.bind(this);
    this._drawQAItems = this._drawQAItems.bind(this);
    this._drawCustomDataItems = this._drawCustomDataItems.bind(this);
    this._drawPanelItems = this._drawPanelItems.bind(this);
    this._setTooltips = this._setTooltips.bind(this);
    this._customChanged = this._customChanged.bind(this);
    this._mapRouletteIDsChanged = this._mapRouletteIDsChanged.bind(this);
    this._setupKeybinding = this._setupKeybinding.bind(this);

    this._settingsCustomData = new UiSettingsCustomData(context);
    this._settingsCustomData.on('change', this._customChanged);

    // Add or replace event handlers
    scene.off('layerchange', this.renderInner);
    scene.on('layerchange', this.renderInner);
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
    return l10n.t('map_data.data_layers');
  }


  /**
   * Render the data layer list and the checkboxes below it.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const $container: D3Selection = $selection.selectAll('.data-layer-container')
      .data([0]);

    $container.enter()
      .append('div')
      .attr('class', 'data-layer-container')
      .merge($container)
      .call(this._drawBaseItems)
      .call(this._drawQAItems)
      .call(this._drawCustomDataItems)
      .call(this._drawPanelItems);
  }


  /**
   * Toggles all data layers off (saving state), or restores the previous state.
   * @param e - triggering event (if any)
   */
  protected _toggleAllLayers(e?: Event): void {
    e?.preventDefault();

    const allLayerIDs = [
      'osm', 'notes', 'rapid', 'maproulette', 'keepright', 'osmose', 'geoscribble',
      'custom-data', 'mapillary', 'streetside', 'kartaview'
    ];

    const anyLayerEnabled = allLayerIDs.some(layerID => this._showsLayer(layerID));
    if (anyLayerEnabled) {
      // Save current state and disable all layers
      allLayerIDs.forEach(layerID => {
        this._previousLayerStates.set(layerID, this._showsLayer(layerID));
        this._setLayer(layerID, false);
      });
    } else {
      // Restore previous state
      this._previousLayerStates.forEach((enabled, layerID) => {
        this._setLayer(layerID, enabled);
      });
    }
  }


  /**
   * Just wraps calls to `toggleLayer`, cancelling the key event.
   * @param e       - triggering event (if any)
   * @param layerID - the layer to toggle
   */
  protected _toggleLayerKey(e: Event | undefined, layerID: string): void {
    e?.preventDefault();
    this._toggleLayer(layerID);
  }


  /**
   * Whether the given layer is currently shown.
   * @param layerID - the layer to test
   * @return `true` if the layer is enabled
   */
  protected _showsLayer(layerID: string): boolean {
    const scene = this.context.systems.gfx!.scene!;
    const layer = scene.layers.get(layerID);
    return !!layer?.enabled;
  }


  /**
   * Enables or disables the given layer.
   * @param layerID - the layer to change
   * @param val     - `true` to enable, `false` to disable
   */
  protected _setLayer(layerID: string, val: boolean): void {
    const context = this.context;
    const scene = context.systems.gfx!.scene!;

    // Don't allow layer changes while drawing - iD#6584
    const mode = context.mode;
    if (mode && /^draw/.test(mode.id)) return;

    if (val) {
      scene.enableLayers(layerID);
    } else {
      scene.disableLayers(layerID);
      if (layerID === 'osm' || layerID === 'notes') {
        context.enter('browse');
      }
    }
  }


  /**
   * Toggles the given layer's enabled state.
   * @param layerID - the layer to toggle
   */
  protected _toggleLayer(layerID: string): void {
    this._setLayer(layerID, !this._showsLayer(layerID));
  }


  /**
   * Applies tooltips to the layer list items.
   * @param $selection - d3-selection to the list `li` elements
   */
  protected _setTooltips($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;

    $selection.each((d: AbstractPixiLayer, i, nodes) => {
      const item = select(nodes[i]).select('label');
      const placement = (i < nodes.length / 2) ? 'bottom' : 'top';

      const tooltip = uiTooltip(context).placement(placement) as any;
      item.call(tooltip.destroyAny);

      let titleHtml = '';
      if (d.id) {
        titleHtml += d.id;
      };

      if (titleHtml) {
        tooltip.title(l10n.t(`map_data.layers.${d.id}.tooltip`));
        item.call(tooltip);
      }
    });
  }


  /**
   * Draws the base OSM/notes/rapid layer checkboxes.
   * @param $selection - d3-selection to render the list into
   */
  protected _drawBaseItems($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scene = context.systems.gfx!.scene!;

    const items = [
      { id: 'osm',   layer: scene.layers.get('osm'),   key: 'shortcuts.command.toggle_osm_data.key' },
      { id: 'notes', layer: scene.layers.get('notes'), key: 'shortcuts.command.toggle_osm_notes.key' },
      { id: 'rapid', layer: scene.layers.get('rapid'), key: 'shortcuts.command.toggle_rapid_data.key' }
    ];

    let $ul: D3Selection = $selection
      .selectAll('.layer-list-osm')
      .data([0]);

    $ul = $ul.enter()
      .append('ul')
      .attr('class', 'layer-list layer-list-osm')
      .merge($ul);

    const $li: D3Selection = $ul.selectAll('.list-item')
      .data(items);

    $li.exit()
      .remove();

    const $$li = $li.enter()
      .append('li')
      .attr('class', (d: BaseLayerItem) => `list-item list-item-${d.id}`);

    const $$label = $$li
      .append('label')
      .each((d: BaseLayerItem, i, nodes) => {
        select(nodes[i])
          .call(uiTooltip(context)
            .title(l10n.t(`map_data.layers.${d.id}.tooltip`))
            .shortcut(utilCmd('⇧' + l10n.t(d.key)))
            .placement('bottom')
          );
      });

    $$label
      .append('input')
      .attr('type', 'checkbox')
      .on('change', (e: Event, d: BaseLayerItem) => this._toggleLayer(d.id));

    $$label
      .append('span')
      .text((d: BaseLayerItem) => l10n.t(`map_data.layers.${d.id}.title`));

    // Update
    $li
      .merge($$li)
      .classed('active', (d: BaseLayerItem) => this._showsLayer(d.id))
      .selectAll('input')
      .property('checked', (d: BaseLayerItem) => this._showsLayer(d.id));
  }


  /**
   * Draws the QA (MapRoulette/KeepRight/Osmose/GeoScribble) layer checkboxes.
   * @param $selection - d3-selection to render the list into
   */
  protected _drawQAItems($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scene = context.systems.gfx!.scene!;

    const qaKeys = ['maproulette', 'keepright', 'osmose', 'geoscribble'];
    const qaLayers = qaKeys.map(layerID => scene.layers.get(layerID)).filter(Boolean) as AbstractPixiLayer[];
    const maproulette = context.services.maproulette;

    let $ul: D3Selection = $selection
      .selectAll('.layer-list-qa')
      .data([0]);

    $ul = $ul.enter()
      .append('ul')
      .attr('class', 'layer-list layer-list-qa')
      .merge($ul);

    let $li: D3Selection = $ul.selectAll('.list-item')
      .data(qaLayers);

    $li.exit()
      .remove();

    const $$li = $li.enter()
      .append('li')
      .attr('class', (d: AbstractPixiLayer) => `list-item list-item-${d.id}`);

    const $$label = $$li
      .append('label')
      .attr('class', 'content-label');

    $$label
      .append('input')
      .attr('type', 'checkbox')
      .on('change', (e: Event, d: AbstractPixiLayer) => this._toggleLayer(d.id));

    $$label
      .append('span')
      .text((d: AbstractPixiLayer) => l10n.t(`map_data.layers.${d.id}.title`, { n: 999 }));

    // Add input box for MapRoulette challenge IDs
    $$label.filter((d: AbstractPixiLayer) => d.id === 'maproulette')
      .append('input')
      .attr('type', 'text')
      .attr('placeholder', l10n.t('map_data.layers.maproulette.id_placeholder'))
      .attr('class', 'challenge-ids')
      .on('change', this._mapRouletteIDsChanged);


    // Update
    $li = $li.merge($$li);

    $li
      .classed('active', (d: AbstractPixiLayer) => d.enabled)
      .call(this._setTooltips)
      .selectAll('input[type="checkbox"]')
      .property('checked', (d: AbstractPixiLayer) => d.enabled);

    $li
      .selectAll('input.challenge-ids')
      .attr('value', maproulette?.challengeIDs ?? null);
  }


  /**
   * Draws the custom map data layer checkbox and its options buttons.
   * @param $selection - d3-selection to render the list into
   */
  protected _drawCustomDataItems($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scene = context.systems.gfx!.scene!;

    const customLayer = scene.layers.get('custom-data');
    const isRTL = l10n.isRTL;

    let $ul: D3Selection = $selection
      .selectAll('.layer-list-data')
      .data(customLayer ? [customLayer] : []);

    // Exit
    $ul.exit()
      .remove();

    // Enter
    const $$ul = $ul.enter()
      .append('ul')
      .attr('class', 'layer-list layer-list-data');

    const $$li = $$ul
      .append('li')
      .attr('class', 'list-item-data');

    const $$label = $$li
      .append('label')
      .call(uiTooltip(context)
        .title(l10n.t('map_data.layers.custom.tooltip'))
        .placement('top')
      );

    $$label
      .append('input')
      .attr('type', 'checkbox')
      .on('change', () => this._toggleLayer('custom-data'));

    $$label
      .append('span')
      .text(l10n.t('map_data.layers.custom.title'));

    $$li
      .append('button')
      .attr('class', 'open-data-options')
      .call(uiTooltip(context)
        .title(l10n.t('settings.custom_data.tooltip'))
        .placement(isRTL ? 'right' : 'left')
      )
      .on('click', (d3_event: Event) => {
        d3_event.preventDefault();
        this._editCustom();
      })
      .call(uiIcon('#rapid-icon-more'));

    $$li
      .append('button')
      .attr('class', 'zoom-to-data')
      .call(uiTooltip(context)
        .title(l10n.t('map_data.layers.custom.zoom'))
        .placement(isRTL ? 'right' : 'left')
      )
      .on('click', (d3_event: Event) => {
        const target = d3_event.currentTarget as HTMLElement;
        if (select(target).classed('disabled')) return;
        d3_event.preventDefault();
        d3_event.stopPropagation();
        const customLayer = scene.layers.get('custom-data') as PixiLayerCustomData;
        customLayer?.fitZoom();
      })
      .call(uiIcon('#rapid-icon-framed-dot', 'monochrome'));

    // Update
    $ul = $ul
      .merge($$ul);

    $ul.selectAll('.list-item-data')
      .classed('active', (d: PixiLayerCustomData) => d.enabled)
      .selectAll('label')
      .classed('deemphasize', (d: PixiLayerCustomData) => !d.hasData())
      .selectAll('input')
      .property('disabled', (d: PixiLayerCustomData) => !d.hasData())
      .property('checked', (d: PixiLayerCustomData) => d.enabled);

    $ul.selectAll('button.zoom-to-data')
      .classed('disabled', (d: PixiLayerCustomData) => !d.hasData());
  }


  /**
   * Opens the custom data settings dialog.
   */
  protected _editCustom(): void {
    const context = this.context;
    context.container()
      .call(this._settingsCustomData.render);
  }


  /**
   * Handles a change to the custom data settings.
   * @param d - object containing the custom data settings (url or fileList)
   */
  protected _customChanged(d: { url?: string | null; fileList?: FileList | null }): void {
    const scene = this.context.systems.gfx!.scene!;

    const customLayer = scene.layers.get('custom-data') as PixiLayerCustomData;
    if (!customLayer) return;

    if (d?.url) {
      customLayer.setUrl(d.url);
    } else if (d?.fileList) {
      customLayer.setFileList(d.fileList);
    }
  }


  /**
   * Handles a change to the MapRoulette challenge IDs input.
   * @param d3_event - change event, if called from a change handler
   */
  protected _mapRouletteIDsChanged(d3_event: Event): void {
    const maproulette = this.context.services.maproulette;
    maproulette!.challengeIDs = (d3_event.target as HTMLInputElement).value;
  }


  /**
   * Draws the History/Measurement panel toggle checkboxes.
   * @param $selection - d3-selection to render the list into
   */
  protected _drawPanelItems($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const ui = context.systems.ui as any;

    const HistoryCard = ui.InfoCards.HistoryCard;
    const MeasurementCard = ui.InfoCards.MeasurementCard;

    const $$panelsList = $selection.selectAll('.md-extras-list')
      .data([0])
      .enter()
      .append('ul')
      .attr('class', 'layer-list md-extras-list');

    const $$historyPanelLabel = $$panelsList
      .append('li')
      .attr('class', 'history-panel-toggle-item')
      .append('label')
      .call(uiTooltip(context)
        .title(l10n.t('map_data.history_panel.tooltip'))
        .shortcut(utilCmd('⌘⇧' + l10n.t('shortcuts.command.toggle_history_card.key')))
        .placement('top')
      );

    $$historyPanelLabel
      .append('input')
      .attr('type', 'checkbox')
      .on('change', HistoryCard.toggle);

    $$historyPanelLabel
      .append('span');

    const $$measurementPanelLabel = $$panelsList
      .append('li')
      .attr('class', 'measurement-panel-toggle-item')
      .append('label')
      .call(uiTooltip(context)
        .title(l10n.t('map_data.measurement_panel.tooltip'))
        .shortcut(utilCmd('⌘⇧' + l10n.t('shortcuts.command.toggle_measurement_card.key')))
        .placement('top')
      );

    $$measurementPanelLabel
      .append('input')
      .attr('type', 'checkbox')
      .on('change', MeasurementCard.toggle);

    $$measurementPanelLabel
      .append('span');


    // update
    // Set localized titles on the update selection so they re-localize on language change.
    $selection.selectAll('.history-panel-toggle-item span')
      .text(l10n.t('map_data.history_panel.title'));
    $selection.selectAll('.measurement-panel-toggle-item span')
      .text(l10n.t('map_data.measurement_panel.title'));

    $selection.selectAll('.history-panel-toggle-item')
      .classed('active', HistoryCard.visible)
      .selectAll('input')
      .property('checked', HistoryCard.visible);

    $selection.selectAll('.measurement-panel-toggle-item')
      .classed('active', MeasurementCard.visible)
      .selectAll('input')
      .property('checked', MeasurementCard.visible);
  }


  /**
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const keybinding = context.keybinding() as any;
    const l10n = context.systems.l10n!;

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    // setup key shortcuts
    const toggleAllKey = utilCmd('⇧' + l10n.t('shortcuts.command.toggle_all_layers.key'));
    const toggleOsmKey = utilCmd('⇧' + l10n.t('shortcuts.command.toggle_osm_data.key'));
    const toggleNotesKey = utilCmd('⇧' + l10n.t('shortcuts.command.toggle_osm_notes.key'));
    const toggleRapidKey = utilCmd('⇧' + l10n.t('shortcuts.command.toggle_rapid_data.key'));
    const toggleMapillaryKey = utilCmd('⇧' + l10n.t('shortcuts.command.toggle_mapillary.key'));
    const toggleStreetsideKey = utilCmd('⇧' + l10n.t('shortcuts.command.toggle_streetside.key'));
    const toggleKartaviewKey = utilCmd('⇧' + l10n.t('shortcuts.command.toggle_kartaview.key'));

    this._keys = [
      toggleAllKey, toggleOsmKey, toggleNotesKey, toggleRapidKey,
      toggleMapillaryKey, toggleStreetsideKey, toggleKartaviewKey
    ];

    keybinding
      .on(toggleAllKey, (e: Event) => this._toggleAllLayers(e))
      .on(toggleOsmKey, (e: Event) => this._toggleLayerKey(e, 'osm'))
      .on(toggleNotesKey, (e: Event) => this._toggleLayerKey(e, 'notes'))
      .on(toggleRapidKey, (e: Event) => this._toggleLayerKey(e, 'rapid'))
      .on(toggleMapillaryKey, (e: Event) => this._toggleLayerKey(e, 'mapillary'))
      .on(toggleStreetsideKey, (e: Event) => this._toggleLayerKey(e, 'streetside'))
      .on(toggleKartaviewKey, (e: Event) => this._toggleLayerKey(e, 'kartaview'));
  }
}
