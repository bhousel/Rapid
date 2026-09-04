import { EventEmitter } from 'tseep/lib/ee-safe';
import { select } from 'd3-selection';
import { icon } from './intro/helper.ts';
import { uiIcon } from './icon.ts';
import { UiModal } from './UiModal.ts';
import { UiRapidAddDataset } from './UiRapidAddDataset.ts';
import { UiRapidCatalog } from './UiRapidCatalog.ts';
import { UiRapidColorpicker } from './UiRapidColorpicker.ts';
import { UiRapidDatasetSettings } from './UiRapidDatasetSettings.ts';
import { utilCmd } from '../util/cmd.ts';
import { utilSafeURL } from '../util/url.ts';

import type { Context } from '../Context.ts';
import type { D3EnterSelection, D3Selection } from 'd3-selection';
import type { RapidDataset } from '../lib/RapidDataset.ts';


/**
 * `UiRapidDatasetToggle` is a Modal control where the user can toggle on and off datasets.
 * It is shown by clicking the main "Rapid" button in the top menu.
 *
 * Events available:
 * - `done`:  Fires when the user is finished and they are closing this Modal
 *
 * @example
 * <div class='modal rapid-modal modal-dataset-toggle'>
 *   <button class='close'/>
 *   <div class='content'>
 *     <div class='modal-section rapid-toggle-all'/>       // "Toggle All Rapid Features"
 *     <div class='modal-section rapid-dataset-rows'>
 *         …                                                //   …list of datasets…
 *     </div>
 *     <div class='modal-section row-search-catalog'/>     // "Search Dataset Catalog"
 *     <div class='modal-section row-custom-dataset'/>     // "Add Custom Dataset"
 *     <div class='modal-section buttons'/>                // "OK" button
 *   </div>
 * </div>
 */
export class UiRapidDatasetToggle extends EventEmitter {
  public context: Context;

  // Child components
  public Modal: UiModal | null;
  protected _colorpickers: Record<DatasetID, UiRapidColorpicker>;


  /**
   * @param  context - Global shared application context
   */
  public constructor(context: Context) {
    super();
    this.context = context;

    // Child components
    this.Modal = null;
    this._colorpickers = {};

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this._done = this._done.bind(this);
    this.show = this.show.bind(this);
    this.close = this.close.bind(this);
    this.render = this.render.bind(this);
    this.renderDatasets = this.renderDatasets.bind(this);
    this.changeColor = this.changeColor.bind(this);
    this.isRapidEnabled = this.isRapidEnabled.bind(this);
    this.toggleRapid = this.toggleRapid.bind(this);
  }


  /**
   * This shows the datataset modal if it isn't already being shown.
   * For a Modal component, must first `show()` to create the modal.
   */
  public show(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scene = context.systems.gfx!.scene!;

    if (this.Modal?.isShown) return;  // already showing

    this.Modal = new UiModal(context).show();
    this.Modal.$modal!
      .attr('class', 'modal rapid-modal modal-dataset-toggle');

    // Handle the various ways of closing the modal ('X' button, Esc, OK Button, etc.)
    this.Modal.once('close', this._done);

    this.render();

    // Setup event handlers
    scene.on('layerchange', this.render);
    l10n.on('localechange', this.render);
  }


  /**
   * Dismisses and removes the Modal, if it exists.
   * @param [e] - the triggering event, if any
   */
  public close(e?: Event): void {
    e?.preventDefault();
    this.Modal?.close();
  }


  /**
   * Emits a 'done' event and cleans up the Modal.
   * All the various ways of closing the Modal end up here.
   */
  protected _done(): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const scene = context.systems.gfx!.scene!;

    this.emit('done');
    this.Modal = null;
    this._colorpickers = {};

