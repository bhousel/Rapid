import { selection } from 'd3-selection';
import { Extent } from '@rapid-sdk/math';

import { AbstractUiCard } from './AbstractUiCard.ts';
import { uiIcon } from '../icon.ts';
import { utilCmd } from '../../util/cmd.ts';

import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';

const METADATA_KEYS = ['zoom', 'vintage', 'source', 'description', 'resolution', 'accuracy'];


/**
 * The `UiBackgroundCard` shows information about the current background imagery source.
 */
export class UiBackgroundCard extends AbstractUiCard {
  public id: string;
  public deferredRender: () => void;
  public deferredUpdateMetadata: () => void;

  protected _currSourceID: string | null;
  protected _metadata: Record<string, any>;
  protected _keys: string[] | null;


  /**
   * @constructor
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super(context);
    this.id = 'background';

    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const scheduler = context.systems.scheduler;  // optional

    this._currSourceID = null;
    this._metadata = {};
    this._keys = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this.updateMetadata = this.updateMetadata.bind(this);
    this.deferredRender = () => {
      // scheduler debounces the redraw; without it, just redraw immediately
      if (scheduler) {
        scheduler.debounce('UiBackgroundCard-render', () => this.render(), { ms: 250 });
      } else {
        this.render();
      }
    };
    this.deferredUpdateMetadata = () => {
      // scheduler debounces the update; without it, just update immediately
      if (scheduler) {
        scheduler.debounce('UiBackgroundCard-updateMetadata', () => this.updateMetadata(), { ms: 250 });
      } else {
        this.updateMetadata();
      }
    };
    this._setupKeybinding = this._setupKeybinding.bind(this);

    // Setup event handlers..
    map
      .on('draw', this.deferredRender)
      .on('move', this.deferredUpdateMetadata);

    l10n
      .on('localechange', this._setupKeybinding);

    this._setupKeybinding();
  }


  /**
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  public override render($parent: D3Selection | null = this.$parent): void {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    if (!this.visible) return;

    const context = this.context;
    const imagery = context.systems.imagery!;
    const l10n = context.systems.l10n!;


    // .card-container
    let $wrap: D3Selection = $parent.selectAll('.card-container')
      .data([this.id], d => d);

    // enter
    const $$wrap = $wrap.enter()
      .append('div')
      .attr('class', d => `fillD2 card-container card-container-${d}`);

    const $$title = $$wrap
      .append('div')
      .attr('class', 'fillD2 card-title');

    $$title
      .append('h3');

    $$title
      .append('button')
      .attr('class', 'close')
      .on('click', this.toggle)
      .call(uiIcon('#rapid-icon-close'));

    $$wrap
      .append('div')
      .attr('class', d => `card-content card-content-${d}`);


    // update
    this.$wrap = $wrap = $wrap.merge($$wrap);

    $wrap.selectAll('h3')
      .text(l10n.t('info_panels.background.title'));


    // .card-content
    const $content = $wrap.selectAll('.card-content');

    const source = imagery.baseLayerSource() as any;
    const sourceID = source?.key;  // note: use `key` here, for Wayback it will include the date
    if (!source) return;

    // Empty out metadata if source has changed..
    if (this._currSourceID !== sourceID) {
      this._currSourceID = sourceID;
      this._metadata = {};
    }

    // Empty out the DOM content and rebuild from scratch..
    $content.html('');

    const $list = $content
      .append('ul')
      .attr('class', 'background-info');

    $list
      .append('li')
      .text(source.name);

    // The metadata fetching is not currently working for the Esri sources.
    // todo: We should get that working, but for now just show the date we have.
    if (source.id === 'EsriWayback') {
      $list
        .append('li')
        .text(l10n.t('background.wayback.date') + ':')
        .append('span')
        .text(source.date || l10n.t('inspector.unknown'));
    }

    // Add list items for all the imagery metadata
    METADATA_KEYS.forEach(k => {
      $list
        .append('li')
        .attr('class', `background-info-list-${k}`)
        .classed('hide', !this._metadata[k])
        .text(l10n.t(`info_panels.background.${k}`) + ':')
        .append('span')
        .attr('class', `background-info-span-${k}`)
        .text(this._metadata[k]);
    });

    this.deferredUpdateMetadata();

    // Add buttons
    const toggleTiles = context.getDebug('tile') ? 'hide_tiles' : 'show_tiles';

    $content
      .append('a')
      .text(l10n.t(`info_panels.background.${toggleTiles}`))
      .attr('href', '#')
      .attr('class', 'button button-toggle-tiles')
      .on('click', e => {
        e.preventDefault();
        context.setDebug('tile', !context.getDebug('tile'));
        this.render();
      });
  }


  /**
   * Fetches and updates the imagery metadata fields (zoom, vintage, source, etc.) for the current tile.
   */
  public updateMetadata(): void {
    if (!this.visible) return;
    if (!this.$wrap) return;   // called too early?

    const context = this.context;
    const imagery = context.systems.imagery!;
    const gfx = context.systems.gfx!;
    const l10n = context.systems.l10n!;
    const viewport = context.viewport;
    const $content = this.$wrap.selectAll('.card-content');

    const source = imagery.baseLayerSource() as any;
    const sourceID = source?.key;  // note: use `key` here, for Wayback it will include the date
    if (!source) return;

    // Empty out metadata if source has changed..
    if (this._currSourceID !== sourceID) {
      this._currSourceID = sourceID;
      this._metadata = {};
    }

    // Look for a loaded tile that covers the center of the viewport.
    const centerLoc = viewport.centerLoc();
    const centerExtent = new Extent(centerLoc);
    const layer = gfx.scene!.layers.get('background');
    const tileMap = (layer as any)?._tileMaps.get(sourceID);
    let tile: any;
    let tileZoom: number | undefined;

    if (tileMap) {
      for (const t of tileMap.values()) {
        if (!t.loaded) continue;
        if (t.wgs84Extent.contains(centerExtent)) {
          tile = t;
          tileZoom = t.xyz[2];
          break;
        }
      }
    }

    // update zoom
    const zoom = tileZoom || Math.floor(viewport.transform.zoom);
    this._metadata.zoom = String(zoom);
    $content.selectAll('.background-info-list-zoom')
      .classed('hide', false)
      .selectAll('.background-info-span-zoom')
      .text(this._metadata.zoom);

    if (!tile) return;

    // attempt async update of the rest of the fields..
    source.getMetadata(tile, (err: any, result: any) => {
      if (err || this._currSourceID !== sourceID) return;

      // update vintage
      const vintage = result.vintage;
      this._metadata.vintage = vintage?.range || l10n.t('inspector.unknown');
      $content.selectAll('.background-info-list-vintage')
        .classed('hide', false)
        .selectAll('.background-info-span-vintage')
        .text(this._metadata.vintage);

      // update other metadata
      METADATA_KEYS.forEach(k => {
        if (k === 'zoom' || k === 'vintage') return;  // done already

        const val = result[k];
        this._metadata[k] = val;
        $content.selectAll(`.background-info-list-${k}`)
          .classed('hide', !val)
          .selectAll(`.background-info-span-${k}`)
          .text(val);
      });
    });
  }


  /**
   * This sets up the keybinding, replacing existing if needed
   */
  protected _setupKeybinding(): void {
    const context = this.context;
    const keybinding = context.keybinding();
    const l10n = context.systems.l10n!;

    if (Array.isArray(this._keys)) {
      keybinding.off(this._keys);
    }

    this._keys = [utilCmd('⌘⇧' + l10n.t('shortcuts.command.toggle_background_card.key'))];
    context.keybinding().on(this._keys, this.toggle);
  }

}
