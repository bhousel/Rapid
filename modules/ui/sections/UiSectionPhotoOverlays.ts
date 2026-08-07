import { select } from 'd3-selection';
import { AbstractUiSection } from './AbstractUiSection.ts';
import { uiTooltip } from '../tooltip.ts';
import { utilGetSetValue, utilNoAuto } from '../../util/index.ts';

import type { AbstractPixiLayer } from '../../pixi/AbstractPixiLayer.ts';
import type { Context } from '../../Context.ts';
import type { D3Selection } from 'd3-selection';


/** UiSectionPhotoOverlays
 *  This collapsable section displays various checkboxes for toggleable photo layers.
 *  (and some other fields below it to set filtering options)
 *  It lives in the Map Data pane.
 *
 *  ⋁ Photo Overlays
 *    ◻ Bing Streetside
 *    ◻ Mapillary
 *      ◻ Map Features
 *      ◻ Traffic Signs
 *    ◻ KartaView
 *
 *    ◻ Flat Photos
 *    ◻ Panoramic Photos
 *
 *    From  mm/dd/yyyy
 *    To    mm/dd/yyyy
 */
export class UiSectionPhotoOverlays extends AbstractUiSection {


  /**
   * @param context - Global shared application context
   */
  public constructor(context: Context) {
    super(context, 'photo-overlays');

    const photos = context.systems.photos!;
    const scene = context.systems.gfx!.scene!;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._drawPhotoItems = this._drawPhotoItems.bind(this);
    this._drawPhotoTypeItems = this._drawPhotoTypeItems.bind(this);
    this._drawDateFilter = this._drawDateFilter.bind(this);

    // Add or replace event handlers
    scene.off('layerchange', this.renderInner);
    scene.on('layerchange', this.renderInner);
    photos.off('photochange', this.renderInner);
    photos.on('photochange', this.renderInner);
  }


  /**
   * The section's heading label.
   * @return Localized section title
   */
  public override label(): string {
    const l10n = this.context.systems.l10n!;
    return l10n.t('photo_overlays.title');
  }


  /**
   * Render the photo overlay list and its filter options.
   * @param $selection - A d3-selection to the disclosure content, owned by the parent `UiDisclosure`
   */
  public renderDisclosureContent($selection: D3Selection): void {
    const $container: D3Selection = $selection.selectAll('.photo-overlay-container')
      .data([0]);

    $container.enter()
      .append('div')
      .attr('class', 'photo-overlay-container')
      .merge($container)
      .call(this._drawPhotoItems)
      .call(this._drawPhotoTypeItems)
      .call(this._drawDateFilter);
  }


  /**
   * Enables or disables the given photo layer.
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
    }
  }


  /**
   * Toggles the given photo layer's enabled state.
   * @param layerID - the layer to toggle
   */
  protected _toggleLayer(layerID: string): void {
    const photos = this.context.systems.photos!;
    this._setLayer(layerID, !photos.isLayerEnabled(layerID));
  }


  /**
   * Draws the photo layer checkboxes (Streetside/Mapillary/KartaView, etc).
   * @param $selection - d3-selection to render the list into
   */
  protected _drawPhotoItems($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const photos = context.systems.photos!;
    const scene = context.systems.gfx!.scene!;

    const allLayerIDs = photos.layerIDs as string[];
    const LayerIDs = photos.LayerIDs;
    const layers = allLayerIDs.map(layerID => scene.layers.get(layerID)).filter(Boolean) as AbstractPixiLayer[];
    const data = layers.filter(layer => layer.supported);

    function layerSupported(d: AbstractPixiLayer): boolean {
      return d && d.supported;
    }
    function layerEnabled(d: AbstractPixiLayer): boolean {
      return layerSupported(d) && d.enabled;
    }

    let $ul: D3Selection = $selection
      .selectAll('.layer-list-photos')
      .data([0]);

    $ul = $ul.enter()
      .append('ul')
      .attr('class', 'layer-list layer-list-photos')
      .merge($ul);

    const $li: D3Selection = $ul.selectAll('.list-item-photos')
      .data(data);

    $li.exit()
      .remove();

    const $$li = $li.enter()
      .append('li')
      .attr('class', (d: AbstractPixiLayer) => {
        let classes = `list-item-photos list-item-${d.id}`;
        if (LayerIDs.includes(d.id)) {
          classes += ' indented';
        }
        return classes;
      });

    const $$label = $$li
      .append('label')
      .each((d: AbstractPixiLayer, i, nodes) => {
        const stringID = d.id.replace(/-/g, '_') + '.tooltip';
        select(nodes[i])
          .call(uiTooltip(context)
            .title(l10n.t(stringID))
            .placement('top')
          );
      });

    $$label
      .append('input')
      .attr('type', 'checkbox')
      .on('change', (d3_event: Event, d: AbstractPixiLayer) => this._toggleLayer(d.id));

    $$label
      .append('span')
      .text((d: AbstractPixiLayer) => {
        const stringID = d.id.replace(/-/g, '_') + '.title';
        return l10n.t(stringID);
      });

    // Update
    $li
      .merge($$li)
      .classed('active', layerEnabled)
      .selectAll('input')
      .property('checked', layerEnabled);
  }