    scene.off('layerchange', this.render);
    l10n.off('localechange', this.render);
  }


  /**
   * Renders the content inside the Modal component.
   */
  public render(): void {
    if (!this.Modal) return;

    const context = this.context;
    const l10n = context.systems.l10n!;
    const scene = context.systems.gfx!.scene!;
    const rtl = l10n.isRTL ? '-rtl' : '';
    const isRapidEnabled = scene.layers.get('rapid')?.enabled;
    const $content = this.Modal.$content!;

    /* Toggle All */
    let $toggleAll: D3Selection = $content.selectAll('.rapid-toggle-all')
      .data([0]);

    // enter
    const $$toggleAll: D3EnterSelection = $toggleAll
      .enter()
      .append('div')
      .attr('class', 'modal-section rapid-row rapid-toggle-all');

    const $$toggleAllText: D3EnterSelection = $$toggleAll
      .append('div')
      .attr('class', 'rapid-row-text')
      .append('div')
      .attr('class', 'rapid-row-label-wrap');

    $$toggleAllText
      .append('span')
      .attr('class', 'rapid-row-label');

    $$toggleAllText
      .append('span')
      .attr('class', 'rapid-hotkey');

    const $$toggleAllActions: D3EnterSelection = $$toggleAll
      .append('div')
      .attr('class', 'rapid-row-actions')
      .append('label')
      .attr('class', 'rapid-checkbox-label');

    $$toggleAllActions
      .append('input')
      .attr('type', 'checkbox')
      .attr('class', 'rapid-checkbox-input')
      .on('click', this.toggleRapid);

    $$toggleAllActions
      .append('div')
      .attr('class', 'rapid-checkbox-custom');

    // update
    $toggleAll = $toggleAll.merge($$toggleAll);

    $toggleAll.selectAll('.rapid-row-label')
      .html(l10n.t('rapid_menu.toggle_all', {
        rapidicon: icon(`#rapid-logo-rapid-wordmark${rtl}`, 'logo-rapid')
      }));

    const toggleKey = utilCmd('⇧' + l10n.t('shortcuts.command.toggle_rapid_data.key'));
    $toggleAll.selectAll('.rapid-hotkey')
      .text('(' + toggleKey + ')');

    $toggleAll.selectAll('.rapid-checkbox-input')
      .property('checked', isRapidEnabled);


    /* Dataset List */
    let $datasets: D3Selection = $content.selectAll('.rapid-dataset-rows')
      .data([0]);

    // enter
    const $$datasets: D3EnterSelection = $datasets.enter()
      .append('div')
      .attr('class', 'modal-section rapid-dataset-rows');

    // update
    $datasets = $datasets.merge($$datasets);

    $datasets
      .call(this.renderDatasets);


    /* Search Data Catalog */
    let $catalogOption: D3Selection = $content.selectAll('.row-search-catalog')
      .data([0]);

    // enter
    const $$catalogOption: D3EnterSelection = $catalogOption.enter()
      .append('div')
      .attr('class', 'modal-section rapid-row row-search-catalog')
      .on('click', () => {
        const CatalogModal = new UiRapidCatalog(context).on('done', this.render);
        CatalogModal.show();
      });

    $$catalogOption
      .append('div')
      .attr('class', 'rapid-row-text')
      .append('span')
      .attr('class', 'rapid-row-label');

    $$catalogOption
      .append('div')
      .attr('class', 'rapid-row-actions')
      .append('div')
      .attr('class', 'rapid-row-action')
      .call(uiIcon('#fas-plus', 'icon-30'));

    // update
    $catalogOption = $catalogOption.merge($$catalogOption);

    $catalogOption.selectAll('.rapid-row-label')
      .text(l10n.t('rapid_menu.search_dataset_catalog'));


    /* Add Custom Dataset */
    let $customOption: D3Selection = $content.selectAll('.row-custom-dataset')
      .data([0]);

    // enter
    const $$customOption: D3EnterSelection = $customOption.enter()
      .append('div')
      .attr('class', 'modal-section rapid-row row-custom-dataset')
      .on('click', () => {
        const AddDatasetModal = new UiRapidAddDataset(context).on('done', this.render);
        AddDatasetModal.show();
      });

    $$customOption
      .append('div')
      .attr('class', 'rapid-row-text')
      .append('span')
      .attr('class', 'rapid-row-label');

    $$customOption
      .append('div')
      .attr('class', 'rapid-row-actions')
      .append('div')
      .attr('class', 'rapid-row-action')
      .call(uiIcon('#fas-plus', 'icon-30'));

    // update
    $customOption = $customOption.merge($$customOption);

    $customOption.selectAll('.rapid-row-label')
      .text(l10n.t('rapid_menu.add_custom_dataset'));


    /* OK Button */
    let $buttons: D3Selection = $content.selectAll('.modal-section.buttons')
      .data([0]);

    // enter
    const $$buttons: D3EnterSelection = $buttons.enter()
      .append('div')
      .attr('class', 'modal-section buttons');

    $$buttons
      .append('button')
      .attr('class', 'button ok-button action')
      .on('click', this.close);

    // update
    $buttons = $buttons.merge($$buttons);

    $buttons.selectAll('.button')
      .text(l10n.t('text.okay'));
  }


  /**
   * Renders the list of active datasets into the `.rapid-dataset-rows` div.
   * @param $selection - A d3-selection to a HTMLElement that this component should render itself into
   */
  public renderDatasets($selection: D3Selection): void {
    const context = this.context;
    const l10n = context.systems.l10n!;
    const map = context.systems.map!;
    const rapid = context.systems.rapid!;
    const scene = context.systems.gfx!.scene!;
    const settings = context.systems.settings;

    const isRapidEnabled = scene.layers.get('rapid')?.enabled;
    const showPreview = rapid.isPoweruser() && settings?.get('poweruser.previewDatasets') === 'true';
    const datasets = [...rapid.datasets.values()]
      .filter(d => (showPreview || !d.beta));    // exclude preview datasets unless user has opted into them

    let $rows: D3Selection = $selection.selectAll('.rapid-row-dataset')
      .data(datasets, (d: RapidDataset) => d.id);

    // exit
    $rows.exit()
      .each((d: RapidDataset) => {
        const control = this._colorpickers[d.id];
        control?.close();
        delete this._colorpickers[d.id];
      })
      .remove();

    // enter
    const $$rows: D3EnterSelection = $rows.enter()
      .append('div')
      .attr('class', 'rapid-row rapid-row-dataset');

    const $$texts: D3EnterSelection = $$rows
      .append('div')
      .attr('class', 'rapid-row-text');

    // line1: name and optional beta badge
    const $$line1: D3EnterSelection = $$texts
      .append('div')
      .attr('class', 'rapid-row-label-wrap');

    $$line1
      .append('span')
      .attr('class', 'rapid-row-label');

    $$line1
      .filter((d: RapidDataset) => d.beta)
      .append('div')
      .attr('class', 'rapid-dataset-label-beta beta');

    // line2:  extent and license link
    const $$line2: D3EnterSelection = $$texts
      .append('div')
      .attr('class', 'rapid-row-description-wrap');

    $$line2
      .each((d: RapidDataset, i: number, nodes: HTMLElement[]) => {
        const $$extent: D3EnterSelection = select(nodes[i]);

        // if the data spans more than 100°*100°, it might as well be worldwide
        if (d.extent && d.extent.area() < 10000) {
          $$extent
            .append('a')
            .attr('class', 'rapid-dataset-extent-center-map')
            .attr('href', '#')
            .on('click', (e: PointerEvent) => {
              e.preventDefault();
              map.extent(d.extent);
            });
        } else {
          $$extent
            .append('span')
            .attr('class', 'rapid-dataset-extent-worldwide');
        }
      });

    const $$license: D3EnterSelection = $$line2
      .filter((d: RapidDataset) => !!d.licenseUrl);

    $$license
      .append('span')
      .attr('class', 'rapid-license-divider');

    const $$link: D3EnterSelection = $$license
      .append('span')
      .attr('class', 'rapid-license-wrap')
      .append('a')
      .attr('class', 'rapid-license-link')
      .attr('target', '_blank')
      .attr('href', (d: RapidDataset) => utilSafeURL(d.licenseUrl));

    $$link
      .append('span')
      .attr('class', 'rapid-license-link-text');

    $$link
      .call(uiIcon('#rapid-icon-out-link', 'inline'));


    const $$actions: D3EnterSelection = $$rows
      .append('div')
      .attr('class', 'rapid-row-actions');

    const $$colorpickers: D3EnterSelection = $$actions
      .append('div')
      .attr('class', 'rapid-row-action rapid-colorpicker-wrap');

    $$colorpickers.each((ds: RapidDataset) => {
      const control = new UiRapidColorpicker(context);
      control.on('change', (val: string) => this.changeColor(ds, val));
      this._colorpickers[ds.id] = control;
    });

    $$actions
      .append('label')
      .attr('class', 'rapid-row-action rapid-dataset-settings')
      .on('click', (e: PointerEvent, ds: RapidDataset) => {
        if (!this.isRapidEnabled())  return;  // check it - don't capture the closure variable
        const SettingsModal = new UiRapidDatasetSettings(context).on('done', this.render);
        SettingsModal.dataset = ds;
        SettingsModal.show();
      })
      .call(uiIcon('#fas-gear'));

    $$actions
      .append('label')
      .attr('class', 'rapid-row-action rapid-dataset-visible')
      .on('click', (e: PointerEvent, ds: RapidDataset) => {
        if (!this.isRapidEnabled())  return;  // check it - don't capture the closure variable
        context.enter('browse');   // return to browse mode (in case something was selected)
        rapid.toggleDatasets(ds.id);
        this.render();
      })
      .call(uiIcon(''));

    $$actions
      .append('label')
      .attr('class', 'rapid-row-action rapid-dataset-trash')
      .on('click', (e: PointerEvent, ds: RapidDataset) => {
        if (!this.isRapidEnabled())  return;  // check it - don't capture the closure variable
        context.enter('browse');   // return to browse mode (in case something was selected)
        rapid.removeDatasets(ds.id);
        this.render();
      })
      .call(uiIcon('#fas-trash-can'));


    // update
    $rows = $rows.merge($$rows);

    // localize and style everything...
    $rows.selectAll('.rapid-row-label')
      .text(d => d.getLabel());

    $rows.selectAll('.rapid-row-text')
      .classed('disabled', (d: RapidDataset) => !d.enabled || !isRapidEnabled);
    $rows.selectAll('.rapid-row-actions')
      .classed('disabled', (d: RapidDataset) => !isRapidEnabled);

    $rows.selectAll('.rapid-dataset-label-beta')
      .attr('title', l10n.t('rapid_poweruser.beta'));   // alt text

    $rows.selectAll('.rapid-license-link-text')
      .text(l10n.t('rapid_menu.license'));

    $rows.selectAll('.rapid-dataset-extent-center-map')
      .text(l10n.t('rapid_menu.center_map'));

    $rows.selectAll('.rapid-dataset-extent-worldwide')
      .text(l10n.t('rapid_menu.worldwide'));

    $rows.selectAll('.rapid-dataset-visible')
      .select('use')  // propagate bound data
      .attr('href', (ds: RapidDataset) => ds.enabled ? '#fas-eye' : '#fas-eye-slash');

    $rows.selectAll('.rapid-colorpicker-wrap')
      .each((d: RapidDataset, i: number, nodes: HTMLElement[]) => {
        const $selection: D3Selection = select(nodes[i]);
        const control = this._colorpickers[d.id];
        if (control) {
          control.color = d.color;
          control.disabled = !isRapidEnabled;
          $selection.call(control.render);
        }
      });

    $rows.selectAll('.rapid-checkbox-label')
      .classed('disabled', !isRapidEnabled);

    $rows.selectAll('.rapid-checkbox-input')
      .property('checked', (d: RapidDataset) => d.enabled)
      .attr('disabled', isRapidEnabled ? null : true);
  }


  /**
   * Is Rapid currently enabled?
   * This state is currently stored in - whether the rapid layer is enabled.
   * @return  `true` if rapid is enabled, `false` if not.
   */
  public isRapidEnabled(): boolean {
    const scene = this.context.systems.gfx!.scene!;
    return !!scene.layers.get('rapid')?.enabled;
  }

  /**
   * Called when a user has clicked the checkbox to toggle all Rapid layers on/off.
   * @param [e] - the triggering event, if any
   */
  public toggleRapid(): void {
    const scene = this.context.systems.gfx!.scene!;
    scene.toggleLayers('rapid');
  }


  /**
   * Called when a user has selected a color with the colorpicker.
   * @param  ds  - the RapidDataset to update
   * @param  color - hexstring for the color e.g. '#da26d3'
   */
  public changeColor(ds: RapidDataset, color: string): void {
    const context = this.context;
    const gfx = context.systems.gfx!;
    const rapid = context.systems.rapid!;
    const scene = gfx.scene!;

    ds.color = color;
    rapid.saveDatasetSettings(ds);

    // need some more things to happen here to trigger redraws..
    // see also UiRapidDatasetSettings _clickedOk()
    scene.dirtyLayers('rapid');
    gfx.immediateRedraw();
    this.render();

    // In case a Rapid feature is already selected, reselect it to update sidebar too.
    const mode = context.mode;
    if (mode?.id === 'select') {  // new (not legacy) select mode
      const selection = new Map(mode.selectedData);
      context.enter('select', { selection: selection });
    }
  }

}