  /**
   * Draws the photo-type filter checkboxes (flat / panoramic).
   * @param $selection - d3-selection to render the list into
   */
  protected _drawPhotoTypeItems($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const photos = context.systems.photos!;

    const photoTypes = photos.photoTypes;

    function typeEnabled(d: PhotoType): boolean {
      return photos.showsPhotoType(d);
    }

    let $ul: D3Selection = $selection
      .selectAll('.layer-list-photo-types')
      .data([0]);

    $ul.exit()
      .remove();

    $ul = $ul.enter()
      .append('ul')
      .attr('class', 'layer-list layer-list-photo-types')
      .merge($ul);

    const $li: D3Selection = $ul.selectAll('.list-item-photo-types')
      .data(photos.shouldFilterByPhotoType() ? photoTypes : []);

    $li.exit()
      .remove();

    const $$li = $li.enter()
      .append('li')
      .attr('class', (d: PhotoType) => `list-item-photo-types list-item-${d}`);

    const $$label = $$li
      .append('label')
      .each((d: PhotoType, i, nodes) => {
        select(nodes[i])
          .call(uiTooltip(context)
            .title(l10n.t(`photo_overlays.photo_type.${d}.tooltip`))
            .placement('top')
          );
      });

    $$label
      .append('input')
      .attr('type', 'checkbox')
      .on('change', (d3_event: Event, d: PhotoType) => photos.togglePhotoType(d));

    $$label
      .append('span')
      .text((d: PhotoType) => l10n.t(`photo_overlays.photo_type.${d}.title`));

    // Update
    $li
      .merge($$li)
      .classed('active', typeEnabled)
      .selectAll('input')
      .property('checked', typeEnabled);
  }


  /**
   * Draws the date-range filter inputs.
   * @param $selection - d3-selection to render the list into
   */
  protected _drawDateFilter($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const photos = context.systems.photos!;

    const dateFilterTypes = photos.dateFilters;

    function filterEnabled(d: string): boolean {
      return !!photos.dateFilterValue(d as any);
    }

    let $ul: D3Selection = $selection
      .selectAll('.layer-list-date-filter')
      .data([0]);

    $ul.exit()
      .remove();

    $ul = $ul.enter()
      .append('ul')
      .attr('class', 'layer-list layer-list-date-filter')
      .merge($ul);

    let $li: D3Selection = $ul.selectAll('.list-item-date-filter')
      .data(photos.shouldFilterByDate() ? dateFilterTypes : []);

    $li.exit()
      .remove();

    const $$li = $li.enter()
      .append('li')
      .attr('class', 'list-item-date-filter');

    const $$label = $$li
      .append('label')
      .each((d: string, i, nodes) => {
        select(nodes[i])
          .call(uiTooltip(context)
            .title(l10n.t(`photo_overlays.date_filter.${d}.tooltip`))
            .placement('top')
          );
      });

    $$label
      .append('span')
      .text((d: string) => l10n.t(`photo_overlays.date_filter.${d}.title`));

    $$label
      .append('input')
      .attr('type', 'date')
      .attr('class', 'list-item-input')
      .attr('placeholder', l10n.t('units.year_month_day'))
      .call(utilNoAuto)
      .each((d: string, i, nodes) => {
        utilGetSetValue(select(nodes[i]), photos.dateFilterValue(d as any) || '');
      })
      .on('change', (d3_event: Event, d: string) => {
        const value = (utilGetSetValue(select(d3_event.currentTarget as HTMLInputElement)) as string).trim();
        photos.setDateFilter(d as any, value);
        // reload the displayed dates
        $li.selectAll('input')
          .each((d: string, i, nodes) => {
            utilGetSetValue(select(nodes[i]), photos.dateFilterValue(d as any) || '');
          });
      });

    $li = $li
      .merge($$li)
      .classed('active', filterEnabled);
  }
}
